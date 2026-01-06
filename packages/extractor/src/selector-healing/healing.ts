/**
 * Selector Healing Logic
 *
 * Multi-strategy healing when CSS selectors break:
 * 1. Try fallback selectors (fast)
 * 2. Use fingerprint similarity matching (thorough)
 * 3. Generate new selector from matched element
 */

import * as cheerio from 'cheerio';
import {
  HealingResult,
  HealingOptions,
  SelectorFingerprint,
  ElementFingerprint,
  MarketFingerprint,
} from './types';
import {
  extractFingerprint,
  generateAlternativeSelectors,
  normalizeText,
} from './fingerprint';
import { calculateSimilarity } from './similarity';
import { logger } from '../utils/logger';

/**
 * Extract value with automatic healing when selector fails
 *
 * Strategy:
 * 1. Try primary selector
 * 2. Try fallback selectors
 * 3. Try fingerprint-based element matching
 * 4. Generate new selector from matched element
 */
export async function extractWithHealing(
  html: string,
  options: HealingOptions
): Promise<HealingResult> {
  const {
    selector,
    attribute,
    fallbackSelectors = [],
    storedFingerprint,
    similarityThreshold = 0.6,
    textAnchor,
    generateFingerprint = true,
    marketKey,
  } = options;

  // Load HTML once
  const $ = cheerio.load(html);

  // Resolve effective fingerprint for this market
  // Priority: market-specific → legacy single → none
  const effectiveFingerprint = resolveMarketFingerprint(storedFingerprint, marketKey);
  const effectiveTextAnchor = textAnchor ?? effectiveFingerprint?.textAnchor;

  // Step 1: Try primary selector
  const primaryResult = trySelector($, selector, attribute as any);
  if (primaryResult.success && primaryResult.value) {
    // Validate with text anchor if provided
    if (effectiveTextAnchor && !validateTextAnchor(primaryResult.value, effectiveTextAnchor)) {
      logger.debug(`Primary selector matched but text anchor validation failed`);
    } else {
      // Generate fingerprint for storage
      const newFingerprint = generateFingerprint
        ? extractFingerprintFromSelector($, selector)
        : undefined;

      return {
        success: true,
        value: primaryResult.value,
        selectorUsed: selector,
        healingMethod: 'primary',
        healed: false,
        newFingerprint,
      };
    }
  }

  logger.debug(`Primary selector failed: ${selector}`);

  // Step 2: Try fallback selectors
  for (const fallback of fallbackSelectors) {
    // Skip XPath for now (starts with xpath:)
    if (fallback.startsWith('xpath:')) continue;

    const fallbackResult = trySelector($, fallback, attribute as any);
    if (fallbackResult.success && fallbackResult.value) {
      // Validate with text anchor if provided
      if (effectiveTextAnchor && !validateTextAnchor(fallbackResult.value, effectiveTextAnchor)) {
        logger.debug(`Fallback selector ${fallback} matched but text anchor validation failed`);
        continue;
      }

      // Calculate similarity if we have stored fingerprint
      let similarity = 0;
      if (effectiveFingerprint?.elementFingerprint) {
        const fallbackFingerprint = extractFingerprintFromSelector($, fallback);
        if (fallbackFingerprint) {
          similarity = calculateSimilarity(
            effectiveFingerprint.elementFingerprint,
            fallbackFingerprint
          );
        }
      }

      const newFingerprint = generateFingerprint
        ? extractFingerprintFromSelector($, fallback)
        : undefined;

      logger.info(`Healed with fallback selector: ${fallback} (similarity: ${(similarity * 100).toFixed(0)}%)`);

      return {
        success: true,
        value: fallbackResult.value,
        selectorUsed: fallback,
        healingMethod: 'fallback',
        healed: true,
        healedFrom: selector,
        similarity,
        newFingerprint,
      };
    }
  }

  logger.debug(`All ${fallbackSelectors.length} fallback selectors failed`);

  // Step 3: Try fingerprint-based matching
  if (effectiveFingerprint?.elementFingerprint) {
    logger.debug(`Attempting fingerprint-based healing...`);

    const fingerprintResult = await healWithFingerprint(
      $,
      effectiveFingerprint.elementFingerprint,
      attribute as any,
      similarityThreshold,
      effectiveTextAnchor
    );

    if (fingerprintResult.success && fingerprintResult.value) {
      return {
        success: true,
        value: fingerprintResult.value,
        selectorUsed: fingerprintResult.selector,
        healingMethod: 'fingerprint',
        healed: true,
        healedFrom: selector,
        similarity: fingerprintResult.similarity,
        newFingerprint: fingerprintResult.fingerprint,
      };
    }
  }

  // All healing attempts failed
  return {
    success: false,
    value: null,
    selectorUsed: selector,
    healed: false,
    error: 'All selectors and healing strategies failed',
  };
}

/**
 * Try to extract value using a selector
 */
function trySelector(
  $: cheerio.CheerioAPI,
  selector: string,
  attribute: 'text' | 'html' | 'value' | `attr:${string}`
): { success: boolean; value: string | null } {
  try {
    const element = $(selector).first();
    if (element.length === 0) {
      return { success: false, value: null };
    }

    let value: string | null = null;

    if (attribute === 'text') {
      value = element.text();
    } else if (attribute === 'html') {
      value = element.html();
    } else if (attribute === 'value') {
      value = element.val() as string || null;
    } else if (attribute.startsWith('attr:')) {
      const attrName = attribute.slice(5);
      value = element.attr(attrName) || null;
    }

    if (value && value.trim()) {
      return { success: true, value: value.trim() };
    }

    return { success: false, value: null };
  } catch {
    return { success: false, value: null };
  }
}

/**
 * Extract fingerprint from element matched by selector
 */
function extractFingerprintFromSelector(
  $: cheerio.CheerioAPI,
  selector: string
): ElementFingerprint | undefined {
  try {
    const element = $(selector).first();
    if (element.length === 0) return undefined;
    return extractFingerprint($, element);
  } catch {
    return undefined;
  }
}

/**
 * Heal by finding similar element using fingerprint
 */
async function healWithFingerprint(
  $: cheerio.CheerioAPI,
  storedFingerprint: ElementFingerprint,
  attribute: 'text' | 'html' | 'value' | `attr:${string}`,
  threshold: number,
  textAnchor?: string
): Promise<{
  success: boolean;
  value: string | null;
  selector: string;
  similarity: number;
  fingerprint?: ElementFingerprint;
}> {
  const tagName = storedFingerprint.tagName;

  // Get all elements of the same tag
  const candidates: {
    element: cheerio.Cheerio<any>;
    fingerprint: ElementFingerprint;
    score: number;
  }[] = [];

  $(tagName).each((_, el) => {
    try {
      const element = $(el);
      const fingerprint = extractFingerprint($, element);
      const score = calculateSimilarity(storedFingerprint, fingerprint);

      if (score >= threshold * 0.8) {
        // Pre-filter with 80% of threshold
        candidates.push({ element, fingerprint, score });
      }
    } catch {
      // Skip invalid elements
    }
  });

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  logger.debug(`Found ${candidates.length} candidate elements above threshold`);

  // Try top candidates
  for (const candidate of candidates.slice(0, 5)) {
    // Extract value
    let value: string | null = null;
    if (attribute === 'text') {
      value = candidate.element.text();
    } else if (attribute === 'html') {
      value = candidate.element.html();
    } else if (attribute === 'value') {
      value = candidate.element.val() as string || null;
    } else if (attribute.startsWith('attr:')) {
      const attrName = attribute.slice(5);
      value = candidate.element.attr(attrName) || null;
    }

    if (!value || !value.trim()) continue;

    // Validate with text anchor
    if (textAnchor && !validateTextAnchor(value, textAnchor)) {
      logger.debug(`Candidate rejected: text anchor mismatch (score: ${(candidate.score * 100).toFixed(0)}%)`);
      continue;
    }

    // Check if score meets threshold
    if (candidate.score < threshold) continue;

    // Generate a selector for this element
    const newSelectors = generateAlternativeSelectors(candidate.fingerprint);
    const validSelector = findValidSelector($, newSelectors, value.trim());

    if (validSelector) {
      logger.info(`Fingerprint healing found match: ${validSelector} (similarity: ${(candidate.score * 100).toFixed(0)}%)`);

      return {
        success: true,
        value: value.trim(),
        selector: validSelector,
        similarity: candidate.score,
        fingerprint: candidate.fingerprint,
      };
    }
  }

  return {
    success: false,
    value: null,
    selector: '',
    similarity: 0,
  };
}

/**
 * Find a valid selector from alternatives that returns the expected value
 */
function findValidSelector(
  $: cheerio.CheerioAPI,
  selectors: string[],
  expectedValue: string
): string | null {
  for (const selector of selectors) {
    try {
      const element = $(selector).first();
      if (element.length === 0) continue;

      const text = element.text()?.trim();
      if (text === expectedValue) {
        // Verify uniqueness (selector should match exactly 1 element with this value)
        const allMatches = $(selector);
        let matchCount = 0;
        allMatches.each((_, el) => {
          if ($(el).text()?.trim() === expectedValue) {
            matchCount++;
          }
        });

        if (matchCount === 1) {
          return selector;
        }
      }
    } catch {
      // Invalid selector, skip
    }
  }

  return null;
}

/**
 * Resolve effective fingerprint for a market
 *
 * Priority:
 * 1. Market-specific fingerprint (if marketKey provided and exists)
 * 2. Legacy single fingerprint (backward compatibility)
 * 3. undefined (no fingerprint available)
 *
 * When marketKey is provided but no market fingerprint exists, this returns
 * the legacy fingerprint as fallback. The caller should create a new market
 * fingerprint on successful extraction.
 */
function resolveMarketFingerprint(
  storedFingerprint: SelectorFingerprint | undefined,
  marketKey: string | undefined
): MarketFingerprint | undefined {
  if (!storedFingerprint) return undefined;

  // If marketKey provided, try market-specific first
  if (marketKey) {
    const marketFp = storedFingerprint.markets?.[marketKey.toLowerCase()];
    if (marketFp) {
      logger.debug(`[Healing] Using market fingerprint for ${marketKey}`);
      return marketFp;
    }
    // Market fingerprint doesn't exist - new market detected
    // Fall back to legacy, but log for visibility
    if (storedFingerprint.elementFingerprint || storedFingerprint.textAnchor) {
      logger.debug(`[Healing] New market ${marketKey}, using legacy fingerprint as baseline`);
    }
  }

  // Return legacy fingerprint as MarketFingerprint-compatible structure
  if (storedFingerprint.elementFingerprint || storedFingerprint.textAnchor) {
    return {
      textAnchor: storedFingerprint.textAnchor,
      elementFingerprint: storedFingerprint.elementFingerprint,
      lastSuccessAt: storedFingerprint.lastSuccessAt,
    };
  }

  return undefined;
}

/**
 * Validate extracted value against text anchor
 *
 * IMPORTANT: Anchors containing prices are unreliable because:
 * - Currency can change with geo (EUR→USD)
 * - Prices fluctuate naturally
 * - Number formats differ by locale
 *
 * If anchor looks like a price (has currency symbol/code), we skip validation
 * to prevent false negatives after geo/currency changes.
 *
 * Pure numbers (years, model numbers, ASINs) are NOT skipped - they should
 * still be validated to detect template drift.
 */
function validateTextAnchor(value: string, anchor: string): boolean {
  const normalizedValue = normalizeText(value);
  const normalizedAnchor = normalizeText(anchor).slice(0, 20);

  // If anchor looks like a price (has currency context), skip validation
  // This is a compatibility layer for historical price-based anchors
  if (looksLikePrice(normalizedAnchor)) {
    logger.debug(`[Healing] Anchor validation skipped: price-like anchor "${normalizedAnchor.slice(0, 15)}..."`);
    return true;
  }

  // For non-price anchors, check if value contains the anchor
  const matches = normalizedValue.includes(normalizedAnchor);
  if (!matches) {
    logger.debug(`[Healing] Anchor validation failed: "${normalizedAnchor.slice(0, 15)}..." not in "${normalizedValue.slice(0, 30)}..."`);
  }
  return matches;
}

/**
 * Check if a string looks like a price
 *
 * STRICT: Requires explicit currency signal to avoid false positives.
 * Pure numbers without currency context are NOT considered prices.
 *
 * Examples:
 * - "$819.99" → true (currency symbol)
 * - "€699,47" → true (currency symbol)
 * - "819.99 USD" → true (ISO code)
 * - "2026" → false (just a number, could be year/version)
 * - "1234" → false (just a number, could be model)
 * - "B09V3KXJPB" → false (ASIN)
 */
function looksLikePrice(value: string): boolean {
  // Currency symbols (most common)
  if (/[\$€£¥₹₽₩₪₴฿₺₸₴₱₭₲₡¢]/.test(value)) return true;

  // ISO 4217 currency codes near numbers
  // Pattern: number followed/preceded by 3-letter code (USD, EUR, GBP, etc.)
  if (/\b(USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD|CNY|INR|KRW|BRL|MXN|RUB|PLN|CZK|HUF|SEK|NOK|DKK|TRY|ZAR|SGD|HKD|THB|MYR|IDR|PHP|VND|AED|SAR|ILS|EGP|NGN|KES|GHS|PKR|BDT|LKR|NPR|UAH|RON|BGN|HRK|RSD|ALL|MKD|BAM|GEL|AMD|AZN|KZT|UZS|TJS|KGS|TMT|BYN|MDL)\b/i.test(value)) {
    // Must also contain a number
    if (/\d/.test(value)) return true;
  }

  // Common price formats with explicit currency indicators
  // "Price: 123.45" or "Cena: 123,45" patterns
  if (/\b(price|cena|precio|preis|prix|prezzo|цена|cen[ay])\s*:?\s*[\d.,]+/i.test(value)) return true;

  return false;
}

/**
 * Create or update selector fingerprint for a rule
 *
 * If marketKey is provided, stores fingerprint under that market key.
 * This enables per-market fingerprints for multi-geo monitoring.
 *
 * @param html - Page HTML content
 * @param selector - CSS selector that matched
 * @param extractedValue - Value extracted from page
 * @param existingFingerprint - Existing fingerprint to merge with
 * @param marketKey - Optional market key (e.g., "us:usd", "de:eur")
 */
export function createSelectorFingerprint(
  html: string,
  selector: string,
  extractedValue: string,
  existingFingerprint?: SelectorFingerprint,
  marketKey?: string
): SelectorFingerprint {
  const $ = cheerio.load(html);
  const element = $(selector).first();

  if (element.length === 0) {
    // Can't generate fingerprint if selector doesn't match
    return existingFingerprint || {
      selector,
      alternativeSelectors: [],
    };
  }

  // Extract element fingerprint
  const elementFingerprint = extractFingerprint($, element);

  // Generate alternative selectors
  const alternativeSelectors = generateAlternativeSelectors(elementFingerprint);

  // Create text anchor ONLY for non-price content
  // Prices are unreliable anchors because:
  // - Currency changes with geo
  // - Values fluctuate naturally
  // - Format differs by locale
  const textAnchor = extractedValue && !looksLikePrice(extractedValue)
    ? normalizeText(extractedValue).slice(0, 50)
    : undefined;

  // Build parent context
  const parentContext: { tag: string; classes: string[]; id?: string }[] = [];
  if (elementFingerprint.parentTag) {
    parentContext.push({
      tag: elementFingerprint.parentTag,
      classes: elementFingerprint.parentClasses,
      id: elementFingerprint.parentId,
    });
  }

  // Merge with existing healing history
  const healingHistory = existingFingerprint?.healingHistory || [];

  // Prepare market fingerprint data
  const marketFingerprintData: MarketFingerprint = {
    textAnchor,
    elementFingerprint,
    lastSuccessAt: new Date().toISOString(),
    successCount: 1,
  };

  // If marketKey provided, store under market key (per-market fingerprint)
  if (marketKey) {
    const normalizedKey = marketKey.toLowerCase();
    const existingMarkets = existingFingerprint?.markets || {};
    const existingMarketFp = existingMarkets[normalizedKey];

    // Increment success count if existing
    if (existingMarketFp) {
      marketFingerprintData.successCount = (existingMarketFp.successCount || 0) + 1;
    }

    logger.debug(`[Healing] Storing fingerprint for market ${normalizedKey} (count: ${marketFingerprintData.successCount})`);

    return {
      selector,
      alternativeSelectors,
      parentContext,
      attributes: elementFingerprint.attributes,
      healingHistory,
      // Keep legacy fingerprint for backward compat
      textAnchor: existingFingerprint?.textAnchor,
      elementFingerprint: existingFingerprint?.elementFingerprint,
      lastSuccessAt: existingFingerprint?.lastSuccessAt,
      // Add/update market-specific fingerprint
      markets: {
        ...existingMarkets,
        [normalizedKey]: marketFingerprintData,
      },
    };
  }

  // No marketKey - use legacy single fingerprint (backward compat)
  return {
    selector,
    alternativeSelectors,
    textAnchor,
    parentContext,
    attributes: elementFingerprint.attributes,
    elementFingerprint,
    lastSuccessAt: new Date().toISOString(),
    healingHistory,
    // Preserve existing markets if any
    markets: existingFingerprint?.markets,
  };
}
