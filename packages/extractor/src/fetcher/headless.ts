// Playwright headless browser fetcher
import { chromium, type Browser } from 'playwright-core';
import type { FetchResult, FetchOptions } from './types';
import type { ErrorCode } from '@sentinel/shared';
import { getRandomUserAgent } from './user-agents';

export interface HeadlessFetchOptions extends Omit<FetchOptions, 'cookies'> {
  renderWaitMs?: number;      // Wait after page load (default 2000)
  waitForSelector?: string;   // Wait for specific element
  screenshotOnChange?: boolean;
  screenshotPath?: string;
  screenshotSelector?: string; // Capture only this element (smaller file size)
  blockResources?: ('image' | 'stylesheet' | 'font' | 'media')[];
  cookies?: { name: string; value: string; domain: string; path?: string }[];
}

// Singleton browser instance for efficiency
let browserInstance: Browser | null = null;

/**
 * Get or create browser instance
 */
async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
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
  }
  return browserInstance;
}

/**
 * Close the browser instance (for cleanup)
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Cleanup on process exit
 */
process.on('exit', async () => {
  await closeBrowser();
});

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
 */
export async function fetchHeadless(options: HeadlessFetchOptions): Promise<FetchResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
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
    // Block unnecessary resources for speed
    if (options.blockResources?.length) {
      await page.route('**/*', (route) => {
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
    if (options.screenshotOnChange && options.screenshotPath) {
      // If selector provided, screenshot element with padding (~200px = ~5cm context)
      if (options.screenshotSelector) {
        const element = await page.$(options.screenshotSelector);
        if (element) {
          const box = await element.boundingBox();
          if (box) {
            // Add 200px padding around element (clamped to viewport)
            const padding = 200;
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
            });
          } else {
            // Element has no bounding box, screenshot element directly
            await element.screenshot({
              path: options.screenshotPath,
            });
          }
          screenshotPath = options.screenshotPath;
        } else {
          // Fallback to full page if element not found
          await page.screenshot({
            path: options.screenshotPath,
            fullPage: true
          });
          screenshotPath = options.screenshotPath;
        }
      } else {
        // Full page screenshot
        await page.screenshot({
          path: options.screenshotPath,
          fullPage: true
        });
        screenshotPath = options.screenshotPath;
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
      screenshotPath
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
  } finally {
    await context.close();
  }
}

/**
 * Common cookie banner selectors to auto-dismiss
 */
const COOKIE_BANNER_SELECTORS = [
  // Common cookie consent buttons (accept/agree)
  'button[id*="accept"]',
  'button[id*="agree"]',
  'button[id*="cookie"]',
  'button[class*="accept"]',
  'button[class*="agree"]',
  'button[class*="cookie-accept"]',
  'button[class*="consent"]',
  '[data-testid*="accept"]',
  '[data-testid*="cookie"]',
  // Common frameworks
  '.cc-btn.cc-dismiss', // Cookie Consent
  '.cky-btn-accept', // CookieYes
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', // Cookiebot
  '#onetrust-accept-btn-handler', // OneTrust
  '.js-cookie-consent-agree', // Generic
  // Alza-specific
  '.cookies-info__button',
  '[data-testid="cookies-accept-all"]',
  '.btn-cookie-ok',
];

/**
 * Common cookie banner container selectors to hide
 */
const COOKIE_BANNER_CONTAINERS = [
  '#cookie-consent',
  '#cookie-banner',
  '#cookies',
  '.cookie-consent',
  '.cookie-banner',
  '.cookies-overlay',
  '.gdpr-consent',
  '[class*="cookie-consent"]',
  '[class*="cookie-banner"]',
  '[id*="cookie-consent"]',
  '[id*="CybotCookiebot"]',
  '#onetrust-consent-sdk',
  // Alza-specific
  '.cookies-info',
  '.cookies-dialog',
];

export interface ElementScreenshotOptions {
  url: string;
  selector: string;
  outputPath: string;
  padding?: number;        // Default 200px (~5cm context)
  timeout?: number;        // Default 30000ms
  dismissCookies?: boolean; // Default true
  userAgent?: string;
  cookies?: string;        // Cookie header string from FlareSolverr
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
  const padding = options.padding ?? 200;
  const dismissCookies = options.dismissCookies !== false;

  const browser = await getBrowser();
  const context = await browser.newContext({
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
    // Navigate to page
    await page.goto(options.url, {
      timeout: options.timeout || 30000,
      waitUntil: 'domcontentloaded'
    });

    // Wait a bit for page to render
    await page.waitForTimeout(2000);

    // Try to dismiss cookie banners
    if (dismissCookies) {
      // First try clicking accept buttons
      for (const selector of COOKIE_BANNER_SELECTORS) {
        try {
          const btn = await page.$(selector);
          if (btn && await btn.isVisible()) {
            await btn.click();
            console.log(`[ElementScreenshot] Clicked cookie button: ${selector}`);
            await page.waitForTimeout(500);
            break;
          }
        } catch {
          // Ignore, try next
        }
      }

      // Then hide any remaining banners via CSS
      await page.addStyleTag({
        content: COOKIE_BANNER_CONTAINERS.map(s => `${s} { display: none !important; }`).join('\n')
      });
    }

    // Wait for target element
    try {
      await page.waitForSelector(options.selector, { timeout: 10000 });
    } catch {
      console.log(`[ElementScreenshot] Selector not found: ${options.selector}`);
    }

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
          });

          console.log(`[ElementScreenshot] Captured element with ${padding}px padding: ${options.outputPath}`);
          return { success: true, screenshotPath: options.outputPath };
        }
      }

      // Fallback: screenshot element directly
      await element.screenshot({ path: options.outputPath });
      console.log(`[ElementScreenshot] Captured element directly: ${options.outputPath}`);
      return { success: true, screenshotPath: options.outputPath };
    }

    // Element not found, take full page
    console.log(`[ElementScreenshot] Element not found, taking full page screenshot`);
    await page.screenshot({
      path: options.outputPath,
      fullPage: false // Just viewport, not full page
    });
    return { success: true, screenshotPath: options.outputPath };

  } catch (error) {
    const err = error as Error;
    console.error(`[ElementScreenshot] Error: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    await context.close();
  }
}
