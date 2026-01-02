import { Injectable, Logger } from '@nestjs/common';
import { TwoCaptchaService } from './twocaptcha.service';
import { BrightDataService } from './brightdata.service';
import { ScrapingBrowserService } from './scraping-browser.service';
import { smartFetch, type SmartFetchOptions } from '@sentinel/extractor';
import { CircuitBreaker } from './circuit-breaker';

/**
 * Tiered Fetch Service
 *
 * GOLDEN RULE: Always try FREE options first, only use PAID as last resort!
 *
 * Tier 1 (FREE):
 * - HTTP with desktop UA
 * - HTTP with mobile UA
 * - Headless browser (Playwright)
 * - FlareSolverr (Cloudflare JS challenges)
 *
 * Tier 2 (PAID) - only when Tier 1 completely fails:
 * - 2captcha residential proxy ($0.70/GB)
 * - 2captcha DataDome API ($1.45/1000)
 *
 * When Tier 2 is used successfully, the caller should:
 * - Mark the rule as using paid services
 * - Auto-change interval to 1×/day to minimize costs
 */

export type FetchTier = 'free' | 'paid';

export interface TieredFetchResult {
  success: boolean;
  html?: string;
  httpStatus?: number;
  error?: string;
  errorCode?: string;

  // Tier tracking
  tierUsed: FetchTier;
  methodUsed:
    | 'http'
    | 'mobile_ua'
    | 'headless'
    | 'flaresolverr'
    | 'proxy'
    | 'proxy_datadome'
    | 'brightdata'
    | 'scraping_browser';
  paidServiceUsed: boolean;
  estimatedCost?: number;

  // For compatibility with SmartFetchResult
  modeUsed?: string;
  fallbackTriggered?: boolean;
  fallbackReason?: string;
  timings?: { totalMs: number };
}

export interface TieredFetchOptions {
  url: string;
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string;
  timeout?: number;
  renderWaitMs?: number;

  // Tier control
  allowPaidTier?: boolean; // Default: true. Set to false to force FREE only
  skipFreeTier?: boolean; // Default: false. Set to true to go straight to paid (NOT recommended)
}

@Injectable()
export class TieredFetchService {
  private readonly logger = new Logger(TieredFetchService.name);

  // Mobile user agents for free fallback
  private readonly mobileUserAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  ];

  // Circuit breakers for paid services
  private readonly scrapingBrowserCircuit = new CircuitBreaker({
    name: 'ScrapingBrowser',
    failureThreshold: 2, // More conservative - expensive service
    successThreshold: 1,
    cooldownMs: 10 * 60 * 1000, // 10 minutes
  });

  private readonly brightDataCircuit = new CircuitBreaker({
    name: 'BrightData',
    failureThreshold: 3,
    successThreshold: 1,
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  });

  private readonly twoCaptchaCircuit = new CircuitBreaker({
    name: '2captcha',
    failureThreshold: 3,
    successThreshold: 1,
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  });

  constructor(
    private readonly twoCaptcha: TwoCaptchaService,
    private readonly brightData: BrightDataService,
    private readonly scrapingBrowser: ScrapingBrowserService,
  ) {}

  /**
   * Fetch URL using tiered approach
   *
   * Order of operations:
   * 1. HTTP (desktop UA)
   * 2. HTTP (mobile UA) - often bypasses bot detection
   * 3. Headless browser
   * 4. FlareSolverr - for Cloudflare challenges
   * 5. [PAID] 2captcha proxy
   * 6. [PAID] 2captcha proxy + DataDome solver
   */
  async fetch(options: TieredFetchOptions): Promise<TieredFetchResult> {
    const {
      url,
      allowPaidTier = true,
      skipFreeTier = false,
      timeout = 30000,
    } = options;

    this.logger.log(`TieredFetch starting for: ${url}`);
    const startTime = Date.now();

    // =====================
    // TIER 1: FREE OPTIONS
    // =====================
    if (!skipFreeTier) {
      // Step 1: Standard smartFetch (HTTP → FlareSolverr → Headless)
      this.logger.debug(`[Tier 1.1] Trying smartFetch (HTTP → FlareSolverr → Headless)`);
      const smartResult = await smartFetch({
        url,
        timeout,
        userAgent: options.userAgent,
        headers: options.headers,
        cookies: options.cookies,
        fallbackToHeadless: true,
        fallbackToFlareSolverr: true,
        renderWaitMs: options.renderWaitMs || 2000,
      } as SmartFetchOptions);

      if (smartResult.success && !this.isBlocked(smartResult.html || '')) {
        this.logger.log(
          `[Tier 1] Success via ${smartResult.modeUsed} (${Date.now() - startTime}ms)`,
        );
        return {
          success: true,
          html: smartResult.html ?? undefined,
          httpStatus: smartResult.httpStatus ?? undefined,
          tierUsed: 'free',
          methodUsed: smartResult.modeUsed as any,
          paidServiceUsed: false,
          modeUsed: smartResult.modeUsed,
          fallbackTriggered: smartResult.fallbackTriggered,
          fallbackReason: smartResult.fallbackReason,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      // Step 2: Mobile UA fallback (often bypasses bot detection)
      this.logger.debug(`[Tier 1.2] Trying mobile UA fallback`);
      const mobileResult = await this.tryMobileUA(url, timeout);
      if (mobileResult.success && !this.isBlocked(mobileResult.html || '')) {
        this.logger.log(
          `[Tier 1] Success via mobile UA (${Date.now() - startTime}ms)`,
        );
        return {
          ...mobileResult,
          tierUsed: 'free',
          methodUsed: 'mobile_ua',
          paidServiceUsed: false,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      this.logger.warn(
        `[Tier 1] All FREE options failed for ${url}, blocked: ${this.getBlockReason(smartResult.html || mobileResult.html || '')}`,
      );
    }

    // =====================
    // TIER 2: PAID OPTIONS
    // =====================
    if (!allowPaidTier) {
      this.logger.warn(`[Tier 2] Paid tier disabled, returning failure`);
      return {
        success: false,
        error: 'All free fetch methods failed and paid tier is disabled',
        errorCode: 'FREE_TIER_EXHAUSTED',
        tierUsed: 'free',
        methodUsed: 'http',
        paidServiceUsed: false,
        timings: { totalMs: Date.now() - startTime },
      };
    }

    const hasScrapingBrowser = this.scrapingBrowser.isAvailable();
    const hasBrightData = this.brightData.isAvailable();
    const hasTwoCaptcha = this.twoCaptcha.isAvailable();

    if (!hasScrapingBrowser && !hasBrightData && !hasTwoCaptcha) {
      this.logger.warn(`[Tier 2] No paid services configured, returning failure`);
      return {
        success: false,
        error: 'Free tier failed and no paid services configured',
        errorCode: 'PAID_TIER_UNAVAILABLE',
        tierUsed: 'free',
        methodUsed: 'http',
        paidServiceUsed: false,
        timings: { totalMs: Date.now() - startTime },
      };
    }

    this.logger.log(`[Tier 2] Attempting PAID options for ${url}`);

    // Step 3: Try Scraping Browser first (strongest for DataDome/CAPTCHA)
    if (hasScrapingBrowser && this.scrapingBrowserCircuit.canExecute()) {
      this.logger.debug(`[Tier 2.0] Trying Scraping Browser (CDP + CAPTCHA solver)`);
      const browserResult = await this.scrapingBrowser.fetch(url);

      if (browserResult.success && !this.isBlocked(browserResult.html || '')) {
        this.scrapingBrowserCircuit.recordSuccess();
        this.logger.log(
          `[Tier 2] Success via Scraping Browser (~$${browserResult.cost?.toFixed(4) || '0'})` +
          (browserResult.captchaSolved ? ' [CAPTCHA solved]' : ''),
        );
        return {
          success: true,
          html: browserResult.html,
          httpStatus: browserResult.httpStatus,
          tierUsed: 'paid',
          methodUsed: 'scraping_browser',
          paidServiceUsed: true,
          estimatedCost: browserResult.cost,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      this.scrapingBrowserCircuit.recordFailure();
      this.logger.warn(
        `[Tier 2.0] Scraping Browser failed: ${browserResult.error || 'Unknown'}`,
      );
    } else if (hasScrapingBrowser) {
      const stats = this.scrapingBrowserCircuit.getStats();
      this.logger.warn(
        `[Tier 2.0] Scraping Browser circuit ${stats.state}, skipping (cooldown: ${Math.ceil(stats.cooldownRemaining / 1000)}s)`,
      );
    }

    // Step 4: Try Bright Data Web Unlocker (fallback, simpler API)
    if (hasBrightData && this.brightDataCircuit.canExecute()) {
      this.logger.debug(`[Tier 2.1] Trying Bright Data Web Unlocker`);
      const brightResult = await this.brightData.fetchWithDataDomeBypass(url);

      if (brightResult.success && !this.isBlocked(brightResult.html || '')) {
        this.brightDataCircuit.recordSuccess();
        this.logger.log(
          `[Tier 2] Success via Bright Data (~$${brightResult.cost?.toFixed(4) || '0'})`,
        );
        return {
          success: true,
          html: brightResult.html,
          httpStatus: brightResult.httpStatus,
          tierUsed: 'paid',
          methodUsed: 'brightdata',
          paidServiceUsed: true,
          estimatedCost: brightResult.cost,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      this.brightDataCircuit.recordFailure();
      this.logger.warn(
        `[Tier 2.1] Bright Data failed: ${brightResult.error || 'Unknown'}`,
      );
    } else if (hasBrightData) {
      const stats = this.brightDataCircuit.getStats();
      this.logger.warn(
        `[Tier 2.1] Bright Data circuit ${stats.state}, skipping (cooldown: ${Math.ceil(stats.cooldownRemaining / 1000)}s)`,
      );
    }

    // Step 4: Fallback to 2captcha if Bright Data failed
    if (!hasTwoCaptcha) {
      this.logger.warn(`[Tier 2] 2captcha not available as fallback`);
      return {
        success: false,
        error: 'Bright Data failed and 2captcha not configured',
        errorCode: 'BRIGHTDATA_FAILED',
        tierUsed: 'paid',
        methodUsed: 'brightdata',
        paidServiceUsed: true,
        timings: { totalMs: Date.now() - startTime },
      };
    }

    // Step 5: Try 2captcha proxy (fallback)
    if (!this.twoCaptchaCircuit.canExecute()) {
      const stats = this.twoCaptchaCircuit.getStats();
      this.logger.warn(
        `[Tier 2.2] 2captcha circuit ${stats.state}, cannot execute (cooldown: ${Math.ceil(stats.cooldownRemaining / 1000)}s)`,
      );
      return {
        success: false,
        error: '2captcha circuit breaker open',
        errorCode: 'CIRCUIT_BREAKER_OPEN',
        tierUsed: 'paid',
        methodUsed: 'proxy',
        paidServiceUsed: false,
        timings: { totalMs: Date.now() - startTime },
      };
    }

    this.logger.debug(`[Tier 2.2] Trying 2captcha residential proxy`);
    const proxyResult = await this.twoCaptcha.fetchWithProxy({
      url,
      timeout,
      userAgent: options.userAgent,
      headers: options.headers,
    });

    if (proxyResult.success && !this.isBlocked(proxyResult.html || '')) {
      this.twoCaptchaCircuit.recordSuccess();
      this.logger.log(
        `[Tier 2] Success via 2captcha proxy (~$${proxyResult.cost?.toFixed(6) || '0'})`,
      );
      return {
        success: true,
        html: proxyResult.html,
        httpStatus: proxyResult.httpStatus,
        tierUsed: 'paid',
        methodUsed: 'proxy',
        paidServiceUsed: true,
        estimatedCost: proxyResult.cost,
        timings: { totalMs: Date.now() - startTime },
      };
    }

    this.twoCaptchaCircuit.recordFailure();

    // Step 6: If still blocked by DataDome, use 2captcha DataDome bypass
    const lastHtml = proxyResult.html || '';
    if (this.twoCaptcha.isDataDomeBlocked(lastHtml)) {
      this.logger.debug(`[Tier 2.3] DataDome detected, trying 2captcha DataDome bypass`);

      const captchaUrl = this.twoCaptcha.extractDataDomeCaptchaUrl(lastHtml);
      if (captchaUrl) {
        const dataDomeResult = await this.twoCaptcha.fetchWithDataDomeBypass(
          url,
          captchaUrl,
        );

        if (
          dataDomeResult.success &&
          !this.isBlocked(dataDomeResult.html || '')
        ) {
          this.logger.log(
            `[Tier 2] Success via DataDome bypass (~$${dataDomeResult.cost?.toFixed(4) || '0'})`,
          );
          return {
            success: true,
            html: dataDomeResult.html,
            httpStatus: dataDomeResult.httpStatus,
            tierUsed: 'paid',
            methodUsed: 'proxy_datadome',
            paidServiceUsed: true,
            estimatedCost: dataDomeResult.cost,
            timings: { totalMs: Date.now() - startTime },
          };
        }
      } else {
        this.logger.warn(`[Tier 2] DataDome detected but captcha URL not found`);
      }
    }

    // All tiers exhausted
    this.logger.error(`[Tier 2] All fetch methods exhausted for ${url}`);
    return {
      success: false,
      error: 'All fetch methods (free and paid) failed',
      errorCode: 'ALL_TIERS_EXHAUSTED',
      tierUsed: 'paid',
      methodUsed: 'proxy_datadome',
      paidServiceUsed: true,
      estimatedCost: proxyResult.cost,
      timings: { totalMs: Date.now() - startTime },
    };
  }

  /**
   * Try fetching with mobile user agent
   * This often bypasses simple bot detection
   */
  private async tryMobileUA(
    url: string,
    timeout: number,
  ): Promise<{ success: boolean; html?: string; httpStatus?: number; error?: string }> {
    for (const ua of this.mobileUserAgents) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': ua,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
          },
          signal: AbortSignal.timeout(timeout),
        });

        const html = await response.text();

        // If we got substantial content, return it
        if (response.ok && html.length > 5000) {
          return {
            success: true,
            html,
            httpStatus: response.status,
          };
        }
      } catch (error) {
        // Continue to next UA
        continue;
      }
    }

    return {
      success: false,
      error: 'All mobile UAs failed',
    };
  }

  /**
   * Check if HTML indicates a blocked response
   */
  private isBlocked(html: string): boolean {
    if (html.length < 5000) {
      const htmlLower = html.toLowerCase();
      return (
        htmlLower.includes('datadome') ||
        htmlLower.includes('captcha') ||
        htmlLower.includes('cloudflare') ||
        htmlLower.includes('access denied') ||
        htmlLower.includes('blocked') ||
        htmlLower.includes('captcha-delivery.com') ||
        htmlLower.includes('checking your browser') ||
        htmlLower.includes('ray id')
      );
    }
    return false;
  }

  /**
   * Get human-readable block reason from HTML
   */
  private getBlockReason(html: string): string {
    const htmlLower = html.toLowerCase();
    if (htmlLower.includes('datadome')) return 'DataDome';
    if (htmlLower.includes('cloudflare')) return 'Cloudflare';
    if (htmlLower.includes('captcha')) return 'CAPTCHA';
    if (htmlLower.includes('access denied')) return 'Access Denied';
    if (htmlLower.includes('blocked')) return 'Blocked';
    if (html.length < 2000) return `Suspiciously small response (${html.length} bytes)`;
    return 'Unknown';
  }
}
