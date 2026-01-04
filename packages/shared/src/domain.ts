// Domain types for Sentinel - Change Intelligence Platform

export type UUID = string;
export type WorkspaceType = "ecommerce" | "competitor" | "procurement";
export type RuleType = "price" | "availability" | "text" | "number" | "json_field";
export type FetchMode = "http" | "headless" | "flaresolverr";

/**
 * Error codes for Sentinel run failures
 *
 * Categories:
 * - FETCH_*: Network/HTTP errors
 * - BLOCK_*: Bot detection/blocking
 * - EXTRACT_*: Selector/parsing errors
 * - SYSTEM_*: Internal errors
 *
 * @deprecated Legacy codes (without prefix) will be removed in v2.0
 * Use prefixed versions: BLOCK_CAPTCHA_SUSPECTED instead of CAPTCHA_BLOCK
 */
export type ErrorCode =
  // Fetch errors
  | "FETCH_TIMEOUT" | "FETCH_DNS" | "FETCH_CONNECTION" | "FETCH_TLS" | "FETCH_HTTP_4XX" | "FETCH_HTTP_5XX"
  // Block detection (preferred)
  | "BLOCK_CAPTCHA_SUSPECTED" | "BLOCK_CLOUDFLARE_SUSPECTED" | "BLOCK_FORBIDDEN_403" | "BLOCK_RATE_LIMIT_429"
  // Block detection (legacy - deprecated)
  | "CAPTCHA_BLOCK" | "CLOUDFLARE_BLOCK" | "RATELIMIT_BLOCK" | "GEO_BLOCK" | "BOT_DETECTION"
  // Extraction errors
  | "EXTRACT_SELECTOR_NOT_FOUND" | "EXTRACT_SCHEMA_NOT_FOUND" | "EXTRACT_EMPTY_VALUE" | "EXTRACT_PARSE_ERROR" | "EXTRACT_UNSTABLE"
  // Extraction (legacy - deprecated)
  | "SELECTOR_BROKEN" | "SELECTOR_HEALED" | "JSON_PATH_BROKEN" | "PARSE_ERROR"
  // System errors
  | "SYSTEM_WORKER_CRASH" | "SYSTEM_QUEUE_DELAY"
  // Unknown
  | "UNKNOWN";

export type AttributeTarget = "text" | "html" | "value" | `attr:${string}`;

export type PostprocessOp =
  | { op: "trim" }
  | { op: "lowercase" }
  | { op: "uppercase" }
  | { op: "collapse_whitespace" }
  | { op: "replace"; from: string; to: string }
  | { op: "regex_extract"; pattern: string; group: number };

export type SelectorMethod = "css" | "xpath" | "regex" | "schema";
// Note: jsonpath removed - not implemented, blocked at API level
// schema: extracts from JSON-LD (schema.org) with meta tag fallback

export interface FallbackSelector {
  method: Exclude<SelectorMethod, "regex" | "schema">;
  selector: string;
}

export interface ExtractionConfig {
  method: SelectorMethod;
  selector: string;
  attribute: AttributeTarget;
  postprocess: PostprocessOp[];
  fallbackSelectors: FallbackSelector[];
  context?: string | null;
}

export interface ScheduleConfig {
  intervalSeconds: number;
  jitterSeconds: number;
  activeHours?: { from: string; to: string } | null;
}

// Normalization types
export type NormalizationKind = "price" | "availability" | "text" | "number" | "json_field";

export interface PriceNormalization {
  kind: "price";
  locale: string;
  currency: string;
  decimalSeparator?: "," | ".";
  thousandSeparators?: string[];
  stripTokens?: string[];
  scale?: number;
}

export type AvailabilityStatus = "in_stock" | "out_of_stock" | "backorder" | "lead_time" | "unknown";

export interface AvailabilityMappingRule {
  match: string;
  status: AvailabilityStatus;
  extractLeadTimeDays?: boolean;
}

export interface AvailabilityNormalization {
  kind: "availability";
  mapping: AvailabilityMappingRule[];
  defaultStatus: AvailabilityStatus;
}

export interface TextNormalization {
  kind: "text";
  collapseWhitespace?: boolean;
  maxSnippetLength?: number;
}

export interface NumberNormalization {
  kind: "number";
  decimalSeparator?: "," | ".";
  thousandSeparators?: string[];
  scale?: number;
}

export type NormalizationConfig =
  | PriceNormalization
  | AvailabilityNormalization
  | TextNormalization
  | NumberNormalization;

// Alert Policy types
export type Severity = "info" | "warning" | "critical";

export type AlertConditionType =
  // Legacy PRD condition types
  | "price_below" | "price_above" | "price_drop_percent"
  | "availability_is" | "text_changed" | "number_changed"
  | "number_below" | "number_above"
  // API condition types (generic)
  | "value_changed" | "value_increased" | "value_decreased"
  | "value_above" | "value_below"
  | "value_disappeared" | "value_appeared";

export interface AlertCondition {
  id: string;
  type: AlertConditionType;
  value: number | string | boolean;
  severity: Severity;
  threshold?: number;
}

export interface AlertPolicy {
  requireConsecutive: number;
  cooldownSeconds: number;
  conditions: AlertCondition[];
  channels: string[];
}

// Job schemas for BullMQ
export interface RunJobPayload {
  ruleId: UUID;
  trigger: "schedule" | "manual_test" | "retry";
  requestedAt: string;
  forceMode?: FetchMode | null;
  debug?: boolean;
}

export interface AlertDispatchPayload {
  alertId: UUID;
  workspaceId: UUID;
  ruleId: UUID;
  channels: string[];
  dedupeKey: string;
}

// Normalized values
export interface NormalizedPrice {
  value: number;
  currency: string;
}

export interface NormalizedAvailability {
  status: AvailabilityStatus;
  leadTimeDays?: number | null;
}

export interface NormalizedText {
  hash: string;
  snippet: string;
}

// Schema.org extraction types
export type SchemaQueryKind = "price" | "availability";
export type SchemaPricePreference = "price" | "low" | "high";
export type SchemaSource = "auto" | "jsonld" | "meta";

export interface SchemaQuery {
  kind: SchemaQueryKind;
  prefer?: SchemaPricePreference; // for price: which value to use as primary
  source?: SchemaSource; // auto = jsonld first, then meta
}

export interface SchemaFingerprint {
  schemaTypes: string[]; // e.g. ["Product", "AggregateOffer"]
  shapeHash: string; // hash of sorted keys for drift detection
  jsonLdBlockCount: number;
  hasOffers: boolean;
  hasMeta: boolean;
  timestamp: string;
}

export interface SchemaExtractionMeta {
  source: "jsonld" | "meta";
  schemaTypes: string[];
  currency: string | null;
  valueLow: number | null;
  valueHigh: number | null;
  // Integer cents for precise comparison (avoids float rounding issues)
  valueLowCents: number | null;
  valueHighCents: number | null;
  availabilityUrl: string | null;
  offersCount: number | null;
  offersTruncated: boolean;
  fingerprint: SchemaFingerprint | null;
  currencyConflict: boolean;
}

export interface SchemaExtractionResult {
  success: boolean;
  rawValue: string | null; // scalar for pipeline, e.g. "26.74"
  meta: SchemaExtractionMeta | null;
  error?: string;
}

// Availability mapping from schema.org URLs
export const SCHEMA_AVAILABILITY_MAP: Record<string, AvailabilityStatus> = {
  "https://schema.org/InStock": "in_stock",
  "http://schema.org/InStock": "in_stock",
  "https://schema.org/OutOfStock": "out_of_stock",
  "http://schema.org/OutOfStock": "out_of_stock",
  "https://schema.org/BackOrder": "backorder",
  "http://schema.org/BackOrder": "backorder",
  "https://schema.org/PreOrder": "backorder",
  "http://schema.org/PreOrder": "backorder",
  "https://schema.org/LimitedAvailability": "in_stock",
  "http://schema.org/LimitedAvailability": "in_stock",
  "https://schema.org/Discontinued": "out_of_stock",
  "http://schema.org/Discontinued": "out_of_stock",
};

export type ChangeKind =
  | "new_value"
  | "value_changed"
  | "value_disappeared"
  | "format_changed"
  | "threshold_exceeded"
  | "increased"
  | "decreased"
  | "text_diff"
  | "status_change"
  | "unknown";
