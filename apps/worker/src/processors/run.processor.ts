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
import { LlmExtractionService } from '../services/llm-extraction.service';
import { TieredFetchService } from '../services/tiered-fetch.service';
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
    private llmExtraction: LlmExtractionService,
    private tieredFetch: TieredFetchService,
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
            workspace: {
              include: {
                owner: true,
              },
            },
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

    let domain: string;
    try {
      domain = new URL(rule.source.url).hostname;
    } catch {
      this.logger.error(
        `[Job ${job.id}] Invalid URL for rule ${ruleId}: ${rule.source.url}`,
      );
      return {
        skipped: true,
        reason: 'Invalid source URL',
        error: 'INVALID_URL',
      };
    }

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

      // Auto-enforce 1-day interval ONLY when 2captcha (paid service) was used
      // FlareSolverr JS challenges are FREE - no restrictions needed
      // Only restrict when FlareSolverr message indicates CAPTCHA was solved (paid 2captcha)
      if (
        fetchResult.modeUsed === 'flaresolverr' &&
        !rule.captchaIntervalEnforced
      ) {
        const flareSolverrMsg = (fetchResult.flareSolverrMessage || '').toLowerCase();

        // ONLY trigger if FlareSolverr explicitly solved a CAPTCHA (uses paid 2captcha API)
        // Messages like "Challenge solved!" are FREE (JS challenge bypass)
        // Messages like "Captcha solved" indicate paid 2captcha usage
        const usedPaidCaptchaSolver = flareSolverrMsg.includes('captcha');

        if (usedPaidCaptchaSolver) {
          const currentSchedule = rule.schedule as { intervalSeconds?: number; cron?: string } | null;
          const currentInterval = currentSchedule?.intervalSeconds ?? 0;
          const ONE_DAY_SEC = 86400;

          if (currentInterval < ONE_DAY_SEC) {
            const newNextRunAt = new Date(Date.now() + ONE_DAY_SEC * 1000);
            await this.prisma.rule.update({
              where: { id: ruleId },
              data: {
                captchaIntervalEnforced: true,
                originalSchedule: rule.schedule as any,
                schedule: { ...currentSchedule, intervalSeconds: ONE_DAY_SEC },
                nextRunAt: newNextRunAt,
              },
            });
            this.logger.warn(
              `[Job ${job.id}] Rule ${ruleId}: 2captcha used (paid), interval changed to 1 day`,
            );
          }
        } else {
          this.logger.debug(
            `[Job ${job.id}] FlareSolverr: "${flareSolverrMsg}" - no paid CAPTCHA, keeping interval`,
          );
        }
      }

      // =====================================================
      // TIERED FETCH FALLBACK: If smartFetch failed OR got blocked HTML
      // =====================================================
      let paidTierUsed = false;
      let fetchHtml = fetchResult.html || '';
      const htmlSize = fetchHtml.length;
      const htmlLower = fetchHtml.toLowerCase();

      // Check if we should try TieredFetch:
      // 1. SmartFetch completely failed (HTTP 403, etc.)
      // 2. SmartFetch succeeded but returned blocked HTML
      const isBlocked = !fetchResult.success || (htmlSize < 5000 && (
        htmlLower.includes('datadome') ||
        htmlLower.includes('captcha-delivery.com') ||
        htmlLower.includes('cloudflare') ||
        htmlLower.includes('captcha') ||
        htmlLower.includes('access denied') ||
        htmlLower.includes('blocked') ||
        htmlLower.includes('checking your browser')
      ));

      if (isBlocked) {
        this.logger.warn(
          `[Job ${job.id}] Free tier returned blocked HTML (${htmlSize} bytes), trying TieredFetch...`,
        );

        const tieredResult = await this.tieredFetch.fetch({
          url: rule.source.url,
          userAgent: rule.source.fetchProfile?.userAgent ?? undefined,
          headers: rule.source.fetchProfile?.headers
            ? (rule.source.fetchProfile.headers as Record<string, string>)
            : undefined,
          cookies: rule.source.fetchProfile?.cookies
            ? (rule.source.fetchProfile.cookies as string)
            : undefined,
          timeout: 30000,
          renderWaitMs: rule.source.fetchProfile?.renderWaitMs ?? 2000,
          allowPaidTier: true, // Allow paid services for blocked sites
        });

        if (tieredResult.success && tieredResult.html) {
          fetchHtml = tieredResult.html;
          paidTierUsed = tieredResult.paidServiceUsed;

          this.logger.log(
            `[Job ${job.id}] TieredFetch succeeded via ${tieredResult.methodUsed} (tier: ${tieredResult.tierUsed}, cost: $${tieredResult.estimatedCost?.toFixed(4) || '0'})`,
          );

          // Update run with new fetch mode
          // Note: Using 'http' for proxy since FetchMode enum doesn't have proxy values
          await this.prisma.run.update({
            where: { id: run.id },
            data: {
              fetchModeUsed: 'http', // Proxy is essentially HTTP via proxy
              contentHash: createHash('sha256').update(fetchHtml).digest('hex'),
              // Store actual method in metadata via errorDetail (no schema change needed)
              errorDetail: tieredResult.paidServiceUsed
                ? `Paid tier used: ${tieredResult.methodUsed}`
                : undefined,
            },
          });
        } else {
          this.logger.warn(
            `[Job ${job.id}] TieredFetch also failed: ${tieredResult.error}`,
          );
          // If original smartFetch also failed, we have nothing to extract
          if (!fetchResult.success) {
            this.logger.error(
              `[Job ${job.id}] Both smartFetch and TieredFetch failed, giving up`,
            );
            await this.healthScore.updateHealthScore({
              ruleId,
              errorCode: fetchResult.errorCode || 'FETCH_ALL_TIERS_FAILED',
              usedFallback: true,
            });
            return await this.handleFetchError(run.id, {
              ...fetchResult,
              errorCode: 'FETCH_ALL_TIERS_FAILED',
              errorDetail: `smartFetch: ${fetchResult.errorCode}, TieredFetch: ${tieredResult.error}`,
            });
          }
        }
      }

      // If smartFetch failed but we didn't try TieredFetch (shouldn't happen), handle error
      if (!fetchResult.success && fetchHtml.length === 0) {
        this.logger.error(
          `[Job ${job.id}] Fetch failed: ${fetchResult.errorCode} - ${fetchResult.errorDetail}`,
        );
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: fetchResult.errorCode,
          usedFallback: false,
        });
        return await this.handleFetchError(run.id, fetchResult);
      }

      // AUTO-THROTTLE: If paid tier was used, enforce 1-day minimum interval
      if (paidTierUsed && !rule.captchaIntervalEnforced) {
        const currentSchedule = rule.schedule as { intervalSeconds?: number; cron?: string } | null;
        const currentInterval = currentSchedule?.intervalSeconds ?? 0;
        const ONE_DAY_SEC = 86400;

        if (currentInterval < ONE_DAY_SEC) {
          const newNextRunAt = new Date(Date.now() + ONE_DAY_SEC * 1000);
          await this.prisma.rule.update({
            where: { id: ruleId },
            data: {
              captchaIntervalEnforced: true,
              originalSchedule: rule.schedule as any,
              schedule: { ...currentSchedule, intervalSeconds: ONE_DAY_SEC },
              nextRunAt: newNextRunAt,
            },
          });
          this.logger.warn(
            `[Job ${job.id}] Rule ${ruleId}: PAID tier used (proxy/DataDome), interval changed to 1 day to minimize costs`,
          );
        }
      }

      // Step 6: Extract value (use fetchHtml which may be from TieredFetch)
      let extractResult = extract(fetchHtml, extraction);
      let selectorHealed = false;
      let healedSelector: string | null = null;

      // Auto-healing: if extraction failed, try alternative selectors from fingerprint
      if (!extractResult.success && rule.selectorFingerprint) {
        const fingerprint = rule.selectorFingerprint as {
          alternativeSelectors?: string[];
          textAnchor?: string;
        };

        if (fingerprint.alternativeSelectors && fingerprint.alternativeSelectors.length > 0) {
          this.logger.log(
            `[Job ${job.id}] Primary selector failed, trying ${fingerprint.alternativeSelectors.length} alternative selectors`,
          );

          const primarySelector = extraction.selector || '';

          for (const altSelector of fingerprint.alternativeSelectors) {
            // Skip XPath selectors for now (start with xpath:)
            if (altSelector.startsWith('xpath:')) continue;

            // Similarity threshold validation (70%)
            const similarity = this.calculateSelectorSimilarity(primarySelector, altSelector);
            if (similarity < 0.70) {
              this.logger.debug(
                `[Job ${job.id}] Alternative selector ${altSelector} has low similarity (${(similarity * 100).toFixed(0)}%), skipping`,
              );
              continue;
            }

            const altConfig = { ...extraction, selector: altSelector };
            const altResult = extract(fetchHtml, altConfig);

            if (altResult.success) {
              // Validate with textAnchor if available
              if (fingerprint.textAnchor && altResult.value) {
                const normalizedValue = altResult.value.toLowerCase().replace(/\s+/g, ' ').trim();
                const normalizedAnchor = fingerprint.textAnchor.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 20);
                if (!normalizedValue.includes(normalizedAnchor)) {
                  this.logger.debug(
                    `[Job ${job.id}] Alternative selector ${altSelector} found value but textAnchor mismatch, skipping`,
                  );
                  continue;
                }
              }

              extractResult = altResult;
              selectorHealed = true;
              healedSelector = altSelector;

              this.logger.log(
                `[Job ${job.id}] Auto-healed! New selector: ${altSelector} (similarity: ${(similarity * 100).toFixed(0)}%)`,
              );

              // Update rule extraction config with new working selector
              try {
                const newExtraction = { ...extraction, selector: altSelector };
                await this.prisma.rule.update({
                  where: { id: ruleId },
                  data: {
                    extraction: newExtraction as any,
                    lastErrorCode: null,
                    lastErrorAt: null,
                  },
                });
                this.logger.log(
                  `[Job ${job.id}] Rule ${ruleId} extraction config auto-healed to: ${altSelector}`,
                );
              } catch (updateError) {
                this.logger.warn(
                  `[Job ${job.id}] Failed to persist auto-healed selector: ${updateError}`,
                );
              }
              break;
            }
          }
        }
      }

      // LLM FALLBACK: If CSS extraction failed (including auto-healing), try LLM for price rules
      let llmUsed = false;
      if (!extractResult.success && rule.ruleType === 'price') {
        this.logger.log(
          `[Job ${job.id}] CSS extraction failed, trying LLM fallback for ${rule.source.url}`,
        );

        try {
          // Detect if page is blocked by CAPTCHA (small HTML with protection patterns)
          // Note: fetchHtml may already be updated by TieredFetch above
          const llmHtmlSize = fetchHtml.length;
          const llmHtmlLower = fetchHtml.toLowerCase();
          const isDataDomeBlocked = llmHtmlSize < 5000 && (
            llmHtmlLower.includes('datadome') ||
            llmHtmlLower.includes('captcha-delivery.com') ||
            llmHtmlLower.includes('dd.js') ||
            llmHtmlLower.includes('geo.captcha')
          );

          let llmResult;
          if (isDataDomeBlocked) {
            // Use alternative fetch for DataDome blocked pages (mobile UA)
            this.logger.log(
              `[Job ${job.id}] DataDome detected (${llmHtmlSize} bytes), trying mobile UA fetch`,
            );
            llmResult = await this.llmExtraction.extractWithAlternativeFetch({
              url: rule.source.url,
              ruleType: 'price',
            });
          } else {
            // Use HTML extraction for normal pages
            llmResult = await this.llmExtraction.extractWithLlm({
              url: rule.source.url,
              ruleType: 'price',
              html: fetchHtml,
            });
          }

          if (llmResult.success && llmResult.price) {
            extractResult = {
              success: true,
              value: llmResult.price,
              error: undefined,
              fallbackUsed: true,
              selectorUsed: llmResult.method === 'websearch' ? 'LLM_WEBSEARCH' : 'LLM_FALLBACK',
            };
            llmUsed = true;
            this.logger.log(
              `[Job ${job.id}] LLM extracted price: ${llmResult.price} (method: ${llmResult.method}, confidence: ${llmResult.confidence})`,
            );
          } else {
            this.logger.warn(
              `[Job ${job.id}] LLM extraction also failed: ${llmResult.error}`,
            );
          }
        } catch (llmError) {
          const llmErr = llmError as Error;
          this.logger.error(`[Job ${job.id}] LLM fallback error: ${llmErr.message}`);
        }
      }

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

      // If LLM was used successfully, update health score with LLM fallback indicator
      if (llmUsed) {
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: null,
          usedFallback: true,
        });
      }

      // If healed, update health score with fallback indicator
      if (selectorHealed) {
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: null,
          usedFallback: true,
        });
      }

      // Step 7: Normalize value
      const normalization = rule.normalization as unknown as NormalizationConfig | null;
      const normalizedValue = normalizeValue(
        extractResult.value!,
        normalization,
        rule.ruleType as RuleType,
      );

      // Step 8: Anti-flap check
      // Default to 2 consecutive observations to filter out glitch extractions
      // (e.g., wrong element selected due to overlays, race conditions)
      const alertPolicy = rule.alertPolicy as unknown as AlertPolicy | null;
      const requireConsecutive = alertPolicy?.requireConsecutive ?? 2;

      const antiFlipResult = processAntiFlap(
        normalizedValue,
        rule.state,
        requireConsecutive,
      );

      // Step 9: Update rule state with optimistic locking
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let stateUpdateSuccess = false;

      while (!stateUpdateSuccess && retryCount < MAX_RETRIES) {
        try {
          // Fetch current state with version
          const currentState = await this.prisma.ruleState.findUnique({
            where: { ruleId },
          });

          if (currentState) {
            // Update existing state with version check
            const updateResult = await this.prisma.ruleState.updateMany({
              where: {
                ruleId,
                version: currentState.version, // Optimistic lock check
              },
              data: {
                lastStable: antiFlipResult.newState.lastStable,
                candidate: antiFlipResult.newState.candidate,
                candidateCount: antiFlipResult.newState.candidateCount ?? 0,
                version: currentState.version + 1, // Increment version
              },
            });

            if (updateResult.count === 1) {
              stateUpdateSuccess = true;
            } else {
              // Version mismatch - another job updated the state
              retryCount++;
              this.logger.warn(
                `[Job ${job.id}] State update version mismatch (retry ${retryCount}/${MAX_RETRIES})`,
              );

              if (retryCount < MAX_RETRIES) {
                // Recalculate anti-flap with fresh state
                const freshState = await this.prisma.ruleState.findUnique({
                  where: { ruleId },
                });
                const antiFlipRetry = processAntiFlap(
                  normalizedValue,
                  freshState,
                  requireConsecutive,
                );
                // Update antiFlipResult for next retry
                Object.assign(antiFlipResult, antiFlipRetry);
              }
            }
          } else {
            // Create new state (race condition handled below)
            await this.prisma.ruleState.create({
              data: {
                ruleId,
                lastStable: antiFlipResult.newState.lastStable,
                candidate: antiFlipResult.newState.candidate,
                candidateCount: antiFlipResult.newState.candidateCount ?? 0,
                version: 0,
              },
            });
            stateUpdateSuccess = true;
          }
        } catch (error: any) {
          // Handle unique constraint violation on create (race condition)
          if (error?.code === 'P2002') {
            retryCount++;
            this.logger.warn(
              `[Job ${job.id}] State create race condition detected (retry ${retryCount}/${MAX_RETRIES})`,
            );

            if (retryCount < MAX_RETRIES) {
              // Recalculate with fresh state
              const freshState = await this.prisma.ruleState.findUnique({
                where: { ruleId },
              });
              const antiFlipRetry = processAntiFlap(
                normalizedValue,
                freshState,
                requireConsecutive,
              );
              Object.assign(antiFlipResult, antiFlipRetry);
            }
          } else {
            // Unexpected error - rethrow
            throw error;
          }
        }
      }

      if (!stateUpdateSuccess) {
        throw new Error(
          `Failed to update rule state after ${MAX_RETRIES} retries due to concurrent updates`,
        );
      }

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

      // Step 13: Upload screenshot if captured (always, not just on change)
      let uploadedScreenshotPath: string | null = null;

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

      // Update run with screenshot path
      if (uploadedScreenshotPath) {
        await this.prisma.run.update({
          where: { id: run.id },
          data: { screenshotPath: uploadedScreenshotPath },
        });
      }

      // Step 14: Trigger alerts if change confirmed
      if (antiFlipResult.result.confirmedChange) {
        this.logger.log(
          `[Job ${job.id}] Change confirmed for rule ${ruleId}, triggering alerts`,
        );

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
    const timezone = rule.source.workspace.timezone;

    // Primary key for storing the new alert
    const dedupeKey = this.dedupeService.generateDedupeKey(
      rule.id,
      conditionIds,
      value,
      timezone,
    );

    // All keys to check (includes overlap window for midnight boundary)
    const dedupeKeysForCheck = this.dedupeService.generateDedupeKeysForCheck(
      rule.id,
      conditionIds,
      value,
      timezone,
    );

    // Check if alert should be created (deduplication + cooldown)
    const cooldownSeconds = alertPolicy.cooldownSeconds ?? 0;
    const { allowed, reason } = await this.dedupeService.shouldCreateAlert(
      rule.id,
      dedupeKeysForCheck,
      cooldownSeconds,
    );

    if (!allowed) {
      this.logger.debug(
        `[Rule ${rule.id}] Alert suppressed: ${reason}`,
      );
      return;
    }

    // Create alert record (with duplicate key handling)
    let alert;
    try {
      alert = await this.prisma.alert.create({
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
    } catch (error: any) {
      // Handle duplicate key constraint (P2002 = Prisma unique constraint violation)
      if (error?.code === 'P2002') {
        this.logger.debug(
          `[Rule ${rule.id}] Alert already exists with dedupeKey: ${dedupeKey}`,
        );
        return;
      }
      throw error;
    }

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
   * Calculate similarity between two CSS selectors
   *
   * Uses a token-based approach:
   * 1. Parse selectors into tokens (tag, class, id, attribute)
   * 2. Compare token overlap using Jaccard similarity
   *
   * @param selector1 - Primary selector
   * @param selector2 - Alternative selector
   * @returns Similarity score between 0 and 1
   */
  private calculateSelectorSimilarity(selector1: string, selector2: string): number {
    if (!selector1 || !selector2) return 0;
    if (selector1 === selector2) return 1;

    // Tokenize selectors into meaningful parts
    const tokenize = (selector: string): Set<string> => {
      const tokens = new Set<string>();

      // Extract tag names (div, span, etc.)
      const tagMatches = selector.match(/(?:^|[\s>+~])([a-z][a-z0-9]*)/gi);
      if (tagMatches) {
        tagMatches.forEach((t) => tokens.add(t.trim().toLowerCase()));
      }

      // Extract class names (.class-name)
      const classMatches = selector.match(/\.[a-z_-][a-z0-9_-]*/gi);
      if (classMatches) {
        classMatches.forEach((c) => tokens.add(c.toLowerCase()));
      }

      // Extract IDs (#id-name)
      const idMatches = selector.match(/#[a-z_-][a-z0-9_-]*/gi);
      if (idMatches) {
        idMatches.forEach((id) => tokens.add(id.toLowerCase()));
      }

      // Extract attribute selectors ([attr], [attr=value])
      const attrMatches = selector.match(/\[[^\]]+\]/g);
      if (attrMatches) {
        attrMatches.forEach((attr) => tokens.add(attr.toLowerCase()));
      }

      return tokens;
    };

    const tokens1 = tokenize(selector1);
    const tokens2 = tokenize(selector2);

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    // Calculate Jaccard similarity: intersection / union
    const intersection = new Set([...tokens1].filter((t) => tokens2.has(t)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
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
