// Smart fetcher with HTTP-first, FlareSolverr, and headless fallback
import { fetchHttp } from './http';
import { fetchHeadless, takeElementScreenshot, type HeadlessFetchOptions } from './headless';
import { fetchFlareSolverr, isFlareSolverrAvailable } from './flaresolverr';
import { detectBlock } from './block-detection';
import { isJavaScriptRequired } from './spa-detection';
import type { FetchOptions, FetchResult } from './types';

export interface SmartFetchOptions extends FetchOptions {
  // Fallback behavior
  fallbackToHeadless?: boolean; // default true
  fallbackToFlareSolverr?: boolean; // default true
  preferredMode?: 'http' | 'headless' | 'flaresolverr' | 'auto'; // default 'auto'

  // FlareSolverr options
  flareSolverrUrl?: string; // default http://localhost:8191/v1

  // Headless options (used if fallback triggered)
  renderWaitMs?: number;
  waitForSelector?: string;
  screenshotOnChange?: boolean;
  screenshotPath?: string;
  screenshotSelector?: string; // Capture only this element (smaller file size)
}

export interface SmartFetchResult extends FetchResult {
  modeUsed: 'http' | 'headless' | 'flaresolverr';
  fallbackTriggered: boolean;
  fallbackReason?: string;
}

/**
 * Smart fetch with automatic fallback chain:
 *
 * Strategy:
 * 1. If preferredMode is 'headless' or 'flaresolverr', skip HTTP
 * 2. Otherwise, try HTTP first
 * 3. If HTTP fails with Cloudflare block → try FlareSolverr (if available)
 * 4. If FlareSolverr fails or not available → try headless browser
 * 5. Return result with metadata about which mode was used
 */
export async function smartFetch(
  options: SmartFetchOptions
): Promise<SmartFetchResult> {
  const preferredMode = options.preferredMode || 'auto';
  const fallbackToHeadless = options.fallbackToHeadless !== false;
  const fallbackToFlareSolverr = options.fallbackToFlareSolverr !== false;
  const flareSolverrUrl = options.flareSolverrUrl || 'http://localhost:8191/v1';

  // If FlareSolverr is explicitly preferred
  if (preferredMode === 'flaresolverr') {
    console.log(`[SmartFetch] Using FlareSolverr (preferred) for ${options.url}`);
    const result = await fetchFlareSolverr({
      ...options,
      flareSolverrUrl,
      // Pass screenshot options to FlareSolverr
      returnScreenshot: options.screenshotOnChange,
      screenshotPath: options.screenshotPath,
    });
    return {
      ...result,
      modeUsed: 'flaresolverr',
      fallbackTriggered: false,
    };
  }

  // If headless is explicitly preferred, skip HTTP
  if (preferredMode === 'headless') {
    const { cookies, ...restOptions } = options;
    const headlessOptions: HeadlessFetchOptions = {
      ...restOptions,
      renderWaitMs: options.renderWaitMs || 2000,
      waitForSelector: options.waitForSelector,
      screenshotOnChange: options.screenshotOnChange,
      screenshotPath: options.screenshotPath,
      screenshotSelector: options.screenshotSelector,
    };

    const result = await fetchHeadless(headlessOptions);
    return {
      ...result,
      modeUsed: 'headless',
      fallbackTriggered: false,
    };
  }

  // Try HTTP first
  console.log(`[SmartFetch] Trying HTTP for ${options.url}`);
  const httpResult = await fetchHttp(options);

  // Check if we should fallback
  const shouldFallbackDecision = shouldFallback(httpResult);

  if (httpResult.success && !shouldFallbackDecision.shouldFallback) {
    // HTTP succeeded and content looks good
    console.log(`[SmartFetch] HTTP succeeded for ${options.url}`);
    return {
      ...httpResult,
      modeUsed: 'http',
      fallbackTriggered: false,
    };
  }

  // Determine fallback reason
  const fallbackReason = shouldFallbackDecision.reason;

  // If no fallback enabled, return HTTP result
  if (!fallbackToHeadless && !fallbackToFlareSolverr) {
    console.log(`[SmartFetch] HTTP failed but all fallbacks disabled: ${fallbackReason}`);
    return {
      ...httpResult,
      modeUsed: 'http',
      fallbackTriggered: false,
    };
  }

  // Check if this looks like a protection/SPA issue
  const needsRealBrowser =
    fallbackReason.toLowerCase().includes('cloudflare') ||
    fallbackReason.toLowerCase().includes('block') ||
    fallbackReason.toLowerCase().includes('spa') ||
    fallbackReason.toLowerCase().includes('javascript') ||
    fallbackReason.toLowerCase().includes('timeout') ||
    fallbackReason.toLowerCase().includes('failed');

  // Try FlareSolverr first - it's more reliable for Cloudflare-protected sites
  // FlareSolverr now supports screenshots via returnScreenshot parameter
  if (fallbackToFlareSolverr && needsRealBrowser) {
    console.log(`[SmartFetch] Trying FlareSolverr: ${fallbackReason}`);

    // Check if FlareSolverr is available
    const flareSolverrAvailable = await isFlareSolverrAvailable(flareSolverrUrl);

    if (flareSolverrAvailable) {
      // If screenshotSelector is set, we need element screenshot (not FlareSolverr full-page)
      // FlareSolverr will fetch HTML, then headless browser will take element screenshot
      const needsElementScreenshot = options.screenshotOnChange && options.screenshotSelector && options.screenshotPath;

      const flareSolverrResult = await fetchFlareSolverr({
        ...options,
        flareSolverrUrl,
        // Only use FlareSolverr screenshot if we don't need element screenshot
        returnScreenshot: options.screenshotOnChange && !needsElementScreenshot,
        screenshotPath: needsElementScreenshot ? undefined : options.screenshotPath,
      });

      if (flareSolverrResult.success) {
        console.log(`[SmartFetch] FlareSolverr succeeded for ${options.url}`);

        // If we need element screenshot, use headless browser for it
        let finalScreenshotPath = flareSolverrResult.screenshotPath;
        if (needsElementScreenshot && options.screenshotPath && options.screenshotSelector) {
          console.log(`[SmartFetch] Taking element screenshot with headless browser...`);
          const screenshotResult = await takeElementScreenshot({
            url: options.url,
            selector: options.screenshotSelector,
            outputPath: options.screenshotPath,
            padding: 200, // ~5cm context around element
            dismissCookies: true,
            userAgent: options.userAgent,
            // Pass cookies from FlareSolverr session
            cookies: flareSolverrResult.headers?.['x-flaresolverr-cookies'],
          });

          if (screenshotResult.success) {
            finalScreenshotPath = screenshotResult.screenshotPath || null;
            console.log(`[SmartFetch] Element screenshot captured: ${finalScreenshotPath}`);
          } else {
            console.log(`[SmartFetch] Element screenshot failed: ${screenshotResult.error}`);
          }
        }

        return {
          ...flareSolverrResult,
          screenshotPath: finalScreenshotPath,
          modeUsed: 'flaresolverr',
          fallbackTriggered: true,
          fallbackReason,
        };
      }

      console.log(`[SmartFetch] FlareSolverr failed, trying headless...`);
    } else {
      console.log(`[SmartFetch] FlareSolverr not available, trying headless...`);
    }
  }

  // Fallback to headless browser
  if (fallbackToHeadless) {
    console.log(`[SmartFetch] Falling back to headless: ${fallbackReason}`);
    const { cookies, ...restOptions } = options;
    const headlessOptions: HeadlessFetchOptions = {
      ...restOptions,
      renderWaitMs: options.renderWaitMs || 2000,
      waitForSelector: options.waitForSelector,
      screenshotOnChange: options.screenshotOnChange,
      screenshotPath: options.screenshotPath,
      screenshotSelector: options.screenshotSelector,
    };

    const headlessResult = await fetchHeadless(headlessOptions);

    return {
      ...headlessResult,
      modeUsed: 'headless',
      fallbackTriggered: true,
      fallbackReason,
    };
  }

  // All fallbacks failed or disabled, return original HTTP result
  return {
    ...httpResult,
    modeUsed: 'http',
    fallbackTriggered: false,
  };
}

/**
 * Determine if we should fallback to headless based on HTTP result
 */
function shouldFallback(result: FetchResult): {
  shouldFallback: boolean;
  reason: string;
} {
  // Failed fetch
  if (!result.success) {
    return {
      shouldFallback: true,
      reason: `HTTP fetch failed: ${result.errorCode}`,
    };
  }

  // Block detected
  const blockResult = detectBlock(result.httpStatus, result.html, result.headers);
  if (blockResult.blocked) {
    return {
      shouldFallback: true,
      reason: `Block detected: ${blockResult.blockType} (${blockResult.confidence} confidence)`,
    };
  }

  // JavaScript-heavy page (minimal HTML)
  if (result.html && isJavaScriptRequired(result.html)) {
    return {
      shouldFallback: true,
      reason: 'JavaScript-rendered content detected (SPA)',
    };
  }

  // HTTP succeeded and content looks good
  return {
    shouldFallback: false,
    reason: '',
  };
}
