// Smart fetcher with HTTP-first and headless fallback
import { fetchHttp } from './http';
import { fetchHeadless, type HeadlessFetchOptions } from './headless';
import { detectBlock } from './block-detection';
import { isJavaScriptRequired } from './spa-detection';
import type { FetchOptions, FetchResult } from './types';

export interface SmartFetchOptions extends FetchOptions {
  // Fallback behavior
  fallbackToHeadless?: boolean; // default true
  preferredMode?: 'http' | 'headless' | 'auto'; // default 'auto'

  // Headless options (used if fallback triggered)
  renderWaitMs?: number;
  waitForSelector?: string;
  screenshotOnChange?: boolean;
  screenshotPath?: string;
}

export interface SmartFetchResult extends FetchResult {
  modeUsed: 'http' | 'headless';
  fallbackTriggered: boolean;
  fallbackReason?: string;
}

/**
 * Smart fetch with automatic HTTP-to-headless fallback
 *
 * Strategy:
 * 1. If preferredMode is 'headless', skip HTTP and go straight to headless
 * 2. Otherwise, try HTTP first
 * 3. If HTTP fails or returns blocked/JS-heavy content, fallback to headless
 * 4. Return result with metadata about which mode was used
 */
export async function smartFetch(
  options: SmartFetchOptions
): Promise<SmartFetchResult> {
  const preferredMode = options.preferredMode || 'auto';
  const fallbackEnabled = options.fallbackToHeadless !== false;

  // If headless is explicitly preferred, skip HTTP
  if (preferredMode === 'headless') {
    const { cookies, ...restOptions } = options;
    const headlessOptions: HeadlessFetchOptions = {
      ...restOptions,
      renderWaitMs: options.renderWaitMs || 2000,
      waitForSelector: options.waitForSelector,
      screenshotOnChange: options.screenshotOnChange,
      screenshotPath: options.screenshotPath,
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

  // If fallback not enabled, return HTTP result
  if (!fallbackEnabled) {
    console.log(`[SmartFetch] HTTP failed but fallback disabled: ${fallbackReason}`);
    return {
      ...httpResult,
      modeUsed: 'http',
      fallbackTriggered: false,
    };
  }

  // Try headless
  console.log(`[SmartFetch] Falling back to headless: ${fallbackReason}`);
  const { cookies, ...restOptions } = options;
  const headlessOptions: HeadlessFetchOptions = {
    ...restOptions,
    renderWaitMs: options.renderWaitMs || 2000,
    waitForSelector: options.waitForSelector,
    screenshotOnChange: options.screenshotOnChange,
    screenshotPath: options.screenshotPath,
  };

  const headlessResult = await fetchHeadless(headlessOptions);

  return {
    ...headlessResult,
    modeUsed: 'headless',
    fallbackTriggered: true,
    fallbackReason,
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
