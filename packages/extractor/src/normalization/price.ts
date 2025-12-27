import { PriceNormalization, NormalizedPrice } from '@sentinel/shared';

/**
 * Normalizes a raw price string into a structured numeric value with currency.
 *
 * Handles multiple locale formats:
 * - Slovak: "1 299,00 €" → { value: 1299.00, currency: "EUR" }
 * - US: "$1,299.99" → { value: 1299.99, currency: "USD" }
 * - German: "1.299,00 EUR" → { value: 1299.00, currency: "EUR" }
 *
 * @param rawValue - Raw price string extracted from web page
 * @param config - Price normalization configuration with locale settings
 * @returns Normalized price object or null if parsing fails
 */
export function normalizePrice(
  rawValue: string,
  config: PriceNormalization
): NormalizedPrice | null {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  let processed = rawValue.trim();

  // Step 1: Strip currency tokens (€, EUR, $, USD, etc.)
  const defaultStripTokens = ['€', 'EUR', 'eur', '$', 'USD', 'usd', config.currency, config.currency.toLowerCase()];
  const stripTokens = config.stripTokens || defaultStripTokens;

  for (const token of stripTokens) {
    // Case-insensitive replacement
    const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    processed = processed.replace(regex, '');
  }

  // Step 2: Trim all whitespace including NBSP (\u00A0)
  processed = processed.replace(/\s+/g, ' ').trim();

  // Step 3: Determine decimal and thousand separators based on locale defaults
  let decimalSeparator = config.decimalSeparator;
  let thousandSeparators = config.thousandSeparators;

  if (!decimalSeparator || !thousandSeparators) {
    // Auto-detect based on locale
    const localeDefaults = getLocaleDefaults(config.locale);
    decimalSeparator = decimalSeparator || localeDefaults.decimalSeparator;
    thousandSeparators = thousandSeparators || localeDefaults.thousandSeparators;
  }

  // Step 4: Remove thousand separators
  for (const separator of thousandSeparators) {
    const regex = new RegExp(separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    processed = processed.replace(regex, '');
  }

  // Step 5: Convert decimal separator to "."
  if (decimalSeparator === ',') {
    // Replace comma with dot, but only the last comma (decimal point)
    const lastCommaIndex = processed.lastIndexOf(',');
    if (lastCommaIndex !== -1) {
      processed = processed.substring(0, lastCommaIndex) + '.' + processed.substring(lastCommaIndex + 1);
    }
  }

  // Step 6: Parse as float
  const numericValue = parseFloat(processed);

  if (isNaN(numericValue) || !isFinite(numericValue)) {
    return null;
  }

  // Step 7: Round to scale decimal places (default 2)
  const scale = config.scale ?? 2;
  const multiplier = Math.pow(10, scale);
  const roundedValue = Math.round(numericValue * multiplier) / multiplier;

  return {
    value: roundedValue,
    currency: config.currency
  };
}

/**
 * Returns default decimal and thousand separators for common locales.
 * Falls back to en-US format if locale is unknown.
 */
function getLocaleDefaults(locale: string): {
  decimalSeparator: ',' | '.';
  thousandSeparators: string[];
} {
  const normalizedLocale = locale.toLowerCase();

  // Slovak, Czech, German - comma decimal, space/dot thousand separator
  if (normalizedLocale.startsWith('sk') ||
      normalizedLocale.startsWith('cs') ||
      normalizedLocale.startsWith('de') ||
      normalizedLocale.startsWith('fr') ||
      normalizedLocale.startsWith('es') ||
      normalizedLocale.startsWith('it')) {
    return {
      decimalSeparator: ',',
      thousandSeparators: [' ', '\u00A0', '.']
    };
  }

  // US, UK - dot decimal, comma thousand separator
  if (normalizedLocale.startsWith('en')) {
    return {
      decimalSeparator: '.',
      thousandSeparators: [',', ' ', '\u00A0']
    };
  }

  // Default to US format
  return {
    decimalSeparator: '.',
    thousandSeparators: [',', ' ', '\u00A0']
  };
}
