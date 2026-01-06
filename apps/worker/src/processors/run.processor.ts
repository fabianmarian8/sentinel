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
import { FetchOrchestratorService, OrchestratorConfig } from '../services/fetch-orchestrator.service';
import { TierPolicyResolverService } from '../services/tier-policy-resolver.service';
import { WorkerConfigService } from '../config/config.service';
import { FetchRequest } from '../types/fetch-result';
import {
  smartFetch,
  extract,
  processAntiFlap,
  takeElementScreenshot,
  SCREENSHOT_PADDING_PX,
  extractWithHealing,
  createSelectorFingerprint,
  extractWithSchema,
  detectSchemaDrift,
  type SelectorFingerprint,
  type HealingResult,
} from '@sentinel/extractor';
import { getStorageClientAuto } from '@sentinel/storage';
import type {
  ExtractionConfig,
  NormalizationConfig,
  AlertPolicy,
  RuleType,
  FetchMode,
  SchemaQuery,
  SchemaFingerprint,
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
    private fetchOrchestrator: FetchOrchestratorService,
    private tierPolicyResolver: TierPolicyResolverService,
    private configService: WorkerConfigService,
  ) {
    super();
  }

  /**
   * Map provider name to FetchMode enum for DB storage
   */
  private mapProviderToFetchMode(provider: string): FetchMode {
    switch (provider) {
      case 'http':
      case 'mobile_ua':
        return 'http';
      case 'headless':
      case 'scraping_browser':
        return 'headless';
      case 'flaresolverr':
        return 'flaresolverr';
      case 'brightdata':
      case 'twocaptcha_proxy':
      case 'twocaptcha_datadome':
        return 'brightdata';
      default:
        return 'http';
    }
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

    // NOTE: Rate limiting moved to FetchOrchestrator (PR2)
    // Each provider now has its own rate limit bucket

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
      screenshotPath = join(tempDir, `screenshot-${run.id}.jpg`);
    }

    try {
      // Step 4: Fetch HTML using FetchOrchestrator (policy-driven provider selection)
      // Get extraction selector for element-only screenshots (smaller file size)
      const extraction = rule.extraction as unknown as ExtractionConfig;
      const screenshotSelector = extraction?.selector;

      // Parse cookies from fetchProfile
      const parsedCookies = rule.source.fetchProfile?.cookies
        ? (rule.source.fetchProfile.cookies as string).split(';').map(cookie => {
            const [name, value] = cookie.trim().split('=');
            return { name, value: value ?? '' };
          })
        : undefined;

      // Feature flag: TIER_POLICY_ENABLED + CANARY_WORKSPACE_IDS
      // When enabled: use TierPolicyResolver (tier defaults + legacy fields + JSONB overrides)
      // When disabled: use legacy behavior (raw FetchProfile fields + autoThrottleDisabled)
      // Canary gating: if CANARY_WORKSPACE_IDS is set, only apply to those workspaces
      const tierPolicyEnabled = this.configService.featureFlags.tierPolicyEnabled;
      const isCanaryWorkspace = this.configService.isCanaryWorkspace(rule.source.workspaceId);
      const applyTierPolicy = tierPolicyEnabled && isCanaryWorkspace;

      // Resolve tier policy from FetchProfile (only when enabled AND workspace is in canary group)
      const tierPolicy = applyTierPolicy && rule.source.fetchProfile
        ? this.tierPolicyResolver.resolveTierPolicy(rule.source.fetchProfile)
        : undefined;

      if (tierPolicyEnabled && !isCanaryWorkspace) {
        this.logger.debug(
          `[Job ${job.id}] Tier policy enabled but workspace ${rule.source.workspaceId} not in canary group, using legacy behavior`,
        );
      }

      if (applyTierPolicy && tierPolicy) {
        this.logger.debug(
          `[Job ${job.id}] Using tier policy: tier=${rule.source.fetchProfile?.domainTier}, ` +
          `allowPaid=${tierPolicy.allowPaid}, timeoutMs=${tierPolicy.timeoutMs}`,
        );
      }

      // Use tier policy timeout when enabled, otherwise legacy 60s default
      // Tier timeouts: tier_a=30s, tier_b=60s, tier_c=120s
      const defaultTimeoutMs = tierPolicy?.timeoutMs ?? 60000;

      // Build FetchRequest
      // When tier policy enabled: use resolved policy fields
      // When disabled: use legacy FetchProfile fields directly
      const fetchRequest: FetchRequest = {
        url: rule.source.url,
        workspaceId: rule.source.workspaceId,
        ruleId: ruleId,
        hostname: domain,
        timeoutMs: defaultTimeoutMs, // Base timeout - per-provider overrides in policy
        userAgent: rule.source.fetchProfile?.userAgent ?? undefined,
        headers: rule.source.fetchProfile?.headers
          ? (rule.source.fetchProfile.headers as Record<string, string>)
          : undefined,
        cookies: parsedCookies,
        renderWaitMs: rule.source.fetchProfile?.renderWaitMs ?? 2000,
        // Domain policy fields - from resolved tier policy OR legacy FetchProfile (fallback)
        // BUG FIX: Always fallback to fetchProfile fields, even when tierPolicyEnabled but workspace not in canary
        preferredProvider: tierPolicy?.preferredProvider ?? rule.source.fetchProfile?.preferredProvider ?? undefined,
        flareSolverrWaitSeconds: rule.source.fetchProfile?.flareSolverrWaitSeconds ?? undefined,
        // Disabled providers and stop behavior from resolved policy OR legacy fetchProfile
        disabledProviders: tierPolicy?.disabledProviders ?? rule.source.fetchProfile?.disabledProviders ?? [],
        stopAfterPreferredFailure: tierPolicy?.stopAfterPreferredFailure ?? rule.source.fetchProfile?.stopAfterPreferredFailure ?? false,
        // Geo pinning from resolved policy OR legacy FetchProfile
        geoCountry: tierPolicy?.geoCountry ?? rule.source.fetchProfile?.geoCountry ?? undefined,
      };

      // Build OrchestratorConfig
      // When tier policy enabled: use tierPolicy.allowPaid
      // When disabled: use legacy autoThrottleDisabled check
      const orchestratorConfig: OrchestratorConfig = {
        maxAttemptsPerRun: 5,
        allowPaid: tierPolicy?.allowPaid ?? !rule.autoThrottleDisabled,
      };

      // Execute fetch with orchestrator
      const orchestratorResult = await this.fetchOrchestrator.fetch(fetchRequest, orchestratorConfig);

      // Handle rate_limited outcome - defer job instead of failing
      // This implements "rate_limited → deferred" pattern from Oponent review
      if (orchestratorResult.final.outcome === 'rate_limited') {
        const currentRetryCount = job.data.rateLimitRetryCount ?? 0;
        const MAX_RATE_LIMIT_RETRIES = 2;

        if (currentRetryCount < MAX_RATE_LIMIT_RETRIES) {
          // Calculate delay with jitter: 60-180s base + random 0-30s
          const baseDelayMs = 60000 + (currentRetryCount * 60000); // 60s, then 120s
          const jitterMs = Math.floor(Math.random() * 30000);
          const delayMs = baseDelayMs + jitterMs;

          this.logger.warn(
            `[Job ${job.id}] Rate limited (attempt ${currentRetryCount + 1}/${MAX_RATE_LIMIT_RETRIES}), deferring ${Math.round(delayMs / 1000)}s`,
          );

          // Re-enqueue with delay (BullMQ deferred retry)
          await this.queueService.enqueueRuleRun(
            {
              ...job.data,
              trigger: 'retry',
              rateLimitRetryCount: currentRetryCount + 1,
            },
            { delay: delayMs },
          );

          // Update run record with deferred status
          await this.prisma.run.update({
            where: { id: run.id },
            data: {
              errorCode: 'RATE_LIMITED_DEFERRED',
              errorDetail: `Deferred retry ${currentRetryCount + 1}/${MAX_RATE_LIMIT_RETRIES}, delay ${Math.round(delayMs / 1000)}s`,
              finishedAt: new Date(),
            },
          });

          return {
            success: false,
            deferred: true,
            reason: 'rate_limited',
            retryCount: currentRetryCount + 1,
            delayMs,
          };
        }

        // Max retries exceeded - fall through to normal error handling
        this.logger.error(
          `[Job ${job.id}] Rate limited - max retries (${MAX_RATE_LIMIT_RETRIES}) exceeded`,
        );
      }

      // Handle timeout outcome - 1x retry with backoff
      if (orchestratorResult.final.outcome === 'timeout') {
        const currentTimeoutRetry = job.data.timeoutRetryCount ?? 0;
        const MAX_TIMEOUT_RETRIES = 1;

        if (currentTimeoutRetry < MAX_TIMEOUT_RETRIES) {
          // 30s delay for timeout retry
          const delayMs = 30000;

          this.logger.warn(
            `[Job ${job.id}] Timeout, scheduling 1x retry in ${delayMs / 1000}s`,
          );

          // Re-enqueue with delay
          await this.queueService.enqueueRuleRun(
            {
              ...job.data,
              trigger: 'retry',
              timeoutRetryCount: currentTimeoutRetry + 1,
            },
            { delay: delayMs },
          );

          // Update run record
          await this.prisma.run.update({
            where: { id: run.id },
            data: {
              errorCode: 'TIMEOUT_RETRY_SCHEDULED',
              errorDetail: `Timeout retry scheduled, delay ${delayMs / 1000}s`,
              finishedAt: new Date(),
            },
          });

          return {
            success: false,
            deferred: true,
            reason: 'timeout',
            retryCount: currentTimeoutRetry + 1,
            delayMs,
          };
        }

        // Max retries exceeded - fall through to normal error handling
        this.logger.error(
          `[Job ${job.id}] Timeout - max retries (${MAX_TIMEOUT_RETRIES}) exceeded`,
        );
      }

      // Extract HTML from result
      const fetchHtml = orchestratorResult.html || '';
      const providerUsed = orchestratorResult.final.provider;
      const httpStatus = orchestratorResult.final.httpStatus;
      const paidTierUsed = orchestratorConfig.allowPaid && (
        providerUsed === 'brightdata' ||
        providerUsed === 'scraping_browser' ||
        providerUsed === 'twocaptcha_proxy' ||
        providerUsed === 'twocaptcha_datadome'
      );

      // Step 5: Update run with fetch results
      await this.prisma.run.update({
        where: { id: run.id },
        data: {
          fetchModeUsed: this.mapProviderToFetchMode(providerUsed),
          httpStatus: httpStatus,
          errorCode: orchestratorResult.final.outcome !== 'ok' ? orchestratorResult.final.outcome.toUpperCase() : null,
          errorDetail: orchestratorResult.final.errorDetail ??
            (paidTierUsed ? `Paid tier used: ${providerUsed}` : undefined),
          blockDetected: orchestratorResult.final.outcome === 'blocked',
          contentHash: fetchHtml.length > 0
            ? createHash('sha256').update(fetchHtml).digest('hex')
            : null,
          // PR3: Store raw sample for debugging problematic fetches
          rawSample: orchestratorResult.rawSample ?? null,
        },
      });

      this.logger.log(
        `[Job ${job.id}] Fetch completed via ${providerUsed} (${orchestratorResult.attempts.length} attempts, $${orchestratorResult.final.costUsd.toFixed(4)})`,
      );

      // Handle fetch failure - if orchestrator couldn't fetch HTML, abort
      if (!fetchHtml || fetchHtml.length === 0) {
        this.logger.error(
          `[Job ${job.id}] All fetch attempts failed: ${orchestratorResult.final.outcome}`,
        );

        // Map FetchOutcome to ErrorCode
        const errorCodeMap: Record<string, string> = {
          'blocked': 'BLOCK_CAPTCHA_SUSPECTED',
          'captcha_required': 'BLOCK_CAPTCHA_SUSPECTED',
          'timeout': 'FETCH_TIMEOUT',
          'network_error': 'FETCH_CONNECTION',
          'provider_error': 'SYSTEM_WORKER_CRASH',
          'empty': 'EXTRACT_EMPTY_VALUE',
          'preferred_unavailable': 'PREFERRED_PROVIDER_UNAVAILABLE',  // P0: preferredProvider not available
          'rate_limited': 'RATE_LIMITED_MAX_RETRIES',  // Rate limited and max deferred retries exceeded
        };
        const errorCode = errorCodeMap[orchestratorResult.final.outcome] || 'UNKNOWN';

        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: errorCode as any,
          usedFallback: orchestratorResult.attempts.length > 1,
        });
        return await this.handleFetchError(run.id, {
          success: false,
          errorCode: errorCode,
          errorDetail: orchestratorResult.final.errorDetail ?? 'All providers failed',
        });
      }

      // AUTO-THROTTLE: If paid tier was used, enforce 1-day minimum interval
      // Skip if user has explicitly disabled auto-throttle
      if (paidTierUsed && !rule.captchaIntervalEnforced && !rule.autoThrottleDisabled) {
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

      // Step 6: Extract value
      // Branch based on extraction method: schema uses entity-based extraction, others use healing
      const storedFingerprint = rule.selectorFingerprint as SelectorFingerprint | null;
      const storedSchemaFingerprint = rule.schemaFingerprint as SchemaFingerprint | null;

      let extractResult: {
        success: boolean;
        value: string | null;
        selectorUsed: string;
        fallbackUsed: boolean;
        error?: string;
      };
      let selectorHealed = false;
      let healedSelector: string | null = null;
      let schemaExtractMeta: any = null;

      if (extraction.method === 'schema') {
        // Schema extraction: entity-based, no selector healing needed
        try {
          const schemaQuery: SchemaQuery = JSON.parse(extraction.selector);
          const schemaResult = extractWithSchema(fetchHtml, schemaQuery);

          extractResult = {
            success: schemaResult.success,
            value: schemaResult.rawValue,
            selectorUsed: extraction.selector,
            fallbackUsed: false,
            error: schemaResult.error,
          };
          schemaExtractMeta = schemaResult.meta;

          // Check for schema drift if we have stored fingerprint
          if (schemaResult.success && schemaResult.meta?.fingerprint && storedSchemaFingerprint) {
            const drift = detectSchemaDrift(storedSchemaFingerprint, schemaResult.meta.fingerprint);
            if (drift.drifted) {
              this.logger.warn(
                `[Job ${job.id}] Schema drift detected: ${drift.reason}`,
              );

              // Create Alert for schema drift (with dedupe + occurrence tracking)
              const newShapeHash = schemaResult.meta.fingerprint.shapeHash;
              const dedupeKey = `schema_drift:${ruleId}:${newShapeHash}`;
              const driftMetadata = {
                oldShapeHash: storedSchemaFingerprint.shapeHash,
                newShapeHash,
                oldBlockCount: storedSchemaFingerprint.jsonLdBlockCount,
                newBlockCount: schemaResult.meta.fingerprint.jsonLdBlockCount,
                reason: drift.reason ?? 'Unknown drift',
              };
              try {
                await this.prisma.alert.create({
                  data: {
                    ruleId,
                    triggeredAt: new Date(),
                    severity: 'medium',
                    alertType: 'schema_drift',
                    title: 'Schema drift detected',
                    body: drift.reason ?? 'Unknown drift',
                    metadata: driftMetadata,
                    dedupeKey,
                    channelsSent: [],
                  },
                });
                this.logger.log(`[Job ${job.id}] Schema drift alert created (dedupeKey: ${dedupeKey})`);
              } catch (error: any) {
                // Duplicate key (P2002) - update existing alert with new timestamp
                // This tracks "how often" and "when last" the drift is still happening
                if (error?.code === 'P2002') {
                  const updateResult = await this.prisma.alert.updateMany({
                    where: { dedupeKey },
                    data: {
                      triggeredAt: new Date(),
                      resolvedAt: null, // Re-open if was resolved
                      body: `${drift.reason ?? 'Unknown drift'} (recurring)`,
                      metadata: driftMetadata,
                    },
                  });
                  // Invariant check: dedupeKey is unique, so count should always be 1
                  if (updateResult.count !== 1) {
                    this.logger.warn(
                      `[Job ${job.id}] Schema drift updateMany count=${updateResult.count} (expected 1) for dedupeKey: ${dedupeKey}`,
                    );
                  }
                  this.logger.debug(`[Job ${job.id}] Schema drift alert updated (recurring, dedupeKey: ${dedupeKey})`);
                } else {
                  this.logger.error(`[Job ${job.id}] Failed to create schema drift alert: ${error.message}`);
                }
              }
            }
          }

          // Update schema fingerprint on success
          if (schemaResult.success && schemaResult.meta?.fingerprint) {
            try {
              await this.prisma.rule.update({
                where: { id: ruleId },
                data: {
                  schemaFingerprint: schemaResult.meta.fingerprint as any,
                },
              });
              this.logger.debug(
                `[Job ${job.id}] Updated schema fingerprint for rule ${ruleId}`,
              );
            } catch {
              // Non-critical - don't fail the job
            }
          }

          // If schema extraction failed, try CSS/XPath fallback selectors
          if (!schemaResult.success && extraction.fallbackSelectors?.length) {
            this.logger.debug(
              `[Job ${job.id}] Schema extraction failed, trying ${extraction.fallbackSelectors.length} fallback selectors`,
            );
            for (const fallback of extraction.fallbackSelectors) {
              const fallbackResult = await extractWithHealing(fetchHtml, {
                selector: fallback.selector,
                method: (fallback.method || 'css') as 'css' | 'xpath',
                attribute: extraction.attribute,
                fallbackSelectors: [],
                storedFingerprint: storedFingerprint || undefined,
                similarityThreshold: 0.6,
                textAnchor: storedFingerprint?.textAnchor,
                generateFingerprint: true,
              });

              if (fallbackResult.success && fallbackResult.value) {
                this.logger.log(
                  `[Job ${job.id}] Schema fallback succeeded with selector: ${fallback.selector}`,
                );
                extractResult = {
                  success: true,
                  value: fallbackResult.value,
                  selectorUsed: fallback.selector,
                  fallbackUsed: true,
                  error: undefined,
                };
                selectorHealed = fallbackResult.healed;
                healedSelector = fallbackResult.healed ? fallbackResult.selectorUsed : null;
                break;
              }
            }
          }
        } catch (parseError) {
          extractResult = {
            success: false,
            value: null,
            selectorUsed: extraction.selector,
            fallbackUsed: false,
            error: `Invalid schema query: ${parseError}`,
          };
        }
      } else {
        // CSS/XPath: Use healing module for extraction with fallbacks
        const healingResult = await extractWithHealing(fetchHtml, {
          selector: extraction.selector,
          method: extraction.method as 'css' | 'xpath',
          attribute: extraction.attribute,
          fallbackSelectors: [
            // Include extraction fallbacks
            ...(extraction.fallbackSelectors?.map((f: any) => f.selector) || []),
            // Include fingerprint alternatives
            ...(storedFingerprint?.alternativeSelectors || []),
          ],
          storedFingerprint: storedFingerprint || undefined,
          similarityThreshold: 0.6,
          textAnchor: storedFingerprint?.textAnchor,
          generateFingerprint: true,
        });

        // Convert healing result to extraction result format
        extractResult = {
          success: healingResult.success,
          value: healingResult.value,
          selectorUsed: healingResult.selectorUsed,
          fallbackUsed: healingResult.healed,
          error: healingResult.error,
        };
        selectorHealed = healingResult.healed;
        healedSelector = healingResult.healed ? healingResult.selectorUsed : null;

        // Log healing method
        if (healingResult.success) {
          if (healingResult.healingMethod === 'fingerprint') {
            this.logger.log(
              `[Job ${job.id}] Auto-healed via fingerprint matching: ${healingResult.selectorUsed} (similarity: ${((healingResult.similarity || 0) * 100).toFixed(0)}%)`,
            );
          } else if (healingResult.healingMethod === 'fallback') {
            this.logger.log(
              `[Job ${job.id}] Auto-healed via fallback selector: ${healingResult.selectorUsed}`,
            );
          }
        }

        // If healed, update rule with new selector and fingerprint
        if (selectorHealed && healedSelector) {
          try {
            const newExtraction = { ...extraction, selector: healedSelector };

            // Generate updated fingerprint with healing history
            const newFingerprint = createSelectorFingerprint(
              fetchHtml,
              healedSelector,
              healingResult.value || '',
              storedFingerprint || undefined,
            );

            // Add to healing history
            if (!newFingerprint.healingHistory) {
              newFingerprint.healingHistory = [];
            }
            newFingerprint.healingHistory.push({
              timestamp: new Date().toISOString(),
              oldSelector: extraction.selector,
              newSelector: healedSelector,
              similarity: healingResult.similarity || 0,
            });

            await this.prisma.rule.update({
              where: { id: ruleId },
              data: {
                extraction: newExtraction as any,
                selectorFingerprint: newFingerprint as any,
                lastErrorCode: null,
                lastErrorAt: null,
              },
            });

            this.logger.log(
              `[Job ${job.id}] Rule ${ruleId} auto-healed: ${extraction.selector} → ${healedSelector}`,
            );
          } catch (updateError) {
            this.logger.warn(
              `[Job ${job.id}] Failed to persist auto-healed selector: ${updateError}`,
            );
          }
        }

        // On successful extraction, update fingerprint (even if not healed)
        if (extractResult.success && !selectorHealed && healingResult.newFingerprint) {
          try {
            const updatedFingerprint = createSelectorFingerprint(
              fetchHtml,
              extraction.selector,
              extractResult.value || '',
              storedFingerprint || undefined,
            );

            await this.prisma.rule.update({
              where: { id: ruleId },
              data: {
                selectorFingerprint: updatedFingerprint as any,
              },
            });

            this.logger.debug(
              `[Job ${job.id}] Updated selector fingerprint for rule ${ruleId}`,
            );
          } catch {
            // Non-critical - don't fail the job
          }
        }
      } // end else (CSS/XPath)

      if (!extractResult.success) {
        // Use appropriate error code based on extraction method
        const errorCode = extraction.method === 'schema'
          ? 'EXTRACT_SCHEMA_NOT_FOUND'
          : 'EXTRACT_SELECTOR_NOT_FOUND';

        await this.prisma.run.update({
          where: { id: run.id },
          data: {
            errorCode,
            errorDetail: extractResult.error,
            finishedAt: new Date(),
          },
        });
        // Update health score on extraction error
        await this.healthScore.updateHealthScore({
          ruleId,
          errorCode: extraction.method === 'schema' ? 'EXTRACT_SCHEMA_NOT_FOUND' : 'SELECTOR_BROKEN',
          usedFallback: false,
        });
        this.logger.error(
          `[Job ${job.id}] Extraction failed: ${extractResult.error}`,
        );
        // DEBUG: Save HTML on extraction failure for analysis
        if (ruleId.includes('amazon') || ruleId.includes('cmjvy4nre')) {
          const debugPath = `/tmp/debug-html-${ruleId}-${Date.now()}.html`;
          const fs = await import('fs/promises');
          await fs.writeFile(debugPath, fetchHtml);
          this.logger.warn(`[Job ${job.id}] DEBUG: Saved HTML to ${debugPath} (${fetchHtml.length} bytes)`);
        }
        return { success: false, error: 'Extraction failed' };
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
      // P0-3 FIX: For schema extraction, use extracted metadata (currency, range)
      // instead of config-based normalization which ignores the actual data
      const normalization = rule.normalization as unknown as NormalizationConfig | null;
      let normalizedValue: any;

      if (extraction.method === 'schema' && schemaExtractMeta) {
        // Schema extraction: use extracted currency and range from JSON-LD/meta
        const ruleType = rule.ruleType as RuleType;

        if (ruleType === 'price') {
          const numericValue = parseFloat(extractResult.value!);
          normalizedValue = {
            value: isNaN(numericValue) ? null : numericValue,
            currency: schemaExtractMeta.currency, // Use extracted currency, not config
            valueLow: schemaExtractMeta.valueLow,
            valueHigh: schemaExtractMeta.valueHigh,
            // Cents for precise comparison (avoids float precision issues like 29.83 vs 29.829999)
            valueLowCents: schemaExtractMeta.valueLowCents,
            valueHighCents: schemaExtractMeta.valueHighCents,
            source: schemaExtractMeta.source, // 'jsonld' or 'meta'
            currencyConflict: schemaExtractMeta.currencyConflict,
            country: orchestratorResult.country, // Geo context for currency stability
          };
        } else if (ruleType === 'availability') {
          normalizedValue = {
            status: extractResult.value as any, // Already mapped to 'in_stock', 'out_of_stock', etc.
            leadTimeDays: null,
            availabilityUrl: schemaExtractMeta.availabilityUrl,
            source: schemaExtractMeta.source,
          };
        } else {
          // For other rule types, use standard normalization
          normalizedValue = normalizeValue(
            extractResult.value!,
            normalization,
            ruleType,
          );
        }
      } else {
        // CSS/XPath extraction: use config-based normalization
        normalizedValue = normalizeValue(
          extractResult.value!,
          normalization,
          rule.ruleType as RuleType,
        );
      }

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
        usedFallback: orchestratorResult.attempts.length > 1,
      });

      // Step 13: Upload screenshot if enabled
      // TODO: Integrate screenshot capture into orchestrator providers
      // For now: generate screenshot from fetched HTML when needed
      let uploadedScreenshotPath: string | null = null;

      this.logger.debug(
        `[Job ${job.id}] Screenshot check: screenshotOnChange=${screenshotOnChange}, localPath=${screenshotPath}, paidTierUsed=${paidTierUsed}`,
      );

      if (screenshotOnChange && screenshotPath && fetchHtml.length > 5000) {
        // Generate element screenshot from fetched HTML
        // Use element screenshot with SCREENSHOT_PADDING_PX context around selector
        this.logger.debug(
          `[Job ${job.id}] Generating element screenshot from HTML (selector: ${screenshotSelector || 'body'})`,
        );
        try {
          const screenshotResult = await takeElementScreenshot({
            url: rule.source.url,
            html: fetchHtml,
            outputPath: screenshotPath,
            selector: screenshotSelector || 'body',
            padding: SCREENSHOT_PADDING_PX,
            quality: 80,
          });

          if (screenshotResult.success && screenshotResult.screenshotPath) {
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
            }
          } else {
            this.logger.warn(
              `[Job ${job.id}] Screenshot generation failed: ${screenshotResult.error}`,
            );
          }
        } catch (screenshotError) {
          this.logger.warn(
            `[Job ${job.id}] Screenshot error: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`,
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

    // Determine alertType based on changeKind
    const alertType = this.mapChangeKindToAlertType(change?.changeKind);

    // Build structured metadata for queryability
    const alertMetadata = {
      changeKind: change?.changeKind,
      diffSummary: change?.diffSummary,
      oldValue: rule.state?.lastStable,
      newValue: value,
      conditionIds,
      triggeredConditions: triggeredConditions.map((c) => ({
        id: c.id,
        type: c.type,
        severity: c.severity,
      })),
    };

    // Create alert record (with duplicate key handling)
    let alert;
    try {
      alert = await this.prisma.alert.create({
        data: {
          ruleId: rule.id,
          triggeredAt: new Date(),
          severity: alertSeverity,
          alertType,
          title,
          body,
          metadata: alertMetadata,
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
  /**
   * Map ChangeKind to AlertType for structured querying
   */
  private mapChangeKindToAlertType(changeKind: string | null | undefined): 'value_changed' | 'market_context' | 'threshold_alert' | null {
    if (!changeKind) return null;

    switch (changeKind) {
      case 'value_changed':
      case 'new_value':
      case 'value_disappeared':
        return 'value_changed';
      case 'format_changed':
        // format_changed includes currency/country changes (market context)
        return 'market_context';
      case 'threshold_exceeded':
        return 'threshold_alert';
      default:
        return 'value_changed';
    }
  }

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
