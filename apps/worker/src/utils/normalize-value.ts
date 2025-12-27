import { normalizePrice, normalizeAvailability } from '@sentinel/extractor';
import type { NormalizationConfig, RuleType } from '@sentinel/shared';

/**
 * Normalize extracted value based on rule type and configuration
 *
 * @param rawValue Raw extracted value
 * @param config Normalization configuration
 * @param ruleType Type of rule
 * @returns Normalized value (JSON-serializable)
 */
export function normalizeValue(
  rawValue: string,
  config: NormalizationConfig | null,
  ruleType: RuleType
): any {
  if (!config) {
    return rawValue;
  }

  switch (config.kind) {
    case 'price':
      return normalizePrice(rawValue, config);

    case 'availability':
      return normalizeAvailability(rawValue, config);

    case 'text': {
      let text = rawValue;

      if (config.collapseWhitespace) {
        text = text.replace(/\s+/g, ' ').trim();
      }

      const maxLength = config.maxSnippetLength ?? 500;
      const snippet = text.length > maxLength ? text.slice(0, maxLength) : text;

      // Create hash for text comparison
      const hash = hashString(text);

      return {
        hash,
        snippet,
      };
    }

    case 'number': {
      let numberStr = rawValue;

      // Remove thousand separators
      if (config.thousandSeparators) {
        for (const sep of config.thousandSeparators) {
          numberStr = numberStr.replace(new RegExp(`\\${sep}`, 'g'), '');
        }
      }

      // Replace decimal separator with dot
      if (config.decimalSeparator === ',') {
        numberStr = numberStr.replace(',', '.');
      }

      const value = parseFloat(numberStr);

      if (isNaN(value)) {
        throw new Error(`Failed to parse number: ${rawValue}`);
      }

      // Apply scaling if needed
      if (config.scale) {
        return value * config.scale;
      }

      return value;
    }

    default:
      return rawValue;
  }
}

/**
 * Simple string hash function (djb2)
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}
