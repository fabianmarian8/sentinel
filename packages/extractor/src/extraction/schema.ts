/**
 * Schema.org JSON-LD Extraction
 *
 * Entity-based extraction for e-commerce structured data.
 * Resilient to A/B testing, schema drift, and offers array variations.
 *
 * ARCHITECTURE:
 * 1. Entity-based, not path-based: Finds "best Product candidate" via scoring
 * 2. Schema fingerprint for drift detection (shapeHash, schemaTypes)
 * 3. Fallback order: JSON-LD → meta → (DOM only if explicit)
 * 4. Currency tracking (don't compare across currencies)
 * 5. AggregateOffer preferred over Offer array
 * 6. Performance guardrails: max 10 blocks, depth 5, items 20
 *
 * @see packages/shared/src/domain.ts for type definitions
 */

import { createHash } from 'crypto';
import type {
  SchemaQuery,
  SchemaFingerprint,
  SchemaExtractionMeta,
  SchemaExtractionResult,
} from '@sentinel/shared';

// Import the availability map as a value
import { SCHEMA_AVAILABILITY_MAP as AVAILABILITY_MAP } from '@sentinel/shared';

// Performance guardrails
const MAX_JSONLD_BLOCKS = 10;
const MAX_RECURSION_DEPTH = 5;
const MAX_ARRAY_ITEMS = 20;
const MAX_OFFERS_ITEMS = 200;

/**
 * Commerce-related schema.org types that indicate a product entity.
 */
const PRODUCT_TYPES = new Set([
  'product',
  'productmodel',
  'productgroup',
  'individualproduct', // Fixed typo: was 'indivisualproduct'
]);

/**
 * Entity candidate for scoring during extraction.
 */
interface EntityCandidate {
  entity: Record<string, unknown>;
  score: number;
  depth: number;
  schemaTypes: string[];
  hasOffers: boolean;
  offersCount: number;
}

/**
 * Parsed offer information.
 */
interface ParsedOffer {
  price: number | null;
  lowPrice: number | null;
  highPrice: number | null;
  currency: string | null;
  availability: string | null;
}

/**
 * Main schema extraction function.
 * Extracts price or availability from schema.org JSON-LD with meta fallback.
 *
 * @param html - HTML content containing JSON-LD
 * @param query - Query specifying what to extract (price, availability)
 * @returns Extraction result with value, metadata, and fingerprint
 */
export function extractWithSchema(
  html: string,
  query: SchemaQuery,
): SchemaExtractionResult {
  if (!html || html.length === 0) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'Empty HTML input',
    };
  }

  // Determine source preference
  const source = query.source ?? 'auto';

  // If source=meta, skip JSON-LD entirely
  if (source === 'meta') {
    return extractFromMeta(html, query);
  }

  // If source=jsonld, only try JSON-LD (no meta fallback)
  if (source === 'jsonld') {
    // Fast check - if no @type, definitely no schema.org
    if (!html.includes('@type')) {
      return {
        success: false,
        rawValue: null,
        meta: null,
        error: 'No @type found in HTML - no JSON-LD schema data',
      };
    }
    return extractFromJsonLd(html, query);
  }

  // source=auto: Try JSON-LD first, then meta fallback
  // Fast check - if no @type, skip JSON-LD and go straight to meta
  if (!html.includes('@type')) {
    return extractFromMeta(html, query);
  }

  const jsonLdResult = extractFromJsonLd(html, query);
  if (jsonLdResult.success) {
    return jsonLdResult;
  }

  // JSON-LD failed, try meta tags fallback
  return extractFromMeta(html, query);
}

/**
 * Extract from JSON-LD blocks using entity-based approach.
 */
function extractFromJsonLd(
  html: string,
  query: SchemaQuery,
): SchemaExtractionResult {
  const blocks = extractJsonLdBlocks(html);

  if (blocks.length === 0) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No JSON-LD blocks found',
    };
  }

  // Parse and find best product candidate
  const candidates: EntityCandidate[] = [];

  for (const block of blocks.slice(0, MAX_JSONLD_BLOCKS)) {
    try {
      const parsed = JSON.parse(block);
      findProductCandidates(parsed, candidates, 0);
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No Product entity found in JSON-LD',
    };
  }

  // Sort by score (highest first) and select best candidate
  candidates.sort((a, b) => b.score - a.score);
  const bestCandidate = candidates[0]!; // Safe: checked length > 0 above

  // Extract value based on query kind
  if (query.kind === 'price') {
    return extractPriceFromEntity(bestCandidate, query, html, blocks.length);
  } else {
    return extractAvailabilityFromEntity(bestCandidate, html, blocks.length);
  }
}

/**
 * Extract JSON-LD script blocks from HTML.
 */
function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const regex = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match;
  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      blocks.push(match[1].trim());
    }
  }

  return blocks;
}

/**
 * Recursively find product candidates and score them.
 * Entity-based approach: scores based on completeness, not path.
 *
 * FULL TRAVERSAL: Searches through ALL object values, not just @graph/mainEntity.
 * This handles schemas where Product is nested under itemListElement, hasVariant, etc.
 */
function findProductCandidates(
  obj: unknown,
  candidates: EntityCandidate[],
  depth: number,
): void {
  if (depth > MAX_RECURSION_DEPTH) return;
  if (obj === null || typeof obj !== 'object') return;

  // Handle arrays (including @graph, itemListElement, etc.)
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, MAX_ARRAY_ITEMS)) {
      findProductCandidates(item, candidates, depth + 1);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this is a Product-like entity
  const typeField = record['@type'];
  const schemaTypes = normalizeType(typeField);

  const isProduct = schemaTypes.some(t => PRODUCT_TYPES.has(t.toLowerCase()));

  if (isProduct) {
    // Score this candidate
    const score = scoreProductCandidate(record);
    const offersInfo = getOffersInfo(record);

    candidates.push({
      entity: record,
      score,
      depth,
      schemaTypes,
      hasOffers: offersInfo.count > 0,
      offersCount: offersInfo.count,
    });
  }

  // FULL TRAVERSAL: Recursively search ALL object values
  // This finds Products nested under any key: @graph, mainEntity, itemListElement,
  // hasVariant, isRelatedTo, offers.itemOffered, etc.
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') {
      findProductCandidates(value, candidates, depth + 1);
    }
  }
}

/**
 * Score a Product candidate based on completeness.
 * Higher score = better candidate.
 */
function scoreProductCandidate(entity: Record<string, unknown>): number {
  let score = 0;

  // Has offers (+10)
  if (entity['offers']) score += 10;

  // Has name (+5)
  if (entity['name']) score += 5;

  // Has SKU (+3)
  if (entity['sku']) score += 3;

  // Has image (+2)
  if (entity['image']) score += 2;

  // Has brand (+2)
  if (entity['brand']) score += 2;

  // Has description (+1)
  if (entity['description']) score += 1;

  // Penalize if aggregateRating without offers (-5)
  // (likely a review page, not product page)
  if (entity['aggregateRating'] && !entity['offers']) score -= 5;

  return score;
}

/**
 * Get offers information from entity.
 */
function getOffersInfo(entity: Record<string, unknown>): { count: number } {
  const offers = entity['offers'];
  if (!offers) return { count: 0 };

  if (Array.isArray(offers)) {
    return { count: Math.min(offers.length, MAX_OFFERS_ITEMS) };
  }

  if (typeof offers === 'object' && offers !== null) {
    const offerType = normalizeType((offers as Record<string, unknown>)['@type']);
    if (offerType.some(t => t.toLowerCase() === 'aggregateoffer')) {
      // AggregateOffer counts as 1 but represents multiple
      return { count: 1 };
    }
    return { count: 1 };
  }

  return { count: 0 };
}

/**
 * Normalize @type field to array of strings.
 */
function normalizeType(typeField: unknown): string[] {
  if (typeof typeField === 'string') {
    return [typeField];
  }
  if (Array.isArray(typeField)) {
    return typeField.filter(t => typeof t === 'string') as string[];
  }
  return [];
}

/**
 * Extract price from Product entity.
 */
function extractPriceFromEntity(
  candidate: EntityCandidate,
  query: SchemaQuery,
  html: string,
  jsonLdBlockCount: number,
): SchemaExtractionResult {
  const entity = candidate.entity;
  const offers = entity['offers'];

  if (!offers) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'Product has no offers field',
    };
  }

  const parsedOffers = parseOffers(offers);

  if (parsedOffers.length === 0) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'Could not parse offers',
    };
  }

  // Determine which price to use
  const prefer = query.prefer ?? 'price';
  let selectedPrice: number | null = null;
  let selectedCurrency: string | null = null;
  let valueLow: number | null = null;
  let valueHigh: number | null = null;
  let currencyConflict = false;

  // Check for currency consistency
  const currencies = new Set(parsedOffers.map(o => o.currency).filter(Boolean));
  if (currencies.size > 1) {
    currencyConflict = true;
  }

  // Find AggregateOffer first (preferred)
  const aggregateOffer = parsedOffers.find(o => o.lowPrice !== null);

  if (aggregateOffer) {
    valueLow = aggregateOffer.lowPrice;
    valueHigh = aggregateOffer.highPrice;
    selectedCurrency = aggregateOffer.currency;

    switch (prefer) {
      case 'low':
        selectedPrice = aggregateOffer.lowPrice;
        break;
      case 'high':
        selectedPrice = aggregateOffer.highPrice ?? aggregateOffer.lowPrice;
        break;
      case 'price':
      default:
        selectedPrice = aggregateOffer.price ?? aggregateOffer.lowPrice;
        break;
    }
  } else {
    // P0-2 FIX: Compute min/max from all offers instead of taking first
    // This prevents flapping when offer order changes
    const offersWithPrice = parsedOffers.filter(o => o.price !== null);

    if (offersWithPrice.length === 0) {
      return {
        success: false,
        rawValue: null,
        meta: null,
        error: 'No offers with valid price found',
      };
    }

    // Single-pass min/max computation
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let primaryCurrency: string | null = null;

    for (const offer of offersWithPrice) {
      const price = offer.price!;
      if (price < minPrice) {
        minPrice = price;
        primaryCurrency = offer.currency; // currency of min price
      }
      if (price > maxPrice) {
        maxPrice = price;
      }
    }

    valueLow = minPrice;
    valueHigh = maxPrice;
    selectedCurrency = primaryCurrency;

    // Default to minPrice for monitoring "od" ceny
    // This is stable - always picks the lowest regardless of array order
    switch (prefer) {
      case 'low':
        selectedPrice = minPrice;
        break;
      case 'high':
        selectedPrice = maxPrice;
        break;
      case 'price':
      default:
        // Default: use minPrice for stable monitoring
        selectedPrice = minPrice;
        break;
    }
  }

  if (selectedPrice === null) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No valid price found in offers',
    };
  }

  // Generate fingerprint
  const fingerprint = generateSchemaFingerprint(html, candidate, jsonLdBlockCount);

  const meta: SchemaExtractionMeta = {
    source: 'jsonld',
    schemaTypes: candidate.schemaTypes,
    currency: selectedCurrency,
    valueLow,
    valueHigh,
    availabilityUrl: null,
    offersCount: candidate.offersCount,
    offersTruncated: candidate.offersCount >= MAX_OFFERS_ITEMS,
    fingerprint,
    currencyConflict,
  };

  return {
    success: true,
    rawValue: selectedPrice.toString(),
    meta,
  };
}

/**
 * Parse offers field (handles single Offer, AggregateOffer, or array).
 */
function parseOffers(offers: unknown): ParsedOffer[] {
  const result: ParsedOffer[] = [];

  if (Array.isArray(offers)) {
    for (const offer of offers.slice(0, MAX_OFFERS_ITEMS)) {
      const parsed = parseSingleOffer(offer);
      if (parsed) result.push(parsed);
    }
  } else if (typeof offers === 'object' && offers !== null) {
    const parsed = parseSingleOffer(offers);
    if (parsed) result.push(parsed);
  }

  return result;
}

/**
 * Parse a single offer object.
 */
function parseSingleOffer(offer: unknown): ParsedOffer | null {
  if (typeof offer !== 'object' || offer === null) return null;

  const offerRecord = offer as Record<string, unknown>;
  const offerType = normalizeType(offerRecord['@type']);
  const isAggregate = offerType.some(t => t.toLowerCase() === 'aggregateoffer');

  const price = parsePrice(offerRecord['price']);
  const lowPrice = isAggregate ? parsePrice(offerRecord['lowPrice']) : null;
  const highPrice = isAggregate ? parsePrice(offerRecord['highPrice']) : null;
  const currency = typeof offerRecord['priceCurrency'] === 'string'
    ? offerRecord['priceCurrency']
    : null;
  const availability = typeof offerRecord['availability'] === 'string'
    ? offerRecord['availability']
    : null;

  return { price, lowPrice, highPrice, currency, availability };
}

/**
 * Parse price value to number.
 */
function parsePrice(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.,]/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Extract availability from Product entity.
 */
function extractAvailabilityFromEntity(
  candidate: EntityCandidate,
  html: string,
  jsonLdBlockCount: number,
): SchemaExtractionResult {
  const entity = candidate.entity;
  const offers = entity['offers'];

  if (!offers) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'Product has no offers field',
    };
  }

  const parsedOffers = parseOffers(offers);

  if (parsedOffers.length === 0) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'Could not parse offers',
    };
  }

  // Find availability from first offer with availability
  const offerWithAvailability = parsedOffers.find(o => o.availability !== null);
  const availabilityUrl = offerWithAvailability?.availability ?? null;

  if (!availabilityUrl) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No availability found in offers',
    };
  }

  // Map schema.org URL to status
  const status = AVAILABILITY_MAP[availabilityUrl] ?? 'unknown';

  // Generate fingerprint
  const fingerprint = generateSchemaFingerprint(html, candidate, jsonLdBlockCount);

  const meta: SchemaExtractionMeta = {
    source: 'jsonld',
    schemaTypes: candidate.schemaTypes,
    currency: null,
    valueLow: null,
    valueHigh: null,
    availabilityUrl,
    offersCount: candidate.offersCount,
    offersTruncated: candidate.offersCount >= MAX_OFFERS_ITEMS,
    fingerprint,
    currencyConflict: false,
  };

  return {
    success: true,
    rawValue: status,
    meta,
  };
}

/**
 * Generate schema fingerprint for drift detection.
 */
function generateSchemaFingerprint(
  html: string,
  candidate: EntityCandidate,
  jsonLdBlockCount: number,
): SchemaFingerprint {
  // Extract sorted keys from entity for shape hash
  const keys = extractKeysRecursive(candidate.entity, 0);
  const sortedKeys = [...keys].sort();
  const shapeHash = createHash('sha256')
    .update(sortedKeys.join(','))
    .digest('hex')
    .substring(0, 16);

  // Check for meta tags
  const hasMeta = html.includes('product:price:amount') ||
                  html.includes('og:price:amount');

  return {
    schemaTypes: candidate.schemaTypes,
    shapeHash,
    jsonLdBlockCount,
    hasOffers: candidate.hasOffers,
    hasMeta,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Extract keys recursively for shape hash.
 */
function extractKeysRecursive(obj: unknown, depth: number): Set<string> {
  const keys = new Set<string>();

  if (depth > MAX_RECURSION_DEPTH) return keys;
  if (obj === null || typeof obj !== 'object') return keys;

  if (Array.isArray(obj)) {
    if (obj.length > 0) {
      // Just sample first item for shape
      const itemKeys = extractKeysRecursive(obj[0], depth + 1);
      itemKeys.forEach(k => keys.add(k));
    }
    return keys;
  }

  const record = obj as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    keys.add(key);
    if (typeof value === 'object' && value !== null) {
      const nestedKeys = extractKeysRecursive(value, depth + 1);
      nestedKeys.forEach(k => keys.add(`${key}.${k}`));
    }
  }

  return keys;
}

/**
 * Extract from OpenGraph/meta tags fallback.
 */
function extractFromMeta(
  html: string,
  query: SchemaQuery,
): SchemaExtractionResult {
  if (query.kind === 'price') {
    return extractPriceFromMeta(html);
  } else {
    return extractAvailabilityFromMeta(html);
  }
}

/**
 * Extract price from meta tags.
 */
function extractPriceFromMeta(html: string): SchemaExtractionResult {
  // Try product:price:amount (OpenGraph e-commerce)
  let price: string | null = null;
  let currency: string | null = null;

  // product:price:amount
  const priceMatch = html.match(/<meta[^>]+property\s*=\s*["']product:price:amount["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']product:price:amount["']/i);

  if (priceMatch && priceMatch[1]) {
    price = priceMatch[1];
  }

  // og:price:amount fallback
  if (!price) {
    const ogMatch = html.match(/<meta[^>]+property\s*=\s*["']og:price:amount["'][^>]+content\s*=\s*["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:price:amount["']/i);

    if (ogMatch && ogMatch[1]) {
      price = ogMatch[1];
    }
  }

  if (!price) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No price meta tags found',
    };
  }

  // Try to get currency
  const currencyMatch = html.match(/<meta[^>]+property\s*=\s*["']product:price:currency["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']product:price:currency["']/i);

  if (currencyMatch && currencyMatch[1]) {
    currency = currencyMatch[1];
  }

  const meta: SchemaExtractionMeta = {
    source: 'meta',
    schemaTypes: [],
    currency,
    valueLow: null,
    valueHigh: null,
    availabilityUrl: null,
    offersCount: null,
    offersTruncated: false,
    fingerprint: null,
    currencyConflict: false,
  };

  return {
    success: true,
    rawValue: price,
    meta,
  };
}

/**
 * Extract availability from meta tags.
 */
function extractAvailabilityFromMeta(html: string): SchemaExtractionResult {
  // Try product:availability
  const match = html.match(/<meta[^>]+property\s*=\s*["']product:availability["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']product:availability["']/i);

  if (!match || !match[1]) {
    return {
      success: false,
      rawValue: null,
      meta: null,
      error: 'No availability meta tags found',
    };
  }

  const availabilityUrl = match[1];
  const status = AVAILABILITY_MAP[availabilityUrl] ?? 'unknown';

  const meta: SchemaExtractionMeta = {
    source: 'meta',
    schemaTypes: [],
    currency: null,
    valueLow: null,
    valueHigh: null,
    availabilityUrl,
    offersCount: null,
    offersTruncated: false,
    fingerprint: null,
    currencyConflict: false,
  };

  return {
    success: true,
    rawValue: status,
    meta,
  };
}

/**
 * Compare two schema fingerprints to detect drift.
 *
 * @returns true if fingerprints indicate schema drift
 */
export function detectSchemaDrift(
  oldFingerprint: SchemaFingerprint | null,
  newFingerprint: SchemaFingerprint | null,
): { drifted: boolean; reason: string | null } {
  if (!oldFingerprint || !newFingerprint) {
    return { drifted: false, reason: null };
  }

  // Shape hash changed = likely schema restructuring
  if (oldFingerprint.shapeHash !== newFingerprint.shapeHash) {
    return { drifted: true, reason: 'Schema shape changed' };
  }

  // JSON-LD block count changed significantly
  if (Math.abs(oldFingerprint.jsonLdBlockCount - newFingerprint.jsonLdBlockCount) > 2) {
    return { drifted: true, reason: 'JSON-LD block count changed significantly' };
  }

  // Schema types changed
  const oldTypes = new Set(oldFingerprint.schemaTypes.map(t => t.toLowerCase()));
  const newTypes = new Set(newFingerprint.schemaTypes.map(t => t.toLowerCase()));
  const typesMatch = oldTypes.size === newTypes.size &&
    [...oldTypes].every(t => newTypes.has(t));

  if (!typesMatch) {
    return { drifted: true, reason: 'Schema types changed' };
  }

  return { drifted: false, reason: null };
}
