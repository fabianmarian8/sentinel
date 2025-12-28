import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RunJobPayload, QUEUE_NAMES } from '../types/jobs';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../services/queue.service';
import { DedupeService } from '../services/dedupe.service';
import { ConditionEvaluatorService } from '../services/condition-evaluator.service';
import { AlertGeneratorService } from '../services/alert-generator.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { HealthScoreService } from '../services/health-score.service';
import { smartFetch, extract, processAntiFlap } from '@sentinel/extractor';
import { getStorageClientAuto } from '@sentinel/storage';
import type {
  ExtractionConfig,
  NormalizationConfig,
  AlertPolicy,
  RuleType,
  FetchMode,
} from '@sentinel/shared';
import { normalizeValue } from '../utils/normalize-value';
import { detectChange } from '../utils/change-detection';

/**
 * Processor for rules:run queue
 *
 * Handles rule execution: fetch + extract + normalize + persist + alert
 *
 * Pipeline:
 * 1. Fetch rule configuration from database
 * 2. Fetch URL using configured fetch mode
 * 3. Extract value using configured selector
 * 4. Normalize extracted value
 * 5. Run anti-flap state machine
 * 6. Persist run and observation records
 * 7. Trigger alerts if change confirmed
 */
@Processor(QUEUE_NAMES.RULES_RUN, {
  concurrency: 5, // Will be overridden by config in module
})
export class RunProcessor extends WorkerHost {
  private readonly logger = new Logger(RunProcessor.name);

  constructor(
    private prisma: PrismaService,
    private queueService: QueueService,
    private dedupeService: DedupeService,
    private conditionEvaluator: ConditionEvaluatorService,
    private alertGenerator: AlertGeneratorService,
    private rateLimiter: RateLimiterService,
    private healthScore: HealthScoreService,
  ) {
    super();
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`[Job ${job.id}] Processing started`);
  }

  async process(job: Job<RunJobPayload>): Promise<any> {
    const { ruleId, trigger, forceMode, debug } = job.data;
    const startedAt = new Date();

    this.logger.log(
      `[Job ${job.id}] Processing rule ${ruleId} (trigger: ${trigger})`,
    );

    // Step 1: Fetch rule with source, workspace and state
    const rule = await this.prisma.rule.findUnique({
      where: { id: ruleId },
      include: {
        source: {
          include: {
            fetchProfile: true,
            workspace: true,
          },
        },
        state: true,
      },
    });

    if (!rule) {
      this.logger.warn(`[Job ${job.id}] Rule ${ruleId} not found, skipping`);
      return { skipped: true, reason: 'Rule not found' };
    }

    if (!rule.enabled) {
      this.logger.warn(`[Job ${job.id}] Rule ${ruleId} is disabled, skipping`);
      return { skipped: true, reason: 'Rule disabled' };
    }

    // Step 2: Check rate limit
    const fetchModeUsed: FetchMode =
      forceMode ?? rule.source.fetchProfile?.mode ?? 'http';
    const domain = new URL(rule.source.url).hostname;

    const rateLimitResult = await this.rateLimiter.consumeToken(
      domain,
      fetchModeUsed,
    );

    if (!rateLimitResult.allowed) {
      this.logger.warn(
        `[Job ${job.id}] Rate limit exceeded for ${domain} (${fetchModeUsed}), delaying by ${rateLimitResult.retryAfterMs}ms`,
      );

      // Delay the job
      await job.moveToDelayed(Date.now() + (rateLimitResult.retryAfterMs ?? 5000));

      return {
        delayed: true,
        retryAfterMs: rateLimitResult.retryAfterMs,
        reason: 'Domain rate limit exceeded',
        domain,
        mode: fetchModeUsed,
      };
    }

    this.logger.debug(
      `[Job ${job.id}] Rate limit check passed for ${domain} (${fetchModeUsed}), ${rateLimitResult.remainingTokens} tokens remaining`,
    );

    // Step 3: Create run record

    const run = await this.prisma.run.create({
      data: {
        ruleId,
        startedAt,
        fetchModeUsed,
      },
    });

    // Prepare for screenshot if enabled (check rule-level setting first, then fetchProfile)
    const screenshotOnChange = rule.screenshotOnChange ?? rule.source.fetchProfile?.screenshotOnChange ?? false;
    let tempDir: string | null = null;
    let screenshotPath: string | null = null;

    if (screenshotOnChange) {
      tempDir = await mkdtemp(join(tmpdir(), 'sentinel-screenshot-'));
      screenshotPath = join(tempDir, `screenshot-${run.id}.png`);
    }

    try {
      // Step 4: Fetch HTML using smartFetch (supports HTTP + headless fallback)
      // Get extraction selector for element-only screenshots (smaller file size)
      const extraction = rule.extraction as unknown as ExtractionConfig;
      const screenshotSelector = extraction?.selector;

      const fetchResult = await smartFetch({
        url: rule.source.url,
        timeout: 30000, // 30s timeout for slow sites
        userAgent: rule.source.fetchProfile?.userAgent ?? undefined,
        headers: rule.source.fetchProfile?.headers
          ? (rule.source.fetchProfile.headers as Record<string, string>)
          : undefined,
        cookies: rule.source.fetchProfile?.cookies
          ? (rule.source.fetchProfile.cookies as string)
          : undefined,
        preferredMode: fetchModeUsed === 'headless' ? 'headless' : 'auto',
        fallbackToHeadless: true,
        renderWaitMs: rule.source.fetchProfile?.renderWaitMs ?? 2000,
        screenshotOnChange: screenshotOnChange,
        screenshotPath: screenshotPath ?? undefined,
        screenshotSelector: screenshotSelector,
      });

      // Step 5: Update run with fetch results (use actual mode from smartFetch)
      const actualFetchMode = fetchResult.modeUsed || fetchModeUsed;
      await this.prisma.run.update({
        where: { id: run.id },
        data: {
          fetchModeUsed: actualFetchMode,
          httpStatus: fetchResult.httpStatus,
          errorCode: fetchResult.errorCode,
          errorDetail: fetchResult.errorDetail,
          timings: fetchResult.timings as any,
          blockDetected: fetchResult.errorCode?.startsWith('BLOCK_') ?? false,
          contentHash: fetchResult.success
            ? createHash('sha256').update(fetchResult.html!).digest('hex')
            : null,
        },
      });

      // Log if fallback was triggered
      if (fetchResult.fallbackTriggered) {
        this.logger.log(
          `[Job ${job.id}] HTTP-to-headless fallback triggered: ${fetchResult.fallbackReason}`,
        );
      }

      if (!fetchResult.success) {
        this.logger.error(
          `[Job ${job.id}] Fetch failed: ${fetchResult.errorCode} - ${fetchResult.errorDetail}`,
        );
        // Update health score on fetch error
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: fetchResult.errorCode,
          usedFallback: false,
        });
        return await this.handleFetchError(run.id, fetchResult);
      }

      // Step 6: Extract value (extraction already defined above for screenshotSelector)
      const extractResult = extract(fetchResult.html!, extraction);

      if (!extractResult.success) {
        await this.prisma.run.update({
          where: { id: run.id },
          data: {
            errorCode: 'EXTRACT_SELECTOR_NOT_FOUND',
            errorDetail: extractResult.error,
            finishedAt: new Date(),
          },
        });
        // Update health score on extraction error
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: 'SELECTOR_BROKEN',
          usedFallback: false,
        });
        this.logger.error(
          `[Job ${job.id}] Extraction failed: ${extractResult.error}`,
        );
        return { success: false, error: 'Extraction failed' };
      }

      // Step 7: Normalize value
      const normalization = rule.normalization as unknown as NormalizationConfig | null;
      const normalizedValue = normalizeValue(
        extractResult.value!,
        normalization,
        rule.ruleType as RuleType,
      );

      // Step 8: Anti-flap check
      const alertPolicy = rule.alertPolicy as unknown as AlertPolicy | null;
      const requireConsecutive = alertPolicy?.requireConsecutive ?? 1;

      const antiFlipResult = processAntiFlap(
        normalizedValue,
        rule.state,
        requireConsecutive,
      );

      // Step 9: Update rule state
      await this.prisma.ruleState.upsert({
        where: { ruleId },
        create: {
          ruleId,
          lastStable: antiFlipResult.newState.lastStable,
          candidate: antiFlipResult.newState.candidate,
          candidateCount: antiFlipResult.newState.candidateCount ?? 0,
        },
        update: {
          lastStable: antiFlipResult.newState.lastStable,
          candidate: antiFlipResult.newState.candidate,
          candidateCount: antiFlipResult.newState.candidateCount ?? 0,
        },
      });

      // Step 10: Detect change kind
      const changeResult = detectChange(
        antiFlipResult.result.previousStable,
        normalizedValue,
        rule.ruleType as RuleType,
      );

      // Step 11: Create observation
      await this.prisma.observation.create({
        data: {
          runId: run.id,
          ruleId,
          extractedRaw: extractResult.value,
          extractedNormalized: normalizedValue as any,
          changeDetected: antiFlipResult.result.confirmedChange,
          changeKind: changeResult.changeKind as any,
          diffSummary: changeResult.diffSummary,
        },
      });

      // Step 12: Mark run complete
      await this.prisma.run.update({
        where: { id: run.id },
        data: { finishedAt: new Date() },
      });

      // Step 12b: Update health score (success)
      await this.healthScore.updateHealthScore({
        ruleId,
        errorCode: null,
        usedFallback: actualFetchMode === 'headless',
      });

      // Step 13: Trigger alerts if change confirmed
      let uploadedScreenshotPath: string | null = null;

      if (antiFlipResult.result.confirmedChange) {
        this.logger.log(
          `[Job ${job.id}] Change confirmed for rule ${ruleId}, triggering alerts`,
        );

        // Step 13a: Upload screenshot to storage if captured
        this.logger.debug(
          `[Job ${job.id}] Screenshot check: screenshotOnChange=${screenshotOnChange}, localPath=${screenshotPath}, fetchResult.screenshotPath=${fetchResult.screenshotPath}`,
        );
        if (screenshotOnChange && screenshotPath && fetchResult.screenshotPath) {
          try {
            const storageClient = getStorageClientAuto();
            if (storageClient) {
              const screenshotBuffer = await readFile(screenshotPath);
              const uploadResult = await storageClient.uploadScreenshot(
                ruleId,
                run.id,
                screenshotBuffer,
              );
              uploadedScreenshotPath = uploadResult.url;
              this.logger.log(
                `[Job ${job.id}] Screenshot uploaded: ${uploadedScreenshotPath}`,
              );
            } else {
              this.logger.debug(
                `[Job ${job.id}] Storage client not configured, skipping screenshot upload`,
              );
            }
          } catch (uploadError) {
            this.logger.warn(
              `[Job ${job.id}] Screenshot upload error: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`,
            );
          }
        }

        // Step 13b: Update run with screenshot path
        if (uploadedScreenshotPath) {
          await this.prisma.run.update({
            where: { id: run.id },
            data: { screenshotPath: uploadedScreenshotPath },
          });
        }

        await this.triggerAlerts(rule, normalizedValue, changeResult);
      } else {
        this.logger.log(
          `[Job ${job.id}] No change or not yet confirmed (count: ${antiFlipResult.result.candidateCount}/${requireConsecutive})`,
        );
      }

      return {
        success: true,
        changed: antiFlipResult.result.confirmedChange,
        value: normalizedValue,
        screenshotPath: uploadedScreenshotPath,
      };
    } catch (error) {
      // Step 14: Handle unexpected errors
      await this.prisma.run.update({
        where: { id: run.id },
        data: {
          errorCode: 'SYSTEM_WORKER_CRASH',
          errorDetail: error instanceof Error ? error.message : String(error),
          finishedAt: new Date(),
        },
      });
      this.logger.error(
        `[Job ${job.id}] Worker crashed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      // Cleanup temp screenshot directory
      if (tempDir) {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Handle fetch errors
   */
  private async handleFetchError(runId: string, fetchResult: any) {
    await this.prisma.run.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
      },
    });

    return {
      success: false,
      error: fetchResult.errorCode,
      detail: fetchResult.errorDetail,
    };
  }

  /**
   * Trigger alerts for confirmed changes
   */
  private async triggerAlerts(rule: any, value: any, change: any) {
    const alertPolicy = rule.alertPolicy as unknown as AlertPolicy | null;
    const hasChannels = alertPolicy?.channels && alertPolicy.channels.length > 0;

    if (!alertPolicy?.conditions || alertPolicy.conditions.length === 0) {
      this.logger.debug(
        `[Rule ${rule.id}] No alert conditions configured, skipping alert`,
      );
      return;
    }

    // Evaluate alert conditions
    const triggeredConditions = this.conditionEvaluator.evaluateConditions(
      alertPolicy.conditions,
      value,
      rule.state?.lastStable ?? null,
      rule.ruleType as RuleType,
      change,
    );

    if (triggeredConditions.length === 0) {
      this.logger.debug(
        `[Rule ${rule.id}] No alert conditions triggered, skipping alert`,
      );
      return;
    }

    this.logger.log(
      `[Rule ${rule.id}] ${triggeredConditions.length} condition(s) triggered`,
    );

    // Get highest severity
    const severity = this.alertGenerator.getHighestSeverity(triggeredConditions);
    const alertSeverity = this.alertGenerator.mapSeverityToAlertSeverity(severity);

    // Generate alert title and body
    const title = this.alertGenerator.generateAlertTitle(rule, triggeredConditions);
    const body = this.alertGenerator.generateAlertBody(
      rule,
      value,
      change,
      triggeredConditions,
    );

    // Generate dedupe key with workspace timezone
    const conditionIds = triggeredConditions.map((c) => c.id);
    const dedupeKey = this.dedupeService.generateDedupeKey(
      rule.id,
      conditionIds,
      value,
      rule.source.workspace.timezone,
    );

    // Check if alert should be created (deduplication + cooldown)
    const cooldownSeconds = alertPolicy.cooldownSeconds ?? 0;
    const { allowed, reason } = await this.dedupeService.shouldCreateAlert(
      rule.id,
      dedupeKey,
      cooldownSeconds,
    );

    if (!allowed) {
      this.logger.debug(
        `[Rule ${rule.id}] Alert suppressed: ${reason}`,
      );
      return;
    }

    // Create alert record
    const alert = await this.prisma.alert.create({
      data: {
        ruleId: rule.id,
        triggeredAt: new Date(),
        severity: alertSeverity,
        title,
        body,
        dedupeKey,
        channelsSent: [],
      },
    });

    this.logger.log(
      `[Rule ${rule.id}] Alert created (id: ${alert.id}, severity: ${alertSeverity})`,
    );

    // Enqueue alert dispatch job only if channels are configured
    if (hasChannels) {
      await this.queueService.enqueueAlertDispatch({
        alertId: alert.id,
        workspaceId: rule.source.workspaceId,
        ruleId: rule.id,
        channels: alertPolicy.channels,
        dedupeKey,
      });

      this.logger.log(
        `[Rule ${rule.id}] Alert dispatch enqueued (channels: ${alertPolicy.channels.join(', ')})`,
      );
    } else {
      this.logger.debug(
        `[Rule ${rule.id}] No notification channels configured, alert saved but not dispatched`,
      );
    }
  }

  /**
   * Handle job completion
   */
  async onCompleted(job: Job<RunJobPayload>) {
    this.logger.log(
      `[Job ${job.id}] Completed successfully for rule ${job.data.ruleId}`,
    );
  }

  /**
   * Handle job failure
   */
  async onFailed(job: Job<RunJobPayload> | undefined, error: Error) {
    if (!job) {
      this.logger.error('Job failed without job data', error.stack);
      return;
    }

    this.logger.error(
      `[Job ${job.id}] Failed for rule ${job.data.ruleId}: ${error.message}`,
      error.stack,
    );
  }

  /**
   * Handle stalled jobs (stuck in processing)
   */
  async onStalled(job: Job<RunJobPayload>) {
    this.logger.warn(
      `[Job ${job.id}] Job stalled for rule ${job.data.ruleId}, will be retried`,
    );
  }
}
