// Smart fetcher with HTTP-first, FlareSolverr, and headless fallback
import { fetchHttp } from './http';
import { fetchHeadless, takeElementScreenshot, takeFullPageScreenshot, type HeadlessFetchOptions } from './headless';
import { fetchFlareSolverr, isFlareSolverrAvailable } from './flaresolverr';
import { detectBlock } from './block-detection';
import { isJavaScriptRequired } from './spa-detection';
import { logger } from '../utils/logger';
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
  let preferredMode = options.preferredMode || 'auto';
  const fallbackToHeadless = options.fallbackToHeadless !== false;
  const fallbackToFlareSolverr = options.fallbackToFlareSolverr !== false;
  const flareSolverrUrl = options.flareSolverrUrl || 'http://localhost:8191/v1';

  // If screenshots are requested, force FlareSolverr/headless mode
  // HTTP-only fetch cannot capture screenshots
  if (options.screenshotOnChange && options.screenshotPath && preferredMode === 'auto') {
    preferredMode = 'flaresolverr';
    logger.debug(`Screenshots requested, forcing FlareSolverr mode for ${options.url}`);
  }

  // If FlareSolverr is explicitly preferred
  if (preferredMode === 'flaresolverr') {
    logger.debug(`Using FlareSolverr (preferred) for ${options.url}`);
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
  logger.debug(`Trying HTTP for ${options.url}`);
  const httpResult = await fetchHttp(options);

  // Check if we should fallback
  const shouldFallbackDecision = shouldFallback(httpResult);

  if (httpResult.success && !shouldFallbackDecision.shouldFallback) {
    // HTTP succeeded and content looks good
    logger.debug(`HTTP succeeded for ${options.url}`);
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
    logger.warn(`HTTP failed but all fallbacks disabled: ${fallbackReason}`);
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
    logger.info(`Trying FlareSolverr: ${fallbackReason}`);

    // Check if FlareSolverr is available
    const flareSolverrAvailable = await isFlareSolverrAvailable(flareSolverrUrl);

    if (flareSolverrAvailable) {
      // FlareSolverr gets HTML and cf_clearance cookies
      // Then headless browser uses cookies for element screenshot (with cookie banner dismissal)
      const needsElementScreenshot = options.screenshotOnChange && options.screenshotSelector && options.screenshotPath;

      const flareSolverrResult = await fetchFlareSolverr({
        ...options,
        flareSolverrUrl,
        // Only use FlareSolverr screenshot if we don't need element-specific screenshot
        returnScreenshot: options.screenshotOnChange && !needsElementScreenshot,
        screenshotPath: needsElementScreenshot ? undefined : options.screenshotPath,
      });

      if (flareSolverrResult.success) {
        logger.info(`FlareSolverr succeeded for ${options.url}`);

        let finalScreenshotPath = flareSolverrResult.screenshotPath || null;

        // If we need element screenshot, use headless with FlareSolverr's cf_clearance cookies
        if (needsElementScreenshot && options.screenshotPath && options.screenshotSelector) {
          logger.debug(`Taking element screenshot with cf_clearance cookies...`);
          const screenshotResult = await takeElementScreenshot({
            url: options.url,
            selector: options.screenshotSelector,
            outputPath: options.screenshotPath,
            padding: 189, // ~10x10cm context around element (378px / 2)
            dismissCookies: true, // Will click cookie banner dismiss button
            userAgent: flareSolverrResult.headers?.['x-flaresolverr-user-agent'],
            // Pass cf_clearance and other cookies from FlareSolverr
            cookies: flareSolverrResult.headers?.['x-flaresolverr-cookies'],
            // Use pre-fetched HTML from FlareSolverr (already rendered, faster)
            html: flareSolverrResult.html || undefined,
          });

          if (screenshotResult.success) {
            finalScreenshotPath = screenshotResult.screenshotPath || null;
            logger.debug(`Element screenshot captured: ${finalScreenshotPath}`);
          } else {
            // Fallback 1: Try navigation with cookies (for SPA sites that need JS execution)
            // setContent doesn't run JavaScript, so dynamic content won't load
            logger.warn(`Element screenshot failed: ${screenshotResult.error}, trying navigation with cookies`);
            const navigationResult = await takeElementScreenshot({
              url: options.url,
              selector: options.screenshotSelector,
              outputPath: options.screenshotPath,
              padding: 189,
              dismissCookies: true,
              userAgent: flareSolverrResult.headers?.['x-flaresolverr-user-agent'],
              cookies: flareSolverrResult.headers?.['x-flaresolverr-cookies'],
              // NO html - forces navigation which executes JavaScript
            });

            if (navigationResult.success) {
              finalScreenshotPath = navigationResult.screenshotPath || null;
              logger.debug(`Navigation screenshot captured: ${finalScreenshotPath}`);
            } else {
              logger.warn(`Navigation also failed: ${navigationResult.error}, trying setContent screenshot`);
              // Fallback 2: Try Playwright with setContent (HTML already has cookie-hiding CSS)
              const setContentScreenshot = await takeFullPageScreenshot({
                html: flareSolverrResult.html || '',
                outputPath: options.screenshotPath,
              });

              if (setContentScreenshot.success) {
                finalScreenshotPath = setContentScreenshot.screenshotPath || null;
                logger.debug(`setContent screenshot captured: ${finalScreenshotPath}`);
              } else {
                // Fallback 3: request full-page screenshot from FlareSolverr (has cookie banner but works)
                logger.warn(`setContent failed, using FlareSolverr full-page`);
                const retryResult = await fetchFlareSolverr({
                  ...options,
                  flareSolverrUrl,
                  returnScreenshot: true,
                  screenshotPath: options.screenshotPath,
                });
                if (retryResult.success) {
                  finalScreenshotPath = retryResult.screenshotPath || null;
                }
              }
            }
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

      logger.warn(`FlareSolverr failed, trying headless...`);
    } else {
      logger.debug(`FlareSolverr not available, trying headless...`);
    }
  }

  // Fallback to headless browser
  if (fallbackToHeadless) {
    logger.info(`Falling back to headless: ${fallbackReason}`);
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
