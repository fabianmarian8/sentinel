/**
 * Fetch Response Classifiers
 *
 * Detect empty responses, blocked pages, and protection mechanisms.
 * "Empty" is a first-class outcome, not just an error.
 */

import { BlockKind, FetchOutcome } from '../types/fetch-result';

/**
 * Minimum body size in bytes to consider a response valid
 */
export const MIN_BODY_BYTES = 2000;

export interface EmptyClassification {
  isEmpty: boolean;
  signals: string[];
}

export interface BlockClassification {
  isBlocked: boolean;
  kind: BlockKind;
  confidence: number;
  signals: string[];
}

/**
 * Classify if response is "empty" (soft failure)
 */
export function classifyEmpty(
  bodyText: string | undefined,
  contentType?: string,
): EmptyClassification {
  const signals: string[] = [];
  const text = bodyText ?? '';
  const bytes = Buffer.byteLength(text, 'utf8');

  // Rule 1: Body too small for HTML
  if (bytes < MIN_BODY_BYTES) {
    signals.push('body_too_small');
    return { isEmpty: true, signals };
  }

  // Rule 2: JSON error responses disguised as HTML (check before HTML markers)
  if (contentType?.includes('text/html') && text.trim().startsWith('{') && text.includes('"error"')) {
    signals.push('json_error_in_html');
    return { isEmpty: true, signals };
  }

  // Rule 3: Missing basic HTML markers
  if (contentType?.includes('text/html')) {
    const lower = text.toLowerCase();
    if (!lower.includes('<html') && !lower.includes('<body') && !lower.includes('<!doctype')) {
      signals.push('missing_html_markers');
      return { isEmpty: true, signals };
    }
  }

  // Rule 4: Suspicious placeholder patterns
  const lower = text.toLowerCase();
  if (lower.includes('loading...') && bytes < 5000) {
    signals.push('loading_placeholder');
    return { isEmpty: true, signals };
  }

  return { isEmpty: false, signals };
}

/**
 * Classify if response is blocked by protection mechanism
 */
export function classifyBlock(bodyText: string | undefined): BlockClassification {
  const text = bodyText ?? '';
  const lower = text.toLowerCase();
  const signals: string[] = [];

  // DataDome CAPTCHA page detection
  // Note: 'datadome' in cookies/scripts is normal on protected pages
  // Only detect actual CAPTCHA challenge pages with specific URLs/text
  // Do NOT use bare 'captcha' matches - too many false positives from JS config
  if (
    lower.includes('geo.captcha-delivery.com') ||
    lower.includes('captcha-delivery.com/captcha') ||
    lower.includes('posunutím doprava zložte puzzle') ||  // Slovak
    lower.includes('slide to complete the puzzle') ||    // English
    lower.includes('nie s robotom') ||                   // Slovak "not a robot"
    lower.includes('press & hold')                       // DataDome press & hold
  ) {
    signals.push('datadome_detected');
    return { isBlocked: true, kind: 'datadome', confidence: 0.95, signals };
  }

  // Cloudflare detection
  if (
    lower.includes('cloudflare') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('checking your browser') ||
    lower.includes('ray id:')
  ) {
    signals.push('cloudflare_detected');
    return { isBlocked: true, kind: 'cloudflare', confidence: 0.9, signals };
  }

  // PerimeterX detection
  if (
    lower.includes('perimeterx') ||
    lower.includes('px-captcha') ||
    lower.includes('_pxhd')
  ) {
    signals.push('perimeterx_detected');
    return { isBlocked: true, kind: 'perimeterx', confidence: 0.9, signals };
  }

  // Generic CAPTCHA detection - only for small pages (actual CAPTCHA challenge pages)
  // Large pages (>100KB) with product content that happen to have a captcha widget
  // (e.g., Etsy "contact seller" form has g-recaptcha) are NOT blocked
  const bytes = Buffer.byteLength(text, 'utf8');
  const hasProductContent =
    lower.includes('add to cart') ||
    lower.includes('buy now') ||
    lower.includes('price') ||
    lower.includes('product');

  // If large page with product content, skip CAPTCHA detection
  if (bytes > 100000 && hasProductContent) {
    // Not a CAPTCHA block page - it's a real product page with an optional captcha widget
    return { isBlocked: false, kind: 'unknown', confidence: 0, signals };
  }

  const hasCaptchaPage = (
    lower.includes('i am not a robot') ||
    lower.includes('recaptcha') ||
    lower.includes('hcaptcha') ||
    lower.includes('verify you are human') ||
    lower.includes('complete this security check')
  );
  if (hasCaptchaPage) {
    signals.push('captcha_detected');
    return { isBlocked: true, kind: 'captcha', confidence: 0.85, signals };
  }

  // Rate limit detection
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    signals.push('rate_limit_detected');
    return { isBlocked: true, kind: 'rate_limit', confidence: 0.9, signals };
  }

  // Generic block detection - only for small pages (<10KB)
  // Large pages with "blocked" in JS code (e.g., DD_BLOCKED_EVENT_NAME) are not actual blocks
  if (bytes < 10000) {
    if (
      lower.includes('access denied') ||
      lower.includes('blocked') ||
      lower.includes('forbidden')
    ) {
      signals.push('generic_block_detected');
      return { isBlocked: true, kind: 'unknown', confidence: 0.7, signals };
    }
  }

  return { isBlocked: false, kind: 'unknown', confidence: 0, signals };
}

/**
 * Determine final outcome from HTTP status, empty check, and block check
 */
export function determineFetchOutcome(
  httpStatus: number | undefined,
  bodyText: string | undefined,
  contentType?: string,
  errorDetail?: string,
): { outcome: FetchOutcome; blockKind?: BlockKind; signals: string[] } {
  const signals: string[] = [];

  // Network/provider error
  if (errorDetail) {
    if (errorDetail.includes('timeout') || errorDetail.includes('ETIMEDOUT')) {
      signals.push('timeout');
      return { outcome: 'timeout', signals };
    }
    if (errorDetail.includes('ECONNREFUSED') || errorDetail.includes('ENOTFOUND')) {
      signals.push('network_error');
      return { outcome: 'network_error', signals };
    }
    signals.push('provider_error');
    return { outcome: 'provider_error', signals };
  }

  // HTTP error status
  if (httpStatus && httpStatus >= 400) {
    if (httpStatus === 403 || httpStatus === 429) {
      const blockCheck = classifyBlock(bodyText);
      signals.push(...blockCheck.signals);
      if (blockCheck.isBlocked) {
        return { outcome: 'blocked', blockKind: blockCheck.kind, signals };
      }
    }
    signals.push(`http_${httpStatus}`);
    return { outcome: 'blocked', blockKind: 'unknown', signals };
  }

  // Check for block page in response body
  const blockCheck = classifyBlock(bodyText);
  if (blockCheck.isBlocked) {
    signals.push(...blockCheck.signals);
    if (blockCheck.kind === 'captcha') {
      return { outcome: 'captcha_required', blockKind: 'captcha', signals };
    }
    return { outcome: 'blocked', blockKind: blockCheck.kind, signals };
  }

  // Check for empty response
  const emptyCheck = classifyEmpty(bodyText, contentType);
  if (emptyCheck.isEmpty) {
    signals.push(...emptyCheck.signals);
    return { outcome: 'empty', signals };
  }

  // Success
  return { outcome: 'ok', signals };
}
