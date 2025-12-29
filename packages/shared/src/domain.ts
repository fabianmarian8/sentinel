// Domain types for Sentinel - Change Intelligence Platform

export type UUID = string;
export type WorkspaceType = "ecommerce" | "competitor" | "procurement";
export type RuleType = "price" | "availability" | "text" | "number" | "json_field";
export type FetchMode = "http" | "headless" | "flaresolverr";

export type ErrorCode =
  // Fetch errors
  | "FETCH_TIMEOUT" | "FETCH_DNS" | "FETCH_CONNECTION" | "FETCH_TLS" | "FETCH_HTTP_4XX" | "FETCH_HTTP_5XX"
  // Block detection
  | "BLOCK_CAPTCHA_SUSPECTED" | "BLOCK_CLOUDFLARE_SUSPECTED" | "BLOCK_FORBIDDEN_403" | "BLOCK_RATE_LIMIT_429"
  | "CAPTCHA_BLOCK" | "CLOUDFLARE_BLOCK" | "RATELIMIT_BLOCK" | "GEO_BLOCK" | "BOT_DETECTION"
  // Extraction errors
  | "EXTRACT_SELECTOR_NOT_FOUND" | "EXTRACT_EMPTY_VALUE" | "EXTRACT_PARSE_ERROR" | "EXTRACT_UNSTABLE"
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

export type SelectorMethod = "css" | "xpath" | "regex" | "jsonpath";

export interface FallbackSelector {
  method: Exclude<SelectorMethod, "regex" | "jsonpath">;
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
