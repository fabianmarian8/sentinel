/**
 * Value comparison utilities for anti-flap logic
 *
 * Handles comparison of different value types:
 * - Prices (with currency)
 * - Availability (status + lead time)
 * - Text (using hash)
 * - Generic values (deep comparison)
 */

/**
 * Compare two values for equality
 *
 * Uses type-specific comparison logic:
 * - Prices: compare numeric value and currency
 * - Availability: compare status and leadTimeDays
 * - Text: compare hash
 * - Fallback: deep JSON comparison
 *
 * @param a First value
 * @param b Second value
 * @returns true if values are considered equal
 */
export function equals(a: any, b: any): boolean {
  // Handle null/undefined
  if (a === null && b === null) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }

  // For prices: compare using low-first strategy with cents for precision
  // Prefer valueLowCents (integer cents) to avoid float rounding issues
  // Fallback to valueLow/value for backward compatibility
  // Ignore valueHigh to prevent range-based flapping
  // Compare currency AND country (if both have it) - market context must match
  if (
    typeof a === 'object' &&
    ('value' in a || 'valueLow' in a || 'valueLowCents' in a) &&
    typeof b === 'object' &&
    ('value' in b || 'valueLow' in b || 'valueLowCents' in b)
  ) {
    // Country mismatch = different market context (even if same currency)
    // Only compare if both have country (backward compat with old observations)
    if (a.country && b.country && a.country !== b.country) {
      return false;
    }

    // Currency must match
    if (a.currency !== b.currency) {
      return false;
    }

    // Prefer cents comparison (integer, no float issues)
    // Fallback to float comparison for backward compatibility
    if (a.valueLowCents !== undefined && b.valueLowCents !== undefined) {
      return a.valueLowCents === b.valueLowCents;
    }

    // Fallback: compare float values (legacy observations)
    const aLow = a.valueLow ?? a.value;
    const bLow = b.valueLow ?? b.value;
    return aLow === bLow;
  }

  // For availability: compare status and lead time
  if (
    typeof a === 'object' &&
    'status' in a &&
    typeof b === 'object' &&
    'status' in b
  ) {
    return a.status === b.status && a.leadTimeDays === b.leadTimeDays;
  }

  // For text: compare hash
  if (
    typeof a === 'object' &&
    'hash' in a &&
    typeof b === 'object' &&
    'hash' in b
  ) {
    return a.hash === b.hash;
  }

  // Fallback: deep equal using JSON stringify
  // Note: This is not perfect (key order matters) but sufficient for our use case
  return JSON.stringify(a) === JSON.stringify(b);
}
