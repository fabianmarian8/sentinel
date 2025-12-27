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

  // For prices: compare numeric value and currency
  if (
    typeof a === 'object' &&
    'value' in a &&
    typeof b === 'object' &&
    'value' in b
  ) {
    return a.value === b.value && a.currency === b.currency;
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
