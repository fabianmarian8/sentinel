/**
 * Selector Healing Types
 *
 * Self-healing selector system that:
 * 1. Tries fallback selectors when primary fails
 * 2. Uses element fingerprinting to find similar elements
 * 3. Auto-generates new selectors from matched elements
 */

/**
 * Element fingerprint for similarity-based matching
 * Stored in database for existing rules, generated on successful extraction
 */
export interface ElementFingerprint {
  // Core identity
  tagName: string;
  id?: string;
  classNames: string[]; // Filtered - no CSS-in-JS hashes

  // Text content (for text-based matching)
  textContent: string; // First 100 chars, normalized
  textLength: number;

  // DOM structure context
  parentTag: string;
  parentClasses: string[];
  parentId?: string;
  grandparentTag?: string;
  siblingIndex: number; // Index among siblings of same tag
  depth: number; // Depth from body

  // Semantic attributes (stable identifiers)
  attributes: Record<string, string>; // data-*, aria-*, name, etc.

  // Visual characteristics (for validation)
  boundingBox?: {
    width: number;
    height: number;
  };
}

/**
 * Selector fingerprint stored in database
 * Contains healing strategies and validation anchors
 */
export interface SelectorFingerprint {
  // Primary selector
  selector: string;

  // Fallback selectors (ordered by reliability)
  alternativeSelectors: string[];

  // Text anchor for validation
  textAnchor?: string;

  // Parent context for structural validation
  parentContext?: {
    tag: string;
    classes: string[];
    id?: string;
  }[];

  // Element attributes for validation
  attributes?: Record<string, string>;

  // Element fingerprint for similarity matching
  elementFingerprint?: ElementFingerprint;

  // Last successful extraction timestamp
  lastSuccessAt?: string;

  // Healing history
  healingHistory?: {
    timestamp: string;
    oldSelector: string;
    newSelector: string;
    similarity: number;
  }[];
}

/**
 * Result of selector healing attempt
 */
export interface HealingResult {
  success: boolean;
  value: string | null;

  // Selector info
  selectorUsed: string;
  healingMethod?: 'fallback' | 'fingerprint' | 'primary';

  // If healed
  healed: boolean;
  healedFrom?: string;
  similarity?: number;

  // New fingerprint for storage
  newFingerprint?: ElementFingerprint;

  // Error if failed
  error?: string;
}

/**
 * Options for healing extraction
 */
export interface HealingOptions {
  // Primary selector
  selector: string;
  method: 'css' | 'xpath';
  attribute: string;

  // Fallback options
  fallbackSelectors?: string[];

  // Fingerprint for similarity matching
  storedFingerprint?: SelectorFingerprint;

  // Similarity threshold (0-1)
  similarityThreshold?: number; // default 0.6

  // High confidence threshold for auto-update
  autoUpdateThreshold?: number; // default 0.8

  // Text anchor for validation
  textAnchor?: string;

  // Enable fingerprint generation on success
  generateFingerprint?: boolean;
}

/**
 * CSS-in-JS class patterns to filter out
 * These change on every build and are unreliable for selectors
 */
export const CSS_IN_JS_PATTERNS = [
  /^css-[a-z0-9]+$/i, // Emotion
  /^sc-[a-z0-9]+$/i, // Styled Components
  /^_[a-z0-9]{5,}$/i, // CSS Modules (underscore prefix)
  /^[a-z]+__[a-z]+___[a-z0-9]+$/i, // BEM with hash
  /^[a-z0-9]{8,}$/i, // Pure hash classes
  /^jsx-[a-z0-9]+$/i, // styled-jsx
  /^tw-[a-z0-9]+$/i, // Tailwind JIT generated
  /^emotion-[a-z0-9]+$/i, // Emotion named
];

/**
 * Stable attribute names that are good for selectors
 */
export const STABLE_ATTRIBUTES = [
  'id',
  'name',
  'type',
  'role',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'data-testid',
  'data-test-id',
  'data-cy',
  'data-automation-id',
  'data-qa',
  'data-component',
  'data-section',
  'href',
  'for',
  'placeholder',
  'title',
  'alt',
];
