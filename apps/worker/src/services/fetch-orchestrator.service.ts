/**
 * Fetch Orchestrator Service
 *
 * Policy-driven fetch provider selection with:
 * - Circuit breaker integration
 * - Budget limit enforcement
 * - Attempt logging
 * - Free-first, paid-fallback routing
 *
 * Replaces linear TieredFetch with intelligent provider selection.
 */

import { Injectable, Logger } from '@nestjs/common';
import { smartFetch, type SmartFetchOptions } from '@sentinel/extractor';
import { DomainCircuitBreakerService } from './domain-circuit-breaker.service';
import { BudgetGuardService, type BudgetPolicy } from './budget-guard.service';
import { FetchAttemptLoggerService } from './fetch-attempt-logger.service';
import { TwoCaptchaService } from './twocaptcha.service';
import { BrightDataService } from './brightdata.service';
import { ScrapingBrowserService } from './scraping-browser.service';
import { RateLimiterService } from './rate-limiter.service';
import { ConcurrencySemaphoreService } from './concurrency-semaphore.service';
import { determineFetchOutcome } from '../utils/fetch-classifiers';
import type { FetchRequest, FetchResult, ProviderId, FetchOutcome, BlockKind } from '../types/fetch-result';

export interface OrchestratorConfig {
  maxAttemptsPerRun: number;
  allowPaid: boolean;
  budgetPolicy?: BudgetPolicy;
}

export interface OrchestratorResult {
  final: FetchResult;
  attempts: FetchResult[];
  html?: string;
  rawSample?: string;  // First 50KB of HTML for debugging problematic fetches
  /** Geo context used for successful fetch (for currency stability) */
  country?: string;
}

/**
 * Raw result from provider before outcome classification
 */
interface ProviderRawResult {
  success: boolean;
  html?: string;
  costUsd: number;
  httpStatus?: number;
  latencyMs?: number;
  errorDetail?: string;
  contentType?: string;
  /** Geo context used (e.g., 'US', 'DE') - for currency stability tracking */
  country?: string;
}

type ProviderCandidate = {
  id: ProviderId;
  isPaid: boolean;
  execute: () => Promise<ProviderRawResult>;
};

@Injectable()
export class FetchOrchestratorService {
  private readonly logger = new Logger(FetchOrchestratorService.name);

  constructor(
    private readonly circuitBreaker: DomainCircuitBreakerService,
    private readonly budgetGuard: BudgetGuardService,
    private readonly attemptLogger: FetchAttemptLoggerService,
    private readonly twocaptcha: TwoCaptchaService,
    private readonly brightdata: BrightDataService,
    private readonly scrapingBrowser: ScrapingBrowserService,
    private readonly rateLimiter: RateLimiterService,
    private readonly concurrencySemaphore: ConcurrencySemaphoreService,
  ) {}

  /**
   * Execute fetch with policy-driven provider selection
   *
   * Uses unified outcome classification via determineFetchOutcome()
   * Rate limiting is applied per-provider inside the orchestrator
   */
  async fetch(req: FetchRequest, config: OrchestratorConfig): Promise<OrchestratorResult> {
    this.logger.log(`[Orchestrator] Fetching ${req.url} (maxAttempts=${config.maxAttemptsPerRun}, allowPaid=${config.allowPaid})`);

    const attempts: FetchResult[] = [];
    let finalHtml: string | undefined;
    let rawSampleHtml: string | undefined;
    let successfulCountry: string | undefined;

    // Track skip reasons to determine appropriate final outcome
    const skipReasons: { providerId: ProviderId; reason: 'circuit_breaker' | 'rate_limit' | 'concurrency' | 'budget' }[] = [];

    // Build provider candidates (free first, then paid if allowed)
    const candidates = this.buildCandidates(req, config);

    // P0: Early exit if stopAfterPreferredFailure=true and preferredProvider is unavailable
    // This prevents wasting attempts on free providers when paid provider is required but not allowed
    if (req.stopAfterPreferredFailure && req.preferredProvider) {
      const preferredAvailable = candidates.some(c => c.id === req.preferredProvider);
      if (!preferredAvailable) {
        const reason = !config.allowPaid
          ? `allowPaid=${config.allowPaid}`
          : req.disabledProviders?.includes(req.preferredProvider)
            ? `in disabledProviders`
            : 'provider not configured';

        this.logger.warn(
          `[Orchestrator] preferredProvider ${req.preferredProvider} not available (${reason}), ` +
          `early exit due to stopAfterPreferredFailure=true`
        );

        const unavailableResult: FetchResult = {
          provider: req.preferredProvider,
          outcome: 'preferred_unavailable',
          bodyBytes: 0,
          costUsd: 0,
          signals: ['preferred_provider_unavailable', reason.replace(/[=\s]/g, '_')],
          errorDetail: `Preferred provider ${req.preferredProvider} not available: ${reason}`,
        };

        // Log the attempt for tracking
        await this.attemptLogger.logAttempt({
          workspaceId: req.workspaceId,
          ruleId: req.ruleId,
          hostname: req.hostname,
          url: req.url,
          result: unavailableResult,
        });

        return {
          final: unavailableResult,
          attempts: [unavailableResult],
        };
      }
    }

    for (const candidate of candidates) {
      if (attempts.length >= config.maxAttemptsPerRun) {
        this.logger.debug(`[Orchestrator] Max attempts reached (${config.maxAttemptsPerRun})`);
        break;
      }

      // Check circuit breaker
      const canExecute = await this.circuitBreaker.canExecute(req.workspaceId, req.hostname, candidate.id);
      if (!canExecute) {
        this.logger.debug(`[Orchestrator] Circuit breaker OPEN for ${candidate.id}@${req.hostname}, skipping`);
        skipReasons.push({ providerId: candidate.id, reason: 'circuit_breaker' });
        continue;
      }

      // PR2: Rate limiting per-provider (moved from RunProcessor)
      const rateLimitResult = await this.rateLimiter.consumeToken(req.hostname, candidate.id);
      if (!rateLimitResult.allowed) {
        this.logger.debug(`[Orchestrator] Rate limit for ${candidate.id}@${req.hostname}, skipping`);
        skipReasons.push({ providerId: candidate.id, reason: 'rate_limit' });
        continue;
      }

      // Check budget for paid providers
      if (candidate.isPaid) {
        const budgetStatus = await this.budgetGuard.canSpend(
          req.workspaceId,
          req.hostname,
          candidate.id,
          req.ruleId,
          config.budgetPolicy,
        );

        if (!budgetStatus.canSpendPaid) {
          this.logger.warn(`[Orchestrator] Budget exceeded for ${candidate.id}: ${budgetStatus.reason}`);
          skipReasons.push({ providerId: candidate.id, reason: 'budget' });
          continue;
        }
      }

      // Check concurrency limit for paid providers (prevents timeout cascades)
      const leaseId = `${req.ruleId}-${Date.now()}`;
      let leaseAcquired = false;

      if (candidate.isPaid && this.concurrencySemaphore.hasConcurrencyLimit(candidate.id)) {
        const concurrencyResult = await this.concurrencySemaphore.tryAcquire(
          req.hostname,
          candidate.id,
          leaseId,
        );

        if (!concurrencyResult.acquired) {
          this.logger.debug(
            `[Orchestrator] Concurrency limit for ${candidate.id}@${req.hostname} (${concurrencyResult.currentCount} in-flight), skipping`,
          );
          skipReasons.push({ providerId: candidate.id, reason: 'concurrency' });
          continue;
        }
        leaseAcquired = true;
      }

      // Execute provider
      this.logger.log(`[Orchestrator] Trying provider: ${candidate.id}`);
      const startTime = Date.now();

      try {
        const providerResult = await candidate.execute();
        const latencyMs = providerResult.latencyMs ?? (Date.now() - startTime);

        // PR1: Use unified classifier for outcome determination
        const classification = determineFetchOutcome(
          providerResult.httpStatus,
          providerResult.html,
          providerResult.contentType,
          providerResult.errorDetail,
        );

        const fetchResult: FetchResult = {
          provider: candidate.id,
          outcome: classification.outcome,
          blockKind: classification.blockKind,
          httpStatus: providerResult.httpStatus,
          bodyText: providerResult.html,
          bodyBytes: providerResult.html?.length ?? 0,
          costUsd: providerResult.costUsd,
          latencyMs,
          errorDetail: providerResult.errorDetail,
          signals: classification.signals,
          country: providerResult.country, // Geo context for price normalization
        };

        // Log attempt
        await this.attemptLogger.logAttempt({
          workspaceId: req.workspaceId,
          ruleId: req.ruleId,
          hostname: req.hostname,
          url: req.url,
          result: fetchResult,
        });

        // Update circuit breaker
        if (classification.outcome === 'ok') {
          await this.circuitBreaker.recordSuccess(req.workspaceId, req.hostname, candidate.id);
        } else {
          await this.circuitBreaker.recordFailure(req.workspaceId, req.hostname, candidate.id, classification.outcome);
        }

        attempts.push(fetchResult);

        // Success case - return immediately
        if (classification.outcome === 'ok' && providerResult.html) {
          this.logger.log(`[Orchestrator] Success with ${candidate.id} (${latencyMs}ms, $${providerResult.costUsd.toFixed(4)})`);
          finalHtml = providerResult.html;
          successfulCountry = providerResult.country; // Track geo context for normalization
          break;
        }

        // PR3: Store raw sample for problematic outcomes (for debugging)
        if (providerResult.html && this.shouldStoreRawSample(classification.outcome)) {
          rawSampleHtml = providerResult.html;
        }

        // Non-success - continue to next provider
        this.logger.debug(`[Orchestrator] ${candidate.id} failed: ${classification.outcome} (signals: ${classification.signals.join(', ')})`);

        // PR4: Stop after preferred provider failure if configured
        if (req.stopAfterPreferredFailure && req.preferredProvider === candidate.id) {
          this.logger.log(`[Orchestrator] Preferred provider ${candidate.id} failed, stopping (stopAfterPreferredFailure=true)`);
          break;
        }

      } catch (error) {
        const err = error as Error;
        const latencyMs = Date.now() - startTime;

        this.logger.error(`[Orchestrator] ${candidate.id} exception: ${err.message}`);

        const fetchResult: FetchResult = {
          provider: candidate.id,
          outcome: 'provider_error',
          bodyBytes: 0,
          costUsd: 0,
          latencyMs,
          errorDetail: err.message,
          signals: ['exception'],
        };

        await this.attemptLogger.logAttempt({
          workspaceId: req.workspaceId,
          ruleId: req.ruleId,
          hostname: req.hostname,
          url: req.url,
          result: fetchResult,
        });

        await this.circuitBreaker.recordFailure(req.workspaceId, req.hostname, candidate.id, 'provider_error');

        attempts.push(fetchResult);

        // PR4: Stop after preferred provider failure if configured
        if (req.stopAfterPreferredFailure && req.preferredProvider === candidate.id) {
          this.logger.log(`[Orchestrator] Preferred provider ${candidate.id} failed, stopping (stopAfterPreferredFailure=true)`);
          break;
        }
      } finally {
        // Always release concurrency lease
        if (leaseAcquired) {
          await this.concurrencySemaphore.release(req.hostname, candidate.id, leaseId);
        }
      }
    }

    // Build final result
    let finalResult: FetchResult;

    if (attempts.length > 0) {
      // Use the last actual attempt
      finalResult = attempts[attempts.length - 1];
    } else {
      // No providers executed - determine why based on skip reasons
      const rateLimitSkips = skipReasons.filter(s => s.reason === 'rate_limit' || s.reason === 'concurrency');
      const budgetSkips = skipReasons.filter(s => s.reason === 'budget');
      const circuitBreakerSkips = skipReasons.filter(s => s.reason === 'circuit_breaker');

      // If any provider was skipped due to rate limiting or concurrency, return rate_limited
      // This enables deferred retry logic in run.processor.ts
      if (rateLimitSkips.length > 0) {
        const skippedProviders = rateLimitSkips.map(s => s.providerId).join(', ');
        this.logger.warn(`[Orchestrator] All providers rate limited or concurrency limited: ${skippedProviders}`);

        finalResult = {
          provider: rateLimitSkips[0].providerId,
          outcome: 'rate_limited',
          bodyBytes: 0,
          costUsd: 0,
          signals: ['providers_rate_limited', ...rateLimitSkips.map(s => `${s.providerId}_${s.reason}`)],
          errorDetail: `All providers skipped due to rate/concurrency limits: ${skippedProviders}`,
        };
      } else if (budgetSkips.length > 0) {
        // Budget exceeded
        finalResult = {
          provider: budgetSkips[0].providerId,
          outcome: 'network_error',
          bodyBytes: 0,
          costUsd: 0,
          signals: ['budget_exceeded', ...budgetSkips.map(s => `${s.providerId}_budget`)],
          errorDetail: 'Budget exceeded for all paid providers',
        };
      } else if (circuitBreakerSkips.length > 0) {
        // Circuit breaker open
        finalResult = {
          provider: circuitBreakerSkips[0].providerId,
          outcome: 'network_error',
          bodyBytes: 0,
          costUsd: 0,
          signals: ['circuit_breaker_open', ...circuitBreakerSkips.map(s => `${s.providerId}_circuit_breaker`)],
          errorDetail: 'Circuit breaker open for all providers',
        };
      } else {
        // Generic no providers available
        finalResult = {
          provider: 'http',
          outcome: 'network_error',
          bodyBytes: 0,
          costUsd: 0,
          signals: ['no_providers_available'],
          errorDetail: 'No providers available or all failed',
        };
      }
    }

    return {
      final: finalResult,
      attempts,
      html: finalHtml,
      rawSample: this.extractRawSample(finalResult, rawSampleHtml),
      country: successfulCountry, // Geo context for price normalization
    };
  }

  /**
   * PR3: Check if outcome warrants storing raw HTML sample for debugging
   */
  private shouldStoreRawSample(outcome: FetchOutcome): boolean {
    const problemOutcomes: FetchOutcome[] = ['blocked', 'captcha_required', 'empty'];
    return problemOutcomes.includes(outcome);
  }

  /**
   * PR3: Extract raw sample (max 50KB) for debugging problematic fetches
   */
  private extractRawSample(result: FetchResult, html?: string): string | undefined {
    if (!this.shouldStoreRawSample(result.outcome)) return undefined;
    if (!html) return undefined;

    const MAX_SAMPLE_SIZE = 50000;
    return html.slice(0, MAX_SAMPLE_SIZE);
  }

  /**
   * Build ordered list of provider candidates
   * Free providers first, then paid providers if allowed
   *
   * PR4: Respects disabledProviders from FetchRequest
   */
  private buildCandidates(req: FetchRequest, config: OrchestratorConfig): ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];

    // Free providers (always included unless disabled)
    candidates.push(
      {
        id: 'http',
        isPaid: false,
        execute: async () => {
          const result = await smartFetch({
            url: req.url,
            timeout: req.timeoutMs,
            headers: req.headers,
            userAgent: req.userAgent,
            preferredMode: 'http',
            fallbackToHeadless: false,
            fallbackToFlareSolverr: false,
          });

          return {
            success: result.success,
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
            contentType: result.headers?.['content-type'],
          };
        },
      },
      // NOTE: mobile_ua removed - causes price flapping due to A/B testing and mobile-specific pricing
      // If needed, configure explicitly via FetchProfile.userAgent
      {
        id: 'flaresolverr',
        isPaid: false,
        execute: async () => {
          const result = await smartFetch({
            url: req.url,
            timeout: req.timeoutMs,
            headers: req.headers,
            userAgent: req.userAgent,
            preferredMode: 'flaresolverr',
            fallbackToHeadless: false,
            flareSolverrWaitSeconds: req.flareSolverrWaitSeconds,
          });

          return {
            success: result.success,
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
            contentType: result.headers?.['content-type'],
          };
        },
      },
      {
        id: 'headless',
        isPaid: false,
        execute: async () => {
          const result = await smartFetch({
            url: req.url,
            timeout: req.timeoutMs,
            headers: req.headers,
            userAgent: req.userAgent,
            preferredMode: 'headless',
            renderWaitMs: req.renderWaitMs,
          });

          return {
            success: result.success,
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
            contentType: result.headers?.['content-type'],
          };
        },
      },
    );

    // Paid providers (only if allowed)
    if (config.allowPaid) {
      // BrightData Web Unlocker
      if (this.brightdata.isAvailable()) {
        candidates.push({
          id: 'brightdata',
          isPaid: true,
          execute: async () => {
            // Priority: FetchProfile.geoCountry -> BRIGHTDATA_COUNTRY env var -> undefined
            // FetchProfile enables per-domain geo targeting for multi-market support
            const country = req.geoCountry || process.env.BRIGHTDATA_COUNTRY || undefined;
            const result = await this.brightdata.fetch({
              url: req.url,
              timeout: req.timeoutMs,
              country,
            });

            return {
              success: result.success,
              html: result.html,
              costUsd: result.cost ?? 0,
              httpStatus: result.httpStatus,
              errorDetail: result.error,
              country, // Pass geo context for price normalization
            };
          },
        });
      }

      // Scraping Browser (higher cost, higher success rate)
      if (this.scrapingBrowser.isAvailable()) {
        candidates.push({
          id: 'scraping_browser',
          isPaid: true,
          execute: async () => {
            const result = await this.scrapingBrowser.fetch(req.url, req.timeoutMs);

            return {
              success: result.success,
              html: result.html,
              costUsd: result.cost ?? 0,
              httpStatus: result.httpStatus,
              latencyMs: result.elapsedMs,
              errorDetail: result.error,
            };
          },
        });
      }

      // 2captcha Proxy (residential proxy)
      if (this.twocaptcha.isAvailable()) {
        candidates.push({
          id: 'twocaptcha_proxy',
          isPaid: true,
          execute: async () => {
            const result = await this.twocaptcha.fetchWithProxy({
              url: req.url,
              timeout: req.timeoutMs,
              userAgent: req.userAgent,
              headers: req.headers,
            });

            return {
              success: result.success,
              html: result.html,
              costUsd: result.cost ?? 0,
              httpStatus: result.httpStatus,
              errorDetail: result.error,
            };
          },
        });
      }
    }

    // PR4: Filter out disabled providers
    let filteredCandidates = candidates;
    if (req.disabledProviders && req.disabledProviders.length > 0) {
      filteredCandidates = candidates.filter(c => !req.disabledProviders!.includes(c.id));
      this.logger.debug(`[Orchestrator] Filtered out disabled providers: ${req.disabledProviders.join(', ')}`);
    }

    // If preferredProvider is set, move it to the front (paid-first)
    if (req.preferredProvider && config.allowPaid) {
      const preferredIndex = filteredCandidates.findIndex(c => c.id === req.preferredProvider);
      if (preferredIndex > 0) {
        const [preferred] = filteredCandidates.splice(preferredIndex, 1);
        filteredCandidates.unshift(preferred);
        this.logger.log(`[Orchestrator] Preferred provider ${req.preferredProvider} moved to front (paid-first mode)`);
      }
    }

    return filteredCandidates;
  }
}
