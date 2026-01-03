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
import type { FetchRequest, FetchResult, ProviderId, FetchOutcome } from '../types/fetch-result';

export interface OrchestratorConfig {
  maxAttemptsPerRun: number;
  allowPaid: boolean;
  budgetPolicy?: BudgetPolicy;
}

export interface OrchestratorResult {
  final: FetchResult;
  attempts: FetchResult[];
  html?: string;
}

type ProviderCandidate = {
  id: ProviderId;
  isPaid: boolean;
  execute: () => Promise<{ outcome: FetchOutcome; html?: string; costUsd: number; httpStatus?: number; latencyMs?: number; errorDetail?: string }>;
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
  ) {}

  /**
   * Execute fetch with policy-driven provider selection
   */
  async fetch(req: FetchRequest, config: OrchestratorConfig): Promise<OrchestratorResult> {
    this.logger.log(`[Orchestrator] Fetching ${req.url} (maxAttempts=${config.maxAttemptsPerRun}, allowPaid=${config.allowPaid})`);

    const attempts: FetchResult[] = [];
    let finalHtml: string | undefined;

    // Build provider candidates (free first, then paid if allowed)
    const candidates = this.buildCandidates(req, config);

    for (const candidate of candidates) {
      if (attempts.length >= config.maxAttemptsPerRun) {
        this.logger.debug(`[Orchestrator] Max attempts reached (${config.maxAttemptsPerRun})`);
        break;
      }

      // Check circuit breaker
      const canExecute = await this.circuitBreaker.canExecute(req.workspaceId, req.hostname, candidate.id);
      if (!canExecute) {
        this.logger.debug(`[Orchestrator] Circuit breaker OPEN for ${candidate.id}@${req.hostname}, skipping`);
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
          continue;
        }
      }

      // Execute provider
      this.logger.log(`[Orchestrator] Trying provider: ${candidate.id}`);
      const startTime = Date.now();

      try {
        const providerResult = await candidate.execute();
        const latencyMs = providerResult.latencyMs ?? (Date.now() - startTime);

        const fetchResult: FetchResult = {
          provider: candidate.id,
          outcome: providerResult.outcome,
          httpStatus: providerResult.httpStatus,
          bodyText: providerResult.html,
          bodyBytes: providerResult.html?.length ?? 0,
          costUsd: providerResult.costUsd,
          latencyMs,
          errorDetail: providerResult.errorDetail,
          signals: [],
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
        if (providerResult.outcome === 'ok') {
          await this.circuitBreaker.recordSuccess(req.workspaceId, req.hostname, candidate.id);
        } else {
          await this.circuitBreaker.recordFailure(req.workspaceId, req.hostname, candidate.id, providerResult.outcome);
        }

        attempts.push(fetchResult);

        // Success case - return immediately
        if (providerResult.outcome === 'ok' && providerResult.html) {
          this.logger.log(`[Orchestrator] Success with ${candidate.id} (${latencyMs}ms, $${providerResult.costUsd.toFixed(4)})`);
          finalHtml = providerResult.html;
          break;
        }

        // Non-success - continue to next provider
        this.logger.debug(`[Orchestrator] ${candidate.id} failed: ${providerResult.outcome}`);

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
          signals: [],
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
      }
    }

    // Build final result
    const finalResult: FetchResult = attempts[attempts.length - 1] ?? {
      provider: 'http',
      outcome: 'network_error',
      bodyBytes: 0,
      costUsd: 0,
      signals: [],
      errorDetail: 'No providers available or all failed',
    };

    return {
      final: finalResult,
      attempts,
      html: finalHtml,
    };
  }

  /**
   * Build ordered list of provider candidates
   * Free providers first, then paid providers if allowed
   */
  private buildCandidates(req: FetchRequest, config: OrchestratorConfig): ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];

    // Free providers (always included)
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
            outcome: this.mapToOutcome(result),
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
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
            outcome: this.mapToOutcome(result),
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
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
            outcome: this.mapToOutcome(result),
            html: result.html ?? undefined,
            costUsd: 0,
            httpStatus: result.httpStatus ?? undefined,
            latencyMs: result.timings.total,
            errorDetail: result.errorDetail ?? undefined,
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
            const result = await this.brightdata.fetch({
              url: req.url,
              timeout: req.timeoutMs,
            });

            return {
              outcome: result.success ? 'ok' : 'provider_error',
              html: result.html,
              costUsd: result.cost ?? 0,
              httpStatus: result.httpStatus,
              errorDetail: result.error,
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
              outcome: result.success ? 'ok' : 'provider_error',
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
              outcome: result.success ? 'ok' : 'provider_error',
              html: result.html,
              costUsd: result.cost ?? 0,
              httpStatus: result.httpStatus,
              errorDetail: result.error,
            };
          },
        });
      }
    }

    // If preferredProvider is set and it's a paid provider, move it to the front (paid-first)
    if (req.preferredProvider && config.allowPaid) {
      const preferredIndex = candidates.findIndex(c => c.id === req.preferredProvider);
      if (preferredIndex > 0) {
        const [preferred] = candidates.splice(preferredIndex, 1);
        candidates.unshift(preferred);
        this.logger.log(`[Orchestrator] Preferred provider ${req.preferredProvider} moved to front (paid-first mode)`);
      }
    }

    return candidates;
  }

  /**
   * Map smartFetch result to FetchOutcome
   * IMPORTANT: Checks HTML content for block pages even if success=true
   */
  private mapToOutcome(result: { success: boolean; errorCode: string | null; html: string | null }): FetchOutcome {
    // Check for known error codes first
    if (result.errorCode === 'CLOUDFLARE_BLOCK' || result.errorCode === 'DATADOME_BLOCK') {
      return 'blocked';
    }

    if (result.errorCode === 'TIMEOUT' || result.errorCode === 'NETWORK_TIMEOUT') {
      return 'timeout';
    }

    if (result.errorCode === 'EMPTY_RESPONSE') {
      return 'empty';
    }

    // Even if success=true, check HTML for block pages (DataDome, Cloudflare challenge pages)
    if (result.html) {
      const blockCheck = this.checkForBlockPage(result.html);
      if (blockCheck.isBlocked) {
        this.logger.warn(`[Orchestrator] Block page detected: ${blockCheck.kind} (${blockCheck.signals.join(', ')})`);
        return 'blocked';
      }
      return 'ok';
    }

    return 'network_error';
  }

  /**
   * Check HTML content for block pages (DataDome, Cloudflare, etc.)
   */
  private checkForBlockPage(html: string): { isBlocked: boolean; kind: string; signals: string[] } {
    const lower = html.toLowerCase();
    const signals: string[] = [];

    // DataDome detection (Etsy, etc.)
    if (
      lower.includes('datadome') ||
      lower.includes('captcha-delivery.com') ||
      lower.includes('geo.captcha-delivery.com') ||
      lower.includes('datadome device check')
    ) {
      signals.push('datadome_challenge');
      return { isBlocked: true, kind: 'datadome', signals };
    }

    // Cloudflare challenge
    if (
      lower.includes('cf-browser-verification') ||
      (lower.includes('cloudflare') && lower.includes('checking your browser'))
    ) {
      signals.push('cloudflare_challenge');
      return { isBlocked: true, kind: 'cloudflare', signals };
    }

    // Generic CAPTCHA
    if (
      lower.includes('captcha') &&
      html.length < 10000  // Challenge pages are small
    ) {
      signals.push('captcha_page');
      return { isBlocked: true, kind: 'captcha', signals };
    }

    return { isBlocked: false, kind: '', signals: [] };
  }
}
