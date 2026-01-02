import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright-core';

/**
 * BrightData Scraping Browser Service
 *
 * Uses BrightData's Scraping Browser for advanced DataDome/CAPTCHA bypass.
 * Connects via CDP WebSocket for full browser control.
 *
 * Pricing: ~$0.009/min (~$0.02-0.05 per page with CAPTCHA)
 *
 * Features:
 * - Full Chromium browser with CDP control
 * - Automatic CAPTCHA solving via Captcha.solve events
 * - Higher success rate for DataDome than Web Unlocker
 *
 * @see https://docs.brightdata.com/scraping-automation/scraping-browser/introduction
 */

export interface ScrapingBrowserResult {
  success: boolean;
  html?: string;
  httpStatus?: number;
  error?: string;
  cost?: number;
  captchaSolved?: boolean;
  elapsedMs?: number;
}

@Injectable()
export class ScrapingBrowserService {
  private readonly logger = new Logger(ScrapingBrowserService.name);

  // Connection details from environment
  private readonly customerId: string;
  private readonly zone: string;
  private readonly password: string;
  private readonly wsEndpoint: string;

  // Cost tracking (~$0.009/min = $0.00015/sec)
  private readonly costPerSecond = 0.00015;

  constructor() {
    this.customerId = process.env.BRIGHTDATA_BROWSER_CUSTOMER_ID || '';
    this.zone = process.env.BRIGHTDATA_BROWSER_ZONE || 'scraping_browser1';
    this.password = process.env.BRIGHTDATA_BROWSER_PASSWORD || '';

    // Build WebSocket endpoint
    // Format: wss://brd-customer-{ID}-zone-{ZONE}:{PASS}@brd.superproxy.io:9222
    if (this.customerId && this.password) {
      const auth = `brd-customer-${this.customerId}-zone-${this.zone}:${this.password}`;
      this.wsEndpoint = `wss://${auth}@brd.superproxy.io:9222`;
      this.logger.log(`Scraping Browser initialized with zone: ${this.zone}`);
    } else {
      this.wsEndpoint = '';
      this.logger.warn('BRIGHTDATA_BROWSER_* not set - Scraping Browser unavailable');
    }
  }

  /**
   * Check if Scraping Browser is available
   */
  isAvailable(): boolean {
    return !!this.wsEndpoint;
  }

  /**
   * Fetch URL using BrightData Scraping Browser
   *
   * Flow:
   * 1. Connect to remote browser via CDP WebSocket
   * 2. Create new page and navigate
   * 3. Wait for CAPTCHA events if triggered
   * 4. Get HTML content
   * 5. Cleanup and return
   */
  async fetch(url: string, timeout = 90000): Promise<ScrapingBrowserResult> {
    if (!this.wsEndpoint) {
      return {
        success: false,
        error: 'SCRAPING_BROWSER_NOT_CONFIGURED',
      };
    }

    this.logger.log(`[ScrapingBrowser] Fetching: ${url}`);
    const startTime = Date.now();

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let cdpSession: CDPSession | null = null;

    try {
      // Connect to BrightData's remote browser via CDP
      this.logger.debug(`[ScrapingBrowser] Connecting to remote browser...`);
      browser = await chromium.connectOverCDP(this.wsEndpoint, {
        timeout: 30000,
      });

      // Create context and page
      context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
      });
      page = await context.newPage();

      // Set up CDP session for CAPTCHA events
      cdpSession = await page.context().newCDPSession(page);

      // Track CAPTCHA solving
      let captchaDetected = false;
      let captchaSolved = false;
      let captchaFailed = false;

      // Listen for CAPTCHA events (BrightData custom CDP events)
      // Cast to any since these are custom events not in Playwright's type definitions
      const cdp = cdpSession as unknown as {
        on(event: string, handler: (event: unknown) => void): void;
        off(event: string, handler: (event: unknown) => void): void;
      };

      cdp.on('Captcha.detected', (event) => {
        this.logger.log(`[ScrapingBrowser] CAPTCHA detected: ${JSON.stringify(event)}`);
        captchaDetected = true;
      });

      cdp.on('Captcha.solveFinished', (event) => {
        this.logger.log(`[ScrapingBrowser] CAPTCHA solved: ${JSON.stringify(event)}`);
        captchaSolved = true;
      });

      cdp.on('Captcha.solveFailed', (event) => {
        this.logger.warn(`[ScrapingBrowser] CAPTCHA solve failed: ${JSON.stringify(event)}`);
        captchaFailed = true;
      });

      // Navigate with extended timeout for CAPTCHA solving
      this.logger.debug(`[ScrapingBrowser] Navigating to: ${url}`);
      const response = await page.goto(url, {
        timeout,
        waitUntil: 'domcontentloaded',
      });

      // If CAPTCHA was detected, wait for resolution
      if (captchaDetected && !captchaSolved && !captchaFailed) {
        this.logger.log(`[ScrapingBrowser] Waiting for CAPTCHA resolution...`);
        await this.waitForCaptchaResolution(cdpSession, 60000);
        captchaSolved = true;
      }

      // Wait a bit for page to stabilize after CAPTCHA
      if (captchaSolved) {
        await page.waitForTimeout(2000);
      }

      // Get HTML content
      const html = await page.content();
      const elapsed = Date.now() - startTime;
      const cost = (elapsed / 1000) * this.costPerSecond;

      this.logger.log(
        `[ScrapingBrowser] Response: ${html.length} bytes in ${elapsed}ms (~$${cost.toFixed(4)})` +
        (captchaSolved ? ' [CAPTCHA solved]' : '')
      );

      // Validate response isn't still blocked
      if (this.isBlocked(html)) {
        this.logger.warn(`[ScrapingBrowser] Response appears blocked despite solving`);
        return {
          success: false,
          html,
          error: 'SCRAPING_BROWSER_STILL_BLOCKED',
          httpStatus: response?.status(),
          cost,
          captchaSolved,
          elapsedMs: elapsed,
        };
      }

      return {
        success: true,
        html,
        httpStatus: response?.status() || 200,
        cost,
        captchaSolved,
        elapsedMs: elapsed,
      };

    } catch (error) {
      const err = error as Error;
      const elapsed = Date.now() - startTime;
      const cost = (elapsed / 1000) * this.costPerSecond;

      this.logger.error(`[ScrapingBrowser] Error: ${err.message}`);

      // Classify error
      if (err.message.includes('timeout') || err.name === 'TimeoutError') {
        return {
          success: false,
          error: 'SCRAPING_BROWSER_TIMEOUT',
          cost,
          elapsedMs: elapsed,
        };
      }

      if (err.message.includes('connect') || err.message.includes('WebSocket')) {
        return {
          success: false,
          error: 'SCRAPING_BROWSER_CONNECTION_FAILED',
          cost: 0, // No cost if couldn't connect
          elapsedMs: elapsed,
        };
      }

      return {
        success: false,
        error: `SCRAPING_BROWSER_ERROR: ${err.message}`,
        cost,
        elapsedMs: elapsed,
      };

    } finally {
      // Cleanup in reverse order
      if (cdpSession) {
        try {
          await cdpSession.detach();
        } catch {
          // Ignore detach errors
        }
      }
      if (page) {
        try {
          await page.close();
        } catch {
          // Ignore close errors
        }
      }
      if (context) {
        try {
          await context.close();
        } catch {
          // Ignore close errors
        }
      }
      if (browser) {
        try {
          await browser.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Wait for CAPTCHA to be solved or fail
   */
  private waitForCaptchaResolution(cdpSession: CDPSession, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('CAPTCHA solve timeout'));
      }, timeout);

      // Cast to typed CDP for custom BrightData events
      const cdp = cdpSession as unknown as {
        on(event: string, handler: (event?: unknown) => void): void;
        off(event: string, handler: (event?: unknown) => void): void;
      };

      const onSolved = () => {
        clearTimeout(timer);
        cdp.off('Captcha.solveFinished', onSolved);
        cdp.off('Captcha.solveFailed', onFailed);
        resolve();
      };

      const onFailed = (event: unknown) => {
        clearTimeout(timer);
        cdp.off('Captcha.solveFinished', onSolved);
        cdp.off('Captcha.solveFailed', onFailed);
        reject(new Error(`CAPTCHA solve failed: ${JSON.stringify(event)}`));
      };

      cdp.on('Captcha.solveFinished', onSolved);
      cdp.on('Captcha.solveFailed', onFailed);
    });
  }

  /**
   * Check if HTML indicates blocked response
   */
  private isBlocked(html: string): boolean {
    const htmlLower = html.toLowerCase();

    // CAPTCHA indicators
    const captchaPatterns = [
      'nie s robotom',
      'not a robot',
      'geo.captcha-delivery.com',
      'captcha-delivery.com/captcha',
      'posunutím doprava zložte puzzle',
      'slide to complete the puzzle',
    ];

    for (const pattern of captchaPatterns) {
      if (htmlLower.includes(pattern)) {
        return true;
      }
    }

    // Small response with block indicators
    if (html.length < 5000) {
      return (
        htmlLower.includes('access denied') ||
        htmlLower.includes('blocked') ||
        htmlLower.includes('captcha')
      );
    }

    return false;
  }
}
