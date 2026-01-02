import { ExtractionConfig } from '@sentinel/shared';
import { ExtractionResult } from './types';
import { extractWithCSS } from './css';
import { extractWithXPath } from './xpath';
import { extractWithRegex } from './regex';
import { applyPostprocess } from './postprocess';

/**
 * Main extraction function
 * Supports CSS, XPath, and Regex selectors with fallback chains and postprocessing
 */
export function extract(html: string, config: ExtractionConfig): ExtractionResult {
  // Try primary selector
  let value = extractWithMethod(html, config.method, config.selector, config.attribute, config.context);
  let selectorUsed = config.selector;
  let fallbackUsed = false;

  // If primary selector failed, try fallback selectors
  const fallbacks = config.fallbackSelectors ?? [];
  if (value === null && fallbacks.length > 0) {
    for (const fallback of fallbacks) {
      value = extractWithMethod(html, fallback.method, fallback.selector, config.attribute, config.context);
      if (value !== null) {
        selectorUsed = fallback.selector;
        fallbackUsed = true;
        break;
      }
    }
  }

  // If extraction failed completely
  if (value === null) {
    return {
      success: false,
      value: null,
      selectorUsed,
      fallbackUsed,
      error: 'Selector not found or returned empty value',
    };
  }

  // Apply postprocessing operations
  const postprocessOps = config.postprocess ?? [];
  const processedValue = postprocessOps.length > 0 ? applyPostprocess(value, postprocessOps) : value;

  return {
    success: true,
    value: processedValue,
    selectorUsed,
    fallbackUsed,
  };
}

/**
 * Extract value using the specified method
 */
function extractWithMethod(
  html: string,
  method: ExtractionConfig['method'],
  selector: string,
  attribute: ExtractionConfig['attribute'],
  context?: string | null
): string | null {
  switch (method) {
    case 'css':
      return extractWithCSS(html, selector, attribute, context);

    case 'xpath':
      return extractWithXPath(html, selector, attribute, context);

    case 'regex':
      // Regex doesn't support attribute or context
      return extractWithRegex(html, selector);

    // jsonpath removed - blocked at API validation level

    default:
      return null;
  }
}
