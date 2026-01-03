/**
 * Fetch Response Classifiers
 *
 * Detect empty responses, blocked pages, and protection mechanisms.
 * "Empty" is a first-class outcome, not just an error.
 *
 * ARCHITECTURE (2026-01-03):
 * Detection is split into two tiers:
 *
 * 1. PRECISE SIGNATURES (always on, any page size):
 *    - Specific URLs (captcha-delivery.com, geo.captcha-delivery.com)
 *    - Specific HTML attributes (cf-browser-verification, px-captcha)
 *    - Challenge page text in specific languages
 *    These have ~99% precision and MUST always fire.
 *
 * 2. HEURISTICS (size-gated, require content validation):
 *    - Bare keywords ('blocked', 'captcha', 'forbidden')
 *    - Generic provider names ('cloudflare', 'datadome')
 *    These cause false positives on real pages with JS SDKs.
 *    Only apply to small pages (<50KB) OR pages without product content.
 *
 * Product content is detected via schema.org JSON-LD (@type: "Product"),
 * NOT via fragile keyword matching.
 */

import { BlockKind, FetchOutcome } from '../types/fetch-result';

/**
 * Minimum body size in bytes to consider a response valid
 */
export const MIN_BODY_BYTES = 2000;

/**
 * Threshold for "large page" - heuristics are gated above this
 */
export const HEURISTIC_SIZE_THRESHOLD = 50000; // 50KB

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
 * Detect schema.org Product JSON-LD in page content.
 * This is the reliable way to detect e-commerce product pages.
 *
 * Looks for patterns like:
 * - "@type": "Product"
 * - "@type":"Product"
 * - "@type": ["Product", ...]
 */
export function hasSchemaOrgProduct(text: string): boolean {
  // Fast check - if no @type, definitely no schema.org
  if (!text.includes('@type')) return false;

  // Match @type with Product (with or without spaces, quotes variations)
  // Handles: "@type": "Product", "@type":"Product", "@type": ["Product", ...]
  const productPattern = /"@type"\s*:\s*(\[\s*)?["']?Product["']?/i;
  return productPattern.test(text);
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
 * Classify if response is blocked by protection mechanism.
 *
 * Uses two-tier detection:
 * 1. Precise signatures - always checked, high confidence
 * 2. Heuristics - size-gated, lower confidence
 */
export function classifyBlock(bodyText: string | undefined): BlockClassification {
  const text = bodyText ?? '';
  const lower = text.toLowerCase();
  const signals: string[] = [];
  const bytes = Buffer.byteLength(text, 'utf8');

  // ============================================================
  // TIER 1: PRECISE SIGNATURES (always on, any page size)
  // These are specific enough to have ~99% precision
  // ============================================================

  // DataDome CAPTCHA - specific delivery URLs and challenge text
  if (
    lower.includes('geo.captcha-delivery.com') ||
    lower.includes('captcha-delivery.com/captcha')
  ) {
    signals.push('datadome_url_signature');
    return { isBlocked: true, kind: 'datadome', confidence: 0.99, signals };
  }

  // DataDome challenge page text (localized)
  if (
    lower.includes('posunutím doprava zložte puzzle') ||  // Slovak
    lower.includes('slide to complete the puzzle') ||    // English DataDome specific
    lower.includes('press & hold')                       // DataDome press & hold
  ) {
    signals.push('datadome_challenge_text');
    return { isBlocked: true, kind: 'datadome', confidence: 0.95, signals };
  }

  // Cloudflare - specific verification attribute
  if (lower.includes('cf-browser-verification')) {
    signals.push('cloudflare_verification_signature');
    return { isBlocked: true, kind: 'cloudflare', confidence: 0.99, signals };
  }

  // PerimeterX - specific CAPTCHA widget
  if (lower.includes('px-captcha')) {
    signals.push('perimeterx_captcha_signature');
    return { isBlocked: true, kind: 'perimeterx', confidence: 0.99, signals };
  }

  // hCaptcha specific challenge frame (not just script inclusion)
  if (lower.includes('hcaptcha-challenge') || lower.includes('h-captcha-response')) {
    signals.push('hcaptcha_challenge_signature');
    return { isBlocked: true, kind: 'captcha', confidence: 0.95, signals };
  }

  // ============================================================
  // TIER 2: HEURISTICS (size-gated, require content validation)
  // These can cause false positives on real pages with JS SDKs
  // ============================================================

  // Check if this is a legitimate product page (schema.org JSON-LD)
  const isProductPage = hasSchemaOrgProduct(text);
  const isLargePage = bytes > HEURISTIC_SIZE_THRESHOLD;

  // Skip heuristics for large product pages - they often have CAPTCHA widgets
  // for contact forms, review submissions, etc. that are NOT blocking the page
  if (isLargePage && isProductPage) {
    signals.push('heuristics_skipped_product_page');
    return { isBlocked: false, kind: 'unknown', confidence: 0, signals };
  }

  // Rate limit detection - medium precision, always check
  // (rate limit pages are typically small and don't have product schema)
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    signals.push('rate_limit_detected');
    return { isBlocked: true, kind: 'rate_limit', confidence: 0.9, signals };
  }

  // Below here: low-precision heuristics, only for small pages
  if (isLargePage) {
    // Large page without product schema - still skip most heuristics
    // Real block pages are almost always <50KB
    return { isBlocked: false, kind: 'unknown', confidence: 0, signals };
  }

  // Cloudflare heuristics (small pages only)
  if (
    lower.includes('checking your browser') ||
    (lower.includes('cloudflare') && lower.includes('ray id'))
  ) {
    signals.push('cloudflare_heuristic');
    return { isBlocked: true, kind: 'cloudflare', confidence: 0.85, signals };
  }

  // PerimeterX heuristics (small pages only)
  if (lower.includes('perimeterx') || lower.includes('_pxhd')) {
    signals.push('perimeterx_heuristic');
    return { isBlocked: true, kind: 'perimeterx', confidence: 0.8, signals };
  }

  // Generic CAPTCHA heuristics (small pages only)
  // NOTE: 'recaptcha' alone causes false positives (g-recaptcha widget on forms)
  // Require more specific challenge indicators
  if (
    lower.includes('i am not a robot') ||
    lower.includes('verify you are human') ||
    lower.includes('complete this security check') ||
    lower.includes('nie s robotom')  // Slovak "not a robot"
  ) {
    signals.push('captcha_heuristic');
    return { isBlocked: true, kind: 'captcha', confidence: 0.8, signals };
  }

  // Generic block heuristics (very small pages only, <10KB)
  // These keywords appear in JS code of normal pages
  if (bytes < 10000) {
    if (
      lower.includes('access denied') ||
      lower.includes('forbidden')
    ) {
      signals.push('generic_block_heuristic');
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
