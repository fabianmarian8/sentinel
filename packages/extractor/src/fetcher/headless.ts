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
        '--disable-gpu'
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
      await page.screenshot({
        path: options.screenshotPath,
        fullPage: true
      });
      screenshotPath = options.screenshotPath;
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
