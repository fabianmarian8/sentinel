import * as cheerio from 'cheerio';
import { AttributeTarget } from '@sentinel/shared';

/**
 * Extract value using CSS selector with cheerio
 */
export function extractWithCSS(
  html: string,
  selector: string,
  attribute: AttributeTarget,
  contextSelector?: string | null
): string | null {
  try {
    const $ = cheerio.load(html);

    // Apply context selector if provided
    let element;
    if (contextSelector) {
      const root = $(contextSelector);
      if (root.length === 0) {
        return null; // Context not found
      }
      element = root.find(selector).first();
    } else {
      element = $(selector).first();
    }

    if (element.length === 0) {
      return null; // Element not found
    }

    const value = extractAttribute(element, attribute);

    // Return null for empty strings to be consistent
    return value && value.trim() !== '' ? value : null;
  } catch (error) {
    // Parsing or selector error
    return null;
  }
}

/**
 * Extract the specified attribute from a cheerio element
 */
function extractAttribute(element: cheerio.Cheerio<any>, attribute: AttributeTarget): string | null {
  if (attribute === 'text') {
    return element.text();
  }

  if (attribute === 'html') {
    return element.html();
  }

  if (attribute === 'value') {
    return element.val() as string || null;
  }

  // attr:name format
  if (attribute.startsWith('attr:')) {
    const attrName = attribute.slice(5); // Remove 'attr:' prefix
    return element.attr(attrName) || null;
  }

  return null;
}
