import {
  AvailabilityNormalization,
  NormalizedAvailability,
} from '@sentinel/shared';

/**
 * Normalizes availability status from raw text using configurable mapping rules.
 *
 * Algorithm:
 * 1. Normalize input (lowercase, collapse whitespace)
 * 2. Iterate through mapping rules in order
 * 3. For each rule, test match (regex or substring)
 * 4. Extract lead time days if configured
 * 5. Return first match or default status
 *
 * @param rawValue - Raw availability text from extraction
 * @param config - Availability normalization configuration
 * @returns Normalized availability with status and optional lead time
 */
export function normalizeAvailability(
  rawValue: string,
  config: AvailabilityNormalization
): NormalizedAvailability {
  // Step 1: Normalize input
  const normalized = rawValue.toLowerCase().replace(/\s+/g, ' ').trim();

  // Step 2-5: Iterate through mapping rules
  for (const rule of config.mapping) {
    const matchResult = testMatch(normalized, rule.match);

    if (matchResult) {
      const result: NormalizedAvailability = {
        status: rule.status,
        leadTimeDays: null,
      };

      // Extract lead time days if configured
      if (rule.extractLeadTimeDays && typeof matchResult === 'object') {
        const days = extractLeadTimeDays(matchResult[0]);
        if (days !== null) {
          result.leadTimeDays = days;
        }
      }

      return result;
    }
  }

  // No match found, return default status
  return {
    status: config.defaultStatus,
    leadTimeDays: null,
  };
}

/**
 * Tests if normalized text matches a rule pattern.
 * Returns RegExpMatchArray for regex matches, true for substring matches, or null for no match.
 */
function testMatch(
  normalized: string,
  matchPattern: string
): RegExpMatchArray | boolean | null {
  // Detect regex patterns by looking for regex metacharacters that indicate pattern intent
  // Only \d, \w, \s, ^, $, *, +, | indicate regex patterns
  // Parentheses, dots, and brackets alone might be literal characters
  const isRegex = /\\[dws]|[\^$*+|]/.test(matchPattern);

  if (isRegex) {
    try {
      const regex = new RegExp(matchPattern, 'i');
      const match = normalized.match(regex);
      return match || null;
    } catch (e) {
      // Invalid regex, fall back to substring match with word boundary
      const lowerPattern = matchPattern.toLowerCase();
      const index = normalized.indexOf(lowerPattern);
      if (index === -1) return null;

      // Check word boundaries
      const charBefore = normalized[index - 1];
      const charAfter = normalized[index + lowerPattern.length];
      const before = index === 0 || (charBefore !== undefined && /\s/.test(charBefore));
      const after = index + lowerPattern.length === normalized.length ||
                   (charAfter !== undefined && /\s/.test(charAfter));

      return (before && after) || null;
    }
  } else {
    // Simple substring match with word boundaries
    const lowerPattern = matchPattern.toLowerCase();
    const index = normalized.indexOf(lowerPattern);
    if (index === -1) return null;

    // Check word boundaries - match must be at start/end or surrounded by whitespace
    const charBefore = normalized[index - 1];
    const charAfter = normalized[index + lowerPattern.length];
    const before = index === 0 || (charBefore !== undefined && /\s/.test(charBefore));
    const after = index + lowerPattern.length === normalized.length ||
                 (charAfter !== undefined && /\s/.test(charAfter));

    return (before && after) || null;
  }
}

/**
 * Extracts numeric lead time days from matched text.
 * Looks for first number in the string.
 */
function extractLeadTimeDays(text: string): number | null {
  const match = text.match(/\d+/);
  if (match) {
    const days = parseInt(match[0], 10);
    return isNaN(days) ? null : days;
  }
  return null;
}
