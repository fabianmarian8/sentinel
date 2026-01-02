// Playwright headless browser fetcher with cookie consent handling
import { chromium, type Browser, type BrowserContext, type Route, type Page } from 'playwright-core';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import type { FetchResult, FetchOptions } from './types';
import type { ErrorCode } from '@sentinel/shared';
import { getRandomUserAgent } from './user-agents';

// Singleton blocker instance (loaded once, reused)
let blockerInstance: PlaywrightBlocker | null = null;
let blockerPromise: Promise<PlaywrightBlocker> | null = null;

/**
 * Get or create the adblocker instance
 * Uses Fanboy Cookie Monster list for cookie consent blocking
 */
async function getBlocker(): Promise<PlaywrightBlocker> {
  if (blockerInstance) {
    return blockerInstance;
  }

  if (blockerPromise) {
    return blockerPromise;
  }

  blockerPromise = (async () => {
    try {
      // Load blocker with cookie-focused filter lists
      const blocker = await PlaywrightBlocker.fromLists(fetch, [
        // Fanboy's Cookie Monster List - best for cookie consent
        'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
        // EasyList Cookie List
        'https://easylist-downloads.adblockplus.org/easylist-cookie.txt',
        // I don't care about cookies
        'https://www.i-dont-care-about-cookies.eu/abp/',
      ]);

      blockerInstance = blocker;
      console.log('[CookieBlocker] Initialized with cookie filter lists');
      return blocker;
    } catch (error) {
      console.error('[CookieBlocker] Failed to load filter lists:', error);
      // Return empty blocker as fallback
      blockerInstance = await PlaywrightBlocker.empty();
      return blockerInstance;
    }
  })();

  return blockerPromise;
}

export interface HeadlessFetchOptions extends Omit<FetchOptions, 'cookies'> {
  renderWaitMs?: number;      // Wait after page load (default 2000)
  waitForSelector?: string;   // Wait for specific element
  screenshotOnChange?: boolean;
  screenshotPath?: string;
  screenshotSelector?: string; // Capture only this element (smaller file size)
  screenshotQuality?: number; // JPEG quality 0-100 (default 80)
  blockResources?: ('image' | 'stylesheet' | 'font' | 'media')[];
  cookies?: { name: string; value: string; domain: string; path?: string }[];
}

/**
 * Browser pool configuration
 */
interface BrowserPoolConfig {
  maxBrowsers: number;
  maxContextsPerBrowser: number;
  browserIdleTimeoutMs: number;
}

/**
 * Browser pool entry metadata
 */
interface BrowserEntry {
  browser: Browser;
  lastUsed: number;
  contexts: number;
}

/**
 * BrowserPool manages a pool of Playwright browser instances to prevent memory leaks
 * and zombie Chromium processes.
 *
 * Key features:
 * - Max 3 browser instances
 * - Idle timeout: 5 minutes (close unused browsers)
 * - Track active contexts per browser
 * - Graceful shutdown on SIGTERM/SIGINT
 */
class BrowserPool {
  private browsers: Map<string, BrowserEntry> = new Map();
  private config: BrowserPoolConfig = {
    maxBrowsers: 3,
    maxContextsPerBrowser: 10,
    browserIdleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  };
  private cleanupInterval: NodeJS.Timeout | null = null;
  private nextBrowserId = 0;
  private isShuttingDown = false;
  private isLaunching = false;

  constructor() {
    // Start periodic cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleBrowsers().catch(err => {
        console.error('[BrowserPool] Cleanup error:', err);
      });
    }, 60000);

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      this.shutdown().catch(err => {
        console.error('[BrowserPool] Shutdown error:', err);
        process.exit(1);
      });
    });

    process.on('SIGINT', () => {
      this.shutdown().catch(err => {
        console.error('[BrowserPool] Shutdown error:', err);
        process.exit(1);
      });
    });
  }

  /**
   * Get a browser from the pool or create a new one if under limit.
   * Selects the browser with the least active contexts.
   */
  async getBrowser(): Promise<Browser> {
    if (this.isShuttingDown) {
      throw new Error('BrowserPool is shutting down');
    }

    // Try to find existing browser with capacity
    let selectedEntry: BrowserEntry | null = null;
    let selectedId: string | null = null;
    let minContexts = Infinity;

    for (const [id, entry] of this.browsers.entries()) {
      if (entry.browser.isConnected() &&
          entry.contexts < this.config.maxContextsPerBrowser &&
          entry.contexts < minContexts) {
        minContexts = entry.contexts;
        selectedEntry = entry;
        selectedId = id;
      }
    }

    if (selectedEntry && selectedId) {
      selectedEntry.contexts++;
      selectedEntry.lastUsed = Date.now();
      return selectedEntry.browser;
    }

    // Need to create new browser - use lock to prevent race
    if (this.browsers.size < this.config.maxBrowsers && !this.isLaunching) {
      this.isLaunching = true;
      try {
        const browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            // Stealth arguments to avoid bot detection
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security',
            '--ignore-certificate-errors',
            '--window-size=1920,1080',
            '--start-maximized'
          ]
        });

        const browserId = `browser-${this.nextBrowserId++}`;
        const entry: BrowserEntry = {
          browser,
          lastUsed: Date.now(),
          contexts: 1
        };

        this.browsers.set(browserId, entry);
        return browser;
      } finally {
        this.isLaunching = false;
      }
    }

    // Wait briefly and retry if at capacity
    await new Promise(resolve => setTimeout(resolve, 100));
    return this.getBrowser(); // Retry
  }

  /**
   * Release a context from a browser.
   * Decrements the context count for the browser.
   */
  releaseContext(browser: Browser): void {
    for (const [browserId, entry] of this.browsers.entries()) {
      if (entry.browser === browser) {
        entry.contexts = Math.max(0, entry.contexts - 1);
        entry.lastUsed = Date.now();

        // Check if browser is still alive
        if (!browser.isConnected()) {
          console.warn(`[BrowserPool] Browser ${browserId} disconnected, removing from pool`);
          this.browsers.delete(browserId);
        }
        return;
      }
    }
  }

  /**
   * Close browsers that have been idle for longer than the configured timeout
   * and have no active contexts.
   */
  private async cleanupIdleBrowsers(): Promise<void> {
    const now = Date.now();
    const entriesToRemove: string[] = [];

    for (const [browserId, entry] of this.browsers.entries()) {
      const idleTime = now - entry.lastUsed;
      const isIdle = idleTime > this.config.browserIdleTimeoutMs;
      const hasNoContexts = entry.contexts === 0;

      if (isIdle && hasNoContexts) {
        entriesToRemove.push(browserId);
      }
    }

    // Close idle browsers
    for (const browserId of entriesToRemove) {
      const entry = this.browsers.get(browserId);
      if (entry) {
        try {
          await entry.browser.close();
          this.browsers.delete(browserId);
          console.log(`[BrowserPool] Closed idle browser: ${browserId}`);
        } catch (err) {
          console.error(`[BrowserPool] Error closing browser ${browserId}:`, err);
        }
      }
    }
  }

  /**
   * Gracefully shut down the browser pool.
   * Closes all browsers and clears the cleanup interval.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Close all browsers
    const closePromises: Promise<void>[] = [];
    for (const [browserId, entry] of this.browsers.entries()) {
      closePromises.push(
        entry.browser.close().catch(err => {
          console.error(`[BrowserPool] Error closing browser ${browserId}:`, err);
        })
      );
    }

    await Promise.all(closePromises);
    this.browsers.clear();
    console.log('[BrowserPool] Shutdown complete');
  }
}

// Singleton browser pool
const browserPool = new BrowserPool();

/**
 * Get a browser from the pool (for compatibility)
 */
async function getBrowser(): Promise<Browser> {
  return browserPool.getBrowser();
}

/**
 * Close all browsers in the pool (for compatibility and cleanup)
 */
export async function closeBrowser(): Promise<void> {
  await browserPool.shutdown();
}

/**
 * Classify Playwright errors into ErrorCode types
 */
function classifyError(error: Error): ErrorCode {
  const msg = error.message.toLowerCase();
  if (msg.includes('timeout')) return 'FETCH_TIMEOUT';
  if (msg.includes('net::err_name_not_resolved')) return 'FETCH_DNS';
  if (msg.includes('net::err_connection')) return 'FETCH_CONNECTION';
  return 'FETCH_CONNECTION';
}

/**
 * Fetch a URL using Playwright headless browser
 * Includes cookie consent blocking and screenshot validation
 */
export async function fetchHeadless(options: HeadlessFetchOptions): Promise<FetchResult> {
  const browser = await getBrowser();
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent: options.userAgent || getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US'
    });

    // Set cookies if provided
    if (options.cookies?.length) {
      // Playwright requires either 'url' OR 'domain'+'path' for each cookie
      const playwrightCookies = options.cookies.map(cookie => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/'
      }));
      await context.addCookies(playwrightCookies);
    }

    const page = await context.newPage();
    const startTime = Date.now();

    try {
      // === LAYER 1: Enable adblocker for cookie consent scripts ===
      try {
        const blocker = await getBlocker();
        await blocker.enableBlockingInPage(page);
        console.log('[fetchHeadless] Cookie blocker enabled');
      } catch (blockerError) {
        console.warn('[fetchHeadless] Failed to enable blocker:', blockerError);
      }

      // Block unnecessary resources for speed
      if (options.blockResources?.length) {
        await page.route('**/*', (route: Route) => {
          const resourceType = route.request().resourceType();
          if (options.blockResources!.includes(resourceType as any)) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }

      // Navigate with timeout
      const response = await page.goto(options.url, {
        timeout: options.timeout || 30000,
        waitUntil: 'networkidle'
      });

      // Wait for render
      if (options.renderWaitMs) {
        await page.waitForTimeout(options.renderWaitMs);
      }

      // === LAYER 2-4: Remove any cookie banners that got through ===
      await removeCookieBanners(page);

      // Wait for specific selector
      if (options.waitForSelector) {
        await page.waitForSelector(options.waitForSelector, {
          timeout: 10000
        }).catch(() => {});  // Don't fail if selector not found
      }

      // Get HTML
      const html = await page.content();

      // Screenshot if requested
      let screenshotPath = null;
      let screenshotValidation: ScreenshotValidation | undefined;

      if (options.screenshotOnChange && options.screenshotPath) {
        // === CONTROL LAYER: Validate before screenshot ===
        screenshotValidation = await validateScreenshot(page, options.screenshotSelector);

        if (!screenshotValidation.isReadable) {
          console.warn('[fetchHeadless] Screenshot validation issues:', screenshotValidation.issues);
          // Try one more aggressive cleanup pass
          await removeCookieBanners(page);
          await page.waitForTimeout(300);
          // Re-validate
          screenshotValidation = await validateScreenshot(page, options.screenshotSelector);
        }

        // Screenshot settings - use JPEG for smaller file sizes
        const screenshotQuality = options.screenshotQuality ?? 80;
        const screenshotType = 'jpeg' as const;

        // If selector provided, screenshot element with padding (~400px = ~10cm context)
        if (options.screenshotSelector) {
          const element = await page.$(options.screenshotSelector);
          if (element) {
            // Scroll into view first
            await element.scrollIntoViewIfNeeded();
            await page.waitForTimeout(300);

            const box = await element.boundingBox();
            if (box) {
              // Add 400px padding around element for ~10cm context (clamped to viewport)
              const padding = 400;
              const viewport = page.viewportSize() || { width: 1920, height: 1080 };
              const clip = {
                x: Math.max(0, box.x - padding),
                y: Math.max(0, box.y - padding),
                width: Math.min(box.width + padding * 2, viewport.width - Math.max(0, box.x - padding)),
                height: Math.min(box.height + padding * 2, viewport.height - Math.max(0, box.y - padding)),
              };
              await page.screenshot({
                path: options.screenshotPath,
                clip,
                type: screenshotType,
                quality: screenshotQuality,
              });
            } else {
              // Element has no bounding box, screenshot element directly
              await element.screenshot({
                path: options.screenshotPath,
                type: screenshotType,
                quality: screenshotQuality,
              });
            }
            screenshotPath = options.screenshotPath;
          } else {
            // Fallback: viewport-only screenshot (NOT full page - too large/unreadable)
            await page.screenshot({
              path: options.screenshotPath,
              fullPage: false,
              type: screenshotType,
              quality: screenshotQuality,
            });
            screenshotPath = options.screenshotPath;
          }
        } else {
          // Viewport-only screenshot (NOT full page - too large/unreadable)
          await page.screenshot({
            path: options.screenshotPath,
            fullPage: false,
            type: screenshotType,
            quality: screenshotQuality,
          });
          screenshotPath = options.screenshotPath;
        }

        // Log validation result
        if (screenshotValidation && !screenshotValidation.isReadable) {
          console.warn(`[fetchHeadless] Screenshot may have issues: ${screenshotValidation.issues.join(', ')}`);
        }
      }

      const endTime = Date.now();

      return {
        success: true,
        url: options.url,
        finalUrl: page.url(),
        httpStatus: response?.status() || null,
        contentType: response?.headers()['content-type'] || null,
        html,
        errorCode: null,
        errorDetail: null,
        timings: {
          total: endTime - startTime
        },
        headers: response?.headers() || {},
        screenshotPath,
        screenshotValidation: screenshotValidation ? {
          isReadable: screenshotValidation.isReadable,
          issues: screenshotValidation.issues,
          cookieBannerDetected: screenshotValidation.cookieBannerDetected,
          overlayDetected: screenshotValidation.overlayDetected,
          contentBlocked: screenshotValidation.contentBlocked,
        } : undefined,
      };

    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        url: options.url,
        finalUrl: options.url,
        httpStatus: null,
        contentType: null,
        html: null,
        errorCode: classifyError(err),
        errorDetail: err.message,
        timings: { total: Date.now() - startTime },
        headers: {}
      };
    }
  } finally {
    // ALWAYS close context
    if (context) {
      try {
        await context.close();
      } catch (err) {
        console.error('[fetchHeadless] Error closing context:', err);
      }
    }
    // Release browser back to pool
    browserPool.releaseContext(browser);
  }
}

/**
 * Common cookie banner selectors to auto-dismiss (Accept/OK buttons)
 * Ordered by prevalence - most common first for faster detection
 */
const COOKIE_BANNER_SELECTORS = [
  // === Most common cookie consent frameworks ===
  '#onetrust-accept-btn-handler', // OneTrust (very common)
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot
  '#CybotCookiebotDialogBodyButtonAccept', // Cookiebot alternative
  '.cky-btn-accept', // CookieYes
  '.cc-btn.cc-dismiss', // Cookie Consent (osano)
  '.cc-accept-all', // Cookie Consent alternative
  '[data-consent="accept"]', // Generic data attribute
  '[data-action="accept"]', // Generic data attribute

  // === Generic patterns (high success rate) ===
  'button[id*="accept"][id*="cookie"]',
  'button[id*="accept"][id*="consent"]',
  'button[id*="accept-all"]',
  'button[id*="acceptAll"]',
  'button[class*="accept"][class*="cookie"]',
  'button[class*="accept"][class*="consent"]',
  'button[class*="accept-all"]',
  'button[class*="acceptAll"]',

  // === Data-testid patterns ===
  '[data-testid*="accept"]',
  '[data-testid*="cookie-accept"]',
  '[data-testid*="consent-accept"]',
  '[data-testid="cookies-accept-all"]',

  // === Aria label patterns ===
  'button[aria-label*="Accept"]',
  'button[aria-label*="Akceptovať"]', // Slovak
  'button[aria-label*="Súhlasím"]', // Slovak
  'button[aria-label*="Přijmout"]', // Czech
  'button[aria-label*="Zgadzam"]', // Polish

  // === Text-based patterns (less reliable but comprehensive) ===
  'button[id*="agree"]',
  'button[id*="ok-cookie"]',
  'button[class*="agree"]',
  'button[class*="consent"]',
  '.js-cookie-consent-agree',

  // === Slovak/Czech e-commerce sites ===
  '.cookies-info__button',
  '.btn-cookie-ok',
  '.cookie-accept-btn',
  '.gdpr-accept',
  '[data-gdpr="accept"]',

  // === Major retailers ===
  // Alza - cookie consent
  '[data-testid="cookies-accept-all"]',
  '.cookies-consent__button--accept',
  // Alza - "Máte IČO?" B2B promo popup (not cookie consent!)
  'button[data-testid="b2b-modal-close"]',
  'button[data-testid="b2b-popup-close"]',
  '.alza-b2b-popup button',
  '[class*="b2b"][class*="popup"] button',
  '[class*="b2b"][class*="modal"] button',
  // Nike
  '[data-testid="modal-accept-button"]',
  '.modal-actions-accept-btn',
  'button.nds-btn.modal-actions-accept-btn',
  // Amazon
  '#sp-cc-accept',
  // eBay
  '#gdpr-banner-accept',

  // === Google Funding Choices / TCF consent ===
  '.fc-cta-consent', // Funding Choices accept button
  '.fc-button.fc-cta-consent',
  '[data-fc-action="consent"]',
  'button.fc-primary-button',
  '.fc-consent-root button.fc-button',
  // SourcePoint
  'button.sp_choice_type_11', // Accept all
  'button.sp_choice_type_ACCEPT_ALL',
  '.message-component[title="Accept"]',
  '[title="SÚHLASÍM"]', // Slovak SourcePoint
  '[title="Súhlasím"]',
  '[title="ACCEPT ALL"]',
  // Didomi
  '#didomi-notice-agree-button',
  '.didomi-popup-container .didomi-button.didomi-button-highlight',
  // Quantcast
  '.qc-cmp2-summary-buttons button[mode="primary"]',
  '#qc-cmp2-ui button.css-47sehv', // Quantcast accept
  // TrustArc
  '.truste_popframe .call',
  '#truste-consent-button',
  // Consent Manager
  '.cmpboxbtn.cmpboxbtnyes',
  '#cmpwelcomebtnyes',
  // Slovak news sites specific
  '.consent-popup__accept',
  '.cmp-intro__btn--accept',
  '[data-action="consent-agree"]',
  '.privacy-message__accept',

  // === Fallback broad patterns ===
  'button[id*="accept"]',
  'button[id*="cookie"]',
  'button[class*="cookie-accept"]',
];

/**
 * Common cookie banner container selectors to hide via CSS
 * These are hidden after attempting to click accept buttons
 */
const COOKIE_BANNER_CONTAINERS = [
  // === Major frameworks ===
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '[id*="CybotCookiebot"]',
  '#cookieyes-container',
  '.cc-window', // Cookie Consent
  '#cookie-law-info-bar', // Cookie Law Info
  '#gdpr-cookie-message',

  // === Generic patterns ===
  '#cookie-consent',
  '#cookie-banner',
  '#cookie-popup',
  '#cookie-modal',
  '#cookie-notice',
  '#cookies',
  '.cookie-consent',
  '.cookie-banner',
  '.cookie-popup',
  '.cookie-modal',
  '.cookie-notice',
  '.cookies-overlay',
  '.gdpr-consent',
  '.gdpr-banner',
  '.privacy-consent',
  '.consent-banner',
  '.consent-modal',
  '.consent-popup',

  // === Attribute patterns ===
  '[class*="cookie-consent"]',
  '[class*="cookie-banner"]',
  '[class*="cookie-popup"]',
  '[class*="cookie-modal"]',
  '[class*="gdpr-"]',
  '[class*="consent-banner"]',
  '[class*="consent-modal"]',
  '[id*="cookie-consent"]',
  '[id*="cookie-banner"]',
  '[id*="gdpr"]',
  '[data-cookie-consent]',
  '[data-gdpr]',

  // === Slovak/Czech sites ===
  '.cookies-info',
  '.cookies-dialog',
  '.cookies-bar',
  '.ochrana-osobnych-udajov',
  '[class*="ochrana"]',

  // === B2B / Business promo popups (not cookie consent) ===
  '[class*="b2b"][class*="popup"]',
  '[class*="b2b"][class*="modal"]',
  '[class*="business"][class*="popup"]',
  '.alza-b2b-popup',
  '[data-testid*="b2b-modal"]',
  '[data-testid*="b2b-popup"]',

  // === Nike/major brands ===
  '[data-testid="privacy-modal"]',
  '.privacy-modal',
  '.modal-container[class*="privacy"]',

  // === Overlay/backdrop patterns ===
  '.cookie-overlay',
  '.consent-overlay',
  '.gdpr-overlay',
  '[class*="cookie"][class*="overlay"]',
  '[class*="consent"][class*="overlay"]',

  // === TCF / Google Funding Choices ===
  '.fc-consent-root',
  '.fc-dialog-container',
  '.fc-dialog-overlay',
  '[class*="fc-consent"]',
  '#sp_message_container_XXXXX', // SourcePoint dynamic ID
  '[id^="sp_message_container"]',
  '.sp-message-open',
  '.message-overlay',
  // Didomi
  '#didomi-host',
  '#didomi-popup',
  '.didomi-popup-container',
  // Quantcast
  '#qc-cmp2-container',
  '.qc-cmp2-container',
  // Google CMP iframe
  'iframe[src*="consent"]',
  'iframe[src*="gdpr"]',
  'iframe[title*="consent"]',
  'iframe[title*="cookie"]',
];

/**
 * CSS to inject for hiding cookie banners completely
 * More aggressive than just display:none
 */
const COOKIE_HIDE_CSS = `
${COOKIE_BANNER_CONTAINERS.map(s => `${s}`).join(',\n')} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  height: 0 !important;
  overflow: hidden !important;
  position: absolute !important;
  left: -9999px !important;
}

/* Remove any backdrop/overlay that might block content */
.cookie-overlay,
.consent-overlay,
.gdpr-overlay,
[class*="cookie"][class*="overlay"],
[class*="consent"][class*="backdrop"],
body.cookie-modal-open,
body.consent-modal-open,
html.cookie-modal-open {
  overflow: auto !important;
}

/* Reset any body scroll lock from cookie modals */
body[style*="overflow: hidden"],
html[style*="overflow: hidden"] {
  overflow: auto !important;
}
`;

/**
 * Result of screenshot validation
 */
export interface ScreenshotValidation {
  isReadable: boolean;
  issues: string[];
  cookieBannerDetected: boolean;
  overlayDetected: boolean;
  contentBlocked: boolean;
}

/**
 * Comprehensive cookie banner removal
 * Uses multi-layer approach:
 * 1. Adblocker blocks scripts before they load
 * 2. Click accept buttons
 * 3. Remove DOM elements
 * 4. Inject hiding CSS
 */
async function removeCookieBanners(page: Page): Promise<{ clicked: boolean; removed: number }> {
  let clicked = false;
  let removed = 0;

  try {
    // Layer 0: Try TCF API consent (most reliable for TCF-compliant sites)
    try {
      const tcfResult = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          // Check if TCF API exists
          if (typeof (window as any).__tcfapi === 'function') {
            // Try to accept all via TCF
            (window as any).__tcfapi('ping', 2, (pingResult: any) => {
              if (pingResult && pingResult.cmpLoaded) {
                // CMP is loaded, try to trigger consent
                // Different CMPs handle this differently

                // Method 1: Google Funding Choices
                if (typeof (window as any).googlefc?.callbackQueue?.push === 'function') {
                  (window as any).googlefc.callbackQueue.push({
                    CONSENT_DATA_READY: () => {
                      resolve(true);
                    }
                  });
                  return;
                }

                // Method 2: Set all purposes via __tcfapi (if supported)
                (window as any).__tcfapi('addEventListener', 2, (tcData: any, success: boolean) => {
                  if (success && tcData.eventStatus === 'useractioncomplete') {
                    resolve(true);
                  }
                });

                resolve(false);
              } else {
                resolve(false);
              }
            });
          } else {
            resolve(false);
          }

          // Timeout fallback
          setTimeout(() => resolve(false), 1000);
        });
      });

      if (tcfResult) {
        console.log('[CookieBanner] TCF API consent triggered');
        clicked = true;
        await page.waitForTimeout(500);
      }
    } catch {
      // TCF API not available or failed
    }

    // Layer 1: Try clicking accept buttons (most reliable)
    for (const selector of COOKIE_BANNER_SELECTORS) {
      try {
        const btn = await page.$(selector);
        if (btn && await btn.isVisible()) {
          try {
            await Promise.race([
              btn.click({ timeout: 2000 }),
              page.waitForNavigation({ timeout: 3000 }).catch(() => {}),
            ]);
            console.log(`[CookieBanner] Clicked accept button: ${selector}`);
            clicked = true;
            await page.waitForTimeout(500); // Wait for animation
            break;
          } catch {
            // Click failed, try next
          }
        }
      } catch {
        // Selector not found, continue
      }
    }

    // Layer 1.5: Try clicking by text content (for popups without stable selectors)
    if (!clicked) {
      const dismissTexts = [
        // Slovak B2B popup texts (Alza "Máte IČO?" etc.)
        'Nie, ďakujem',           // "No, thank you"
        'Nie',                     // "No"
        'Som súkromná osoba',      // "I'm a private person"
        'Nakupujem pre seba',      // "I'm buying for myself"
        'Pokračovať',              // "Continue"
        'Preskočiť',               // "Skip"
        // Slovak cookie consent texts
        'Rozumiem',                // "I understand"
        'Odmietnuť všetko',        // "Reject all"
        'Odmietnuť',               // "Reject"
        'Zavrieť',                 // "Close"
        'Súhlasím',                // "I agree"
        'Prijať',                  // "Accept"
        'Prijať všetko',           // "Accept all"
        // Czech equivalents
        'Ne, děkuji',              // Czech "No, thank you"
        'Jsem soukromá osoba',     // Czech "I'm a private person"
        'Odmítnout vše',           // Czech "Reject all"
        'Odmítnout',               // Czech "Reject"
        'Zavřít',                  // Czech "Close"
        'Souhlasím',               // Czech "I agree"
        // Generic
        'OK',
        'Close',
        'Dismiss',
        'Schließen',               // German "Close"
      ];

      // Try buttons first
      for (const text of dismissTexts) {
        try {
          const btn = page.getByRole('button', { name: text, exact: false });
          if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
            await btn.click({ timeout: 2000 });
            console.log(`[CookieBanner] Clicked button by text: "${text}"`);
            clicked = true;
            await page.waitForTimeout(500);
            break;
          }
        } catch {
          // Button not found or not visible, continue
        }
      }

      // Try links if no button found (some popups use <a> tags)
      if (!clicked) {
        for (const text of dismissTexts) {
          try {
            const link = page.getByRole('link', { name: text, exact: false });
            if (await link.isVisible({ timeout: 300 }).catch(() => false)) {
              await link.click({ timeout: 2000 });
              console.log(`[CookieBanner] Clicked link by text: "${text}"`);
              clicked = true;
              await page.waitForTimeout(500);
              break;
            }
          } catch {
            // Link not found or not visible, continue
          }
        }
      }

      // Try generic close button by aria-label (X buttons without text)
      if (!clicked) {
        const closeLabels = ['close', 'zavrieť', 'zavřít', 'schließen', 'fermer'];
        for (const label of closeLabels) {
          try {
            const closeBtn = page.locator(`button[aria-label*="${label}" i], [role="button"][aria-label*="${label}" i]`).first();
            if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
              await closeBtn.click({ timeout: 2000 });
              console.log(`[CookieBanner] Clicked close button by aria-label: "${label}"`);
              clicked = true;
              await page.waitForTimeout(500);
              break;
            }
          } catch {
            // Close button not found, continue
          }
        }
      }
    }

    // Layer 1.6: Retry for lazy-loaded popups (B2B promos that appear with delay)
    if (!clicked) {
      await page.waitForTimeout(1500); // Wait for lazy popups

      const lazyPopupTexts = ['Nie, ďakujem', 'Nie', 'Pokračovať', 'Preskočiť', 'Ne, děkuji'];
      for (const text of lazyPopupTexts) {
        try {
          const btn = page.getByRole('button', { name: text, exact: false });
          if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
            await btn.click({ timeout: 2000 });
            console.log(`[CookieBanner] Clicked lazy popup button: "${text}"`);
            clicked = true;
            await page.waitForTimeout(500);
            break;
          }
        } catch {
          // Button not found, continue
        }
      }
    }

    // Layer 2: Remove cookie banner elements from DOM
    // (may fail if navigation occurred from clicking accept)
    let removedCount = 0;
    try {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    } catch {
      // Ignore load state errors
    }

    try {
      removedCount = await page.evaluate((containers) => {
        let count = 0;
        for (const selector of containers) {
          try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              el.remove();
              count++;
            });
          } catch {
            // Invalid selector, skip
          }
        }

        // Also remove elements by text content (Slovak/Czech)
        const textPatterns = [
          'súhlas',
          'cookies',
          'ochrana osobných údajov',
          'súbory cookie',
          'soubory cookie',
          'gdpr',
          'privacy policy',
          'consent',
        ];

        // Find modal/dialog elements with privacy-related text
        document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, .popup, .overlay').forEach(el => {
          const text = el.textContent?.toLowerCase() || '';
          if (textPatterns.some(p => text.includes(p)) && text.length < 5000) {
            el.remove();
            count++;
          }
        });

        // Remove any fixed position elements that look like banners
        document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]').forEach(el => {
          const text = el.textContent?.toLowerCase() || '';
          if (textPatterns.some(p => text.includes(p)) && text.length < 2000) {
            (el as HTMLElement).style.display = 'none';
            count++;
          }
        });

        return count;
      }, COOKIE_BANNER_CONTAINERS);

      removed = removedCount;
    } catch {
      // Navigation may have destroyed context, continue
    }

    // Layer 3: Inject CSS to hide any remaining banners
    try {
      await page.addStyleTag({ content: COOKIE_HIDE_CSS });
    } catch {
      // May fail after navigation
    }

    // Layer 4: Reset body scroll if locked
    try {
      await page.evaluate(() => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.classList.remove('modal-open', 'cookie-modal-open', 'consent-modal-open', 'no-scroll');
      });
    } catch {
      // May fail after navigation
    }

    if (clicked || removed > 0) {
      console.log(`[CookieBanner] Removed: clicked=${clicked}, elements=${removed}`);
    }
  } catch (error) {
    console.warn('[CookieBanner] Error removing banners:', error);
  }

  return { clicked, removed };
}

/**
 * Validate screenshot for readability issues
 * Detects overlay elements, blocked content, and cookie banners
 */
async function validateScreenshot(page: Page, targetSelector?: string): Promise<ScreenshotValidation> {
  const result: ScreenshotValidation = {
    isReadable: true,
    issues: [],
    cookieBannerDetected: false,
    overlayDetected: false,
    contentBlocked: false,
  };

  try {
    const validation = await page.evaluate((args) => {
      const { targetSelector, containerSelectors } = args;
      const issues: string[] = [];
      let cookieBannerDetected = false;
      let overlayDetected = false;
      let contentBlocked = false;

      // Check for visible cookie banners
      for (const selector of containerSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el instanceof Element) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' &&
                             style.visibility !== 'hidden' &&
                             parseFloat(style.opacity) > 0 &&
                             rect.width > 0 &&
                             rect.height > 0;
            if (isVisible) {
              cookieBannerDetected = true;
              issues.push(`Cookie banner detected: ${selector}`);
            }
          }
        } catch {
          // Skip invalid selectors or detached elements
        }
      }

      // Check for overlay elements covering viewport
      const overlayElements = document.querySelectorAll(
        '[style*="position: fixed"], [style*="position:fixed"], ' +
        '[class*="overlay"], [class*="backdrop"], [class*="modal-backdrop"]'
      );

      overlayElements.forEach(el => {
        try {
          if (!(el instanceof Element)) return;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const coversScreen = rect.width >= window.innerWidth * 0.8 &&
                              rect.height >= window.innerHeight * 0.8;
          const isVisible = style.display !== 'none' &&
                           style.visibility !== 'hidden' &&
                           parseFloat(style.opacity) > 0.3;

          if (coversScreen && isVisible) {
            overlayDetected = true;
            issues.push(`Overlay element detected: ${el.className || el.id || 'unknown'}`);
          }
        } catch {
          // Element might be detached, skip
        }
      });

      // Check if target element is blocked by overlays
      if (targetSelector) {
        const target = document.querySelector(targetSelector);
        if (target) {
          const targetRect = target.getBoundingClientRect();
          const centerX = targetRect.left + targetRect.width / 2;
          const centerY = targetRect.top + targetRect.height / 2;

          // Get element at center point of target
          const elementAtPoint = document.elementFromPoint(centerX, centerY);
          if (elementAtPoint && !target.contains(elementAtPoint) && elementAtPoint !== target) {
            // Check if blocking element is an overlay/modal/popup
            const blockingClasses = elementAtPoint.className?.toLowerCase() || '';
            const blockingId = elementAtPoint.id?.toLowerCase() || '';
            const isOverlay = blockingClasses.includes('overlay') ||
                             blockingClasses.includes('modal') ||
                             blockingClasses.includes('cookie') ||
                             blockingClasses.includes('consent') ||
                             blockingClasses.includes('backdrop') ||
                             blockingClasses.includes('popup') ||
                             blockingClasses.includes('b2b') ||
                             blockingClasses.includes('promo') ||
                             blockingId.includes('modal') ||
                             blockingId.includes('popup');

            if (isOverlay) {
              contentBlocked = true;
              issues.push(`Target element blocked by: ${blockingClasses}`);
            }
          }
        }
      }

      // Check body scroll lock
      const bodyStyle = window.getComputedStyle(document.body);
      if (bodyStyle.overflow === 'hidden' || bodyStyle.position === 'fixed') {
        issues.push('Body scroll is locked (possible modal open)');
      }

      return {
        issues,
        cookieBannerDetected,
        overlayDetected,
        contentBlocked,
      };
    }, {
      targetSelector,
      containerSelectors: COOKIE_BANNER_CONTAINERS,
    });

    result.issues = validation.issues;
    result.cookieBannerDetected = validation.cookieBannerDetected;
    result.overlayDetected = validation.overlayDetected;
    result.contentBlocked = validation.contentBlocked;
    result.isReadable = !validation.cookieBannerDetected &&
                        !validation.overlayDetected &&
                        !validation.contentBlocked;

  } catch (error) {
    result.issues.push(`Validation error: ${error}`);
  }

  return result;
}

export interface FullPageScreenshotOptions {
  html: string;           // HTML content to render
  outputPath: string;     // Where to save screenshot
  quality?: number;       // JPEG quality 0-100 (default 80)
}

/**
 * Take a full-page screenshot from HTML content using setContent
 * Used when element screenshot fails but we have valid HTML from FlareSolverr
 */
export async function takeFullPageScreenshot(options: FullPageScreenshotOptions): Promise<{
  success: boolean;
  screenshotPath?: string;
  error?: string;
}> {
  const browser = await getBrowser();
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent: getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'sk-SK'
    });

    const page = await context.newPage();

    try {
      // Load HTML with setContent (CSS for hiding cookie banners already injected)
      await page.setContent(options.html, {
        timeout: 30000,
        waitUntil: 'domcontentloaded'
      });

      // Wait for styles to apply
      await page.waitForTimeout(1000);

      // Take screenshot
      const quality = options.quality ?? 80;
      await page.screenshot({
        path: options.outputPath,
        fullPage: false, // Just viewport
        type: 'jpeg',
        quality,
      });

      console.log(`[FullPageScreenshot] Captured: ${options.outputPath}`);
      return { success: true, screenshotPath: options.outputPath };

    } catch (error) {
      const err = error as Error;
      console.error(`[FullPageScreenshot] Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  } finally {
    if (context) {
      try {
        await context.close();
      } catch (err) {
        console.error('[takeFullPageScreenshot] Error closing context:', err);
      }
    }
    browserPool.releaseContext(browser);
  }
}

export interface ElementScreenshotOptions {
  url: string;
  selector: string;
  outputPath: string;
  padding?: number;        // Default 200px (~5cm context)
  timeout?: number;        // Default 30000ms
  dismissCookies?: boolean; // Default true
  userAgent?: string;
  cookies?: string;        // Cookie header string from FlareSolverr
  quality?: number;        // JPEG quality 0-100 (default 80)
  html?: string;           // Pre-fetched HTML to use instead of navigating (from FlareSolverr)
}

/**
 * Take a screenshot of a specific element with padding
 * Useful after FlareSolverr fetch when element screenshot is needed
 */
export async function takeElementScreenshot(options: ElementScreenshotOptions): Promise<{
  success: boolean;
  screenshotPath?: string;
  error?: string;
}> {
  const padding = options.padding ?? 400; // ~10cm context around element
  const dismissCookies = options.dismissCookies !== false;

  const browser = await getBrowser();
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent: options.userAgent || getRandomUserAgent(),
      viewport: { width: 1920, height: 1080 },
      locale: 'sk-SK'
    });

    // Parse and set cookies from FlareSolverr if provided
    if (options.cookies) {
      try {
        const domain = new URL(options.url).hostname;
        const cookiePairs = options.cookies.split(';').map(c => c.trim()).filter(Boolean);
        const playwrightCookies = cookiePairs.map(pair => {
          const [name, ...valueParts] = pair.split('=');
          return {
            name: (name || '').trim(),
            value: valueParts.join('=').trim(),
            domain: domain,
            path: '/'
          };
        }).filter(c => c.name && c.value);

        if (playwrightCookies.length > 0) {
          await context.addCookies(playwrightCookies);
        }
      } catch (e) {
        console.log('[ElementScreenshot] Failed to parse cookies:', e);
      }
    }

    const page = await context.newPage();

    try {
      // Enable adblocker if dismissing cookies
      if (dismissCookies) {
        try {
          const blocker = await getBlocker();
          await blocker.enableBlockingInPage(page);
        } catch (blockerError) {
          console.warn('[ElementScreenshot] Failed to enable blocker:', blockerError);
        }
      }

      // Load page content
      // Prefer setContent with HTML (has cookie-hiding CSS injected) over navigation
      // Navigation with cookies often fails due to Cloudflare blocking headless browsers
      if (options.html) {
        // Use setContent - HTML already has cookie-hiding CSS injected by FlareSolverr
        await page.setContent(options.html, {
          timeout: options.timeout || 30000,
          waitUntil: 'domcontentloaded'
        });
        console.log('[ElementScreenshot] Using pre-fetched HTML with cookie-hiding CSS');
        // Wait for JS to render (popups like "Máte IČO?" appear after JS loads)
        await page.waitForTimeout(2000);

        // Handle JS-rendered popups (B2B promos, cookie banners, etc.) - Layer 1.5 only (safe for setContent)
        // Loop multiple times to handle stacked popups (e.g., cookie popup -> B2B popup)
        if (dismissCookies) {
          const dismissTexts = [
            // Cookie consent texts
            'Rozumiem', 'Odmietnuť všetko', 'Nie, ďakujem', 'Nie', 'Zavrieť', 'Close', 'OK', 'Súhlasím', 'Prijať',
            // Slovak B2B popup texts (Alza "Máte IČO?" etc.)
            'Som súkromná osoba',      // "I'm a private person"
            'Nakupujem pre seba',      // "I'm buying for myself"
            'Pokračovať',              // "Continue"
            'Preskočiť'                // "Skip"
          ];

          // Try up to 3 rounds to dismiss stacked popups
          for (let round = 0; round < 3; round++) {
            let dismissed = false;

            // First try clicking by text content
            for (const text of dismissTexts) {
              try {
                // Use getByText instead of getByRole('button') - Alza uses <a> and <div> styled as buttons
                const element = page.getByText(text, { exact: true }).first();
                if (await element.isVisible({ timeout: 300 }).catch(() => false)) {
                  await element.click({ timeout: 2000 });
                  console.log(`[ElementScreenshot] Dismissed popup by text: "${text}" (round ${round + 1})`);
                  dismissed = true;
                  await page.waitForTimeout(500);
                  // Continue checking other texts in this round (don't break)
                }
              } catch {
                // Element not found, continue
              }
            }

            // If text-based dismissal didn't work, try CSS selectors for B2B popups
            if (!dismissed) {
              const b2bSelectors = [
                'button[data-testid="b2b-modal-close"]',
                'button[data-testid="b2b-popup-close"]',
                '.alza-b2b-popup button',
                '[class*="b2b"][class*="popup"] button',
                '[class*="b2b"][class*="modal"] button',
                '.b2b-popup button',
                '.b2b-modal button'
              ];

              for (const selector of b2bSelectors) {
                try {
                  const element = page.locator(selector).first();
                  if (await element.isVisible({ timeout: 300 }).catch(() => false)) {
                    await element.click({ timeout: 2000 });
                    console.log(`[ElementScreenshot] Dismissed B2B popup by selector: "${selector}" (round ${round + 1})`);
                    dismissed = true;
                    await page.waitForTimeout(500);
                    break; // Break after first successful dismissal
                  }
                } catch {
                  // Selector not found, continue
                }
              }
            }

            // If nothing was dismissed this round, no more popups to handle
            if (!dismissed) break;
            // Wait before next round for potential new popups to appear
            await page.waitForTimeout(300);
          }
        }
      } else if (options.cookies) {
        // Fallback: try navigation with cookies (may fail on Cloudflare sites)
        console.log('[ElementScreenshot] Navigating with FlareSolverr cookies');
        await page.goto(options.url, {
          timeout: options.timeout || 30000,
          waitUntil: 'domcontentloaded'  // Changed from networkidle - faster, less timeout issues
        });
        await page.waitForTimeout(5000);  // Wait for JS to render
      } else {
        // Navigate to page - use networkidle for SPA sites
        await page.goto(options.url, {
          timeout: options.timeout || 30000,
          waitUntil: 'networkidle'
        });
        // Wait for JS to render content
        await page.waitForTimeout(3000);
      }

      // Use comprehensive cookie banner removal
      // Skip if using pre-fetched HTML from FlareSolverr - it already has cookie-hiding CSS injected
      // IMPORTANT: removeCookieBanners() has waitForLoadState which resets DOM after setContent()
      if (dismissCookies && !options.html) {
        await removeCookieBanners(page);
      }

      // Wait for target element with retry for SPA content
      let selectorFound = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.waitForSelector(options.selector, { timeout: 5000 });
          selectorFound = true;
          break;
        } catch {
          if (attempt < 2) {
            console.log(`[ElementScreenshot] Selector not found, retry ${attempt + 1}/3: ${options.selector}`);
            await page.waitForTimeout(2000);
          }
        }
      }
      if (!selectorFound) {
        // Diagnostic: try simpler selectors to understand the structure
        const diagnostics = await page.evaluate((selector) => {
          const parts = selector.split(' ');
          const results: Record<string, number> = {};

          // Count each part separately
          parts.forEach(part => {
            try {
              results[part] = document.querySelectorAll(part).length;
            } catch {
              results[part] = -1; // Invalid selector
            }
          });

          // Also try progressive combinations
          let combined = '';
          parts.forEach((part, i) => {
            combined += (i > 0 ? ' ' : '') + part;
            try {
              results[combined] = document.querySelectorAll(combined).length;
            } catch {
              results[combined] = -1;
            }
          });

          // Check what the first <li> actually is
          const firstLi = document.querySelector('li');
          results['first li class'] = firstLi?.className ? 1 : 0;
          results['first li tag'] = firstLi?.tagName ? 1 : 0;

          // Check product list specifically
          results['.product-item-container'] = document.querySelectorAll('.product-item-container').length;
          results['.list-item'] = document.querySelectorAll('.list-item').length;
          results['.btn-text'] = document.querySelectorAll('.btn-text').length;

          return {
            counts: results,
            firstLiClass: firstLi?.className || 'no class',
            firstLiParent: firstLi?.parentElement?.className || 'no parent',
          };
        }, options.selector);

        console.log(`[ElementScreenshot] Selector not found after 3 attempts: ${options.selector}`);
        console.log(`[ElementScreenshot] Diagnostics:`, JSON.stringify(diagnostics));
      }

      // JPEG settings for smaller file sizes
      const quality = options.quality ?? 80;
      const type = 'jpeg' as const;

      // Find element and take screenshot
      const element = await page.$(options.selector);
      if (element) {
        const box = await element.boundingBox();
        if (box) {
          // Scroll element into view
          await element.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);

          // Recalculate position after scroll
          const newBox = await element.boundingBox();
          if (newBox) {
            const viewport = page.viewportSize() || { width: 1920, height: 1080 };
            const clip = {
              x: Math.max(0, newBox.x - padding),
              y: Math.max(0, newBox.y - padding),
              width: Math.min(newBox.width + padding * 2, viewport.width - Math.max(0, newBox.x - padding)),
              height: Math.min(newBox.height + padding * 2, viewport.height - Math.max(0, newBox.y - padding)),
            };

            await page.screenshot({
              path: options.outputPath,
              clip,
              type,
              quality,
            });

            console.log(`[ElementScreenshot] Captured element with ${padding}px padding: ${options.outputPath}`);
            return { success: true, screenshotPath: options.outputPath };
          }
        }

        // Fallback: screenshot element directly
        await element.screenshot({ path: options.outputPath, type, quality });
        console.log(`[ElementScreenshot] Captured element directly: ${options.outputPath}`);
        return { success: true, screenshotPath: options.outputPath };
      }

      // Element not found - return failure to trigger FlareSolverr fallback
      console.log(`[ElementScreenshot] Element not found, returning failure for FlareSolverr fallback`);
      return { success: false, error: `Selector not found: ${options.selector}` };

    } catch (error) {
      const err = error as Error;
      console.error(`[ElementScreenshot] Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  } finally {
    // ALWAYS close context
    if (context) {
      try {
        await context.close();
      } catch (err) {
        console.error('[takeElementScreenshot] Error closing context:', err);
      }
    }
    // Release browser back to pool
    browserPool.releaseContext(browser);
  }
}
