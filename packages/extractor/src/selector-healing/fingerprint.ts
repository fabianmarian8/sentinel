/**
 * Element Fingerprinting
 *
 * Extract stable fingerprints from DOM elements for:
 * 1. Similarity-based healing when selectors break
 * 2. Validation of healed selectors
 * 3. Generation of alternative selectors
 */

import * as cheerio from 'cheerio';
import {
  ElementFingerprint,
  CSS_IN_JS_PATTERNS,
  STABLE_ATTRIBUTES,
} from './types';

/**
 * Extract fingerprint from a cheerio element
 */
export function extractFingerprint(
  $: cheerio.CheerioAPI,
  element: cheerio.Cheerio<any>
): ElementFingerprint {
  const el = element[0] as any;
  if (!el || el.type !== 'tag') {
    throw new Error('Invalid element for fingerprinting');
  }

  const tagName = el.tagName.toLowerCase();

  // Get ID if stable
  const id = el.attribs?.id;
  const stableId = id && !isUnstableClassName(id) ? id : undefined;

  // Get filtered class names
  const classAttr = el.attribs?.class || '';
  const classNames = classAttr
    .split(/\s+/)
    .filter((c: string) => c && !isUnstableClassName(c));

  // Get text content (normalized)
  const rawText = element.text() || '';
  const textContent = normalizeText(rawText).slice(0, 100);
  const textLength = rawText.length;

  // Get parent info
  const parent = element.parent();
  const parentEl = parent[0] as any;
  const parentTag = parentEl?.type === 'tag' ? parentEl.tagName.toLowerCase() : 'body';
  const parentClassAttr = parentEl?.type === 'tag' ? parentEl.attribs?.class || '' : '';
  const parentClasses = parentClassAttr
    .split(/\s+/)
    .filter((c: string) => c && !isUnstableClassName(c))
    .slice(0, 5);
  const parentId = parentEl?.type === 'tag' && parentEl.attribs?.id && !isUnstableClassName(parentEl.attribs.id)
    ? parentEl.attribs.id
    : undefined;

  // Get grandparent tag
  const grandparent = parent.parent();
  const grandparentEl = grandparent[0] as any;
  const grandparentTag = grandparentEl?.type === 'tag' ? grandparentEl.tagName.toLowerCase() : undefined;

  // Calculate sibling index
  const siblingIndex = calculateSiblingIndex($, element, tagName);

  // Calculate depth from body
  const depth = calculateDepth(element);

  // Extract stable attributes
  const attributes: Record<string, string> = {};
  if (el.attribs) {
    for (const attr of STABLE_ATTRIBUTES) {
      const value = el.attribs[attr];
      if (value && value.length < 200) {
        attributes[attr] = value;
      }
    }

    // Also include data-* attributes that look stable
    const attribsRecord = el.attribs as Record<string, string>;
    for (const [key, value] of Object.entries(attribsRecord)) {
      if (
        key.startsWith('data-') &&
        !key.includes('react') &&
        !key.includes('angular') &&
        !key.includes('vue') &&
        !key.includes('id') &&
        value &&
        value.length < 100
      ) {
        attributes[key] = value;
      }
    }
  }

  return {
    tagName,
    id: stableId,
    classNames,
    textContent,
    textLength,
    parentTag,
    parentClasses,
    parentId,
    grandparentTag,
    siblingIndex,
    depth,
    attributes,
  };
}

/**
 * Extract fingerprint from HTML string using a selector
 */
export function extractFingerprintFromHtml(
  html: string,
  selector: string
): ElementFingerprint | null {
  try {
    const $ = cheerio.load(html);
    const element = $(selector).first();

    if (element.length === 0) {
      return null;
    }

    return extractFingerprint($, element);
  } catch {
    return null;
  }
}

/**
 * Generate alternative selectors from a fingerprint
 */
export function generateAlternativeSelectors(
  fingerprint: ElementFingerprint
): string[] {
  const selectors: string[] = [];
  const tag = fingerprint.tagName;

  // Strategy 1: ID selector (most reliable)
  if (fingerprint.id) {
    selectors.push(`#${CSS.escape(fingerprint.id)}`);
  }

  // Strategy 2: data-testid (common in React apps)
  if (fingerprint.attributes['data-testid']) {
    selectors.push(`[data-testid="${CSS.escape(fingerprint.attributes['data-testid'])}"]`);
  }

  // Strategy 3: aria-label (semantic)
  if (fingerprint.attributes['aria-label']) {
    selectors.push(`[aria-label="${CSS.escape(fingerprint.attributes['aria-label'])}"]`);
  }

  // Strategy 4: name attribute (forms)
  if (fingerprint.attributes['name']) {
    selectors.push(`[name="${CSS.escape(fingerprint.attributes['name'])}"]`);
  }

  // Strategy 5: Stable data-* attributes
  for (const [key, value] of Object.entries(fingerprint.attributes)) {
    if (
      key.startsWith('data-') &&
      key !== 'data-testid' &&
      !key.includes('react') &&
      !key.includes('id')
    ) {
      selectors.push(`${tag}[${key}="${CSS.escape(value)}"]`);
    }
  }

  // Strategy 6: Parent ID + tag
  if (fingerprint.parentId) {
    selectors.push(`#${CSS.escape(fingerprint.parentId)} > ${tag}`);
    selectors.push(`#${CSS.escape(fingerprint.parentId)} ${tag}`);
  }

  // Strategy 7: Stable class names
  const stableClasses = fingerprint.classNames.filter(
    (c) => c.length > 2 && !c.match(/^[a-z0-9]+$/i)
  );
  if (stableClasses.length > 0) {
    selectors.push(`.${stableClasses.map(CSS.escape).join('.')}`);
    selectors.push(`${tag}.${stableClasses[0]}`);
  }

  // Strategy 8: Structural selector (tag + nth-of-type)
  if (fingerprint.siblingIndex >= 0) {
    const parentSelector = fingerprint.parentId
      ? `#${CSS.escape(fingerprint.parentId)}`
      : fingerprint.parentClasses.length > 0
        ? `.${fingerprint.parentClasses[0]}`
        : fingerprint.parentTag;

    selectors.push(`${parentSelector} > ${tag}:nth-of-type(${fingerprint.siblingIndex + 1})`);
  }

  // Remove duplicates and return
  return [...new Set(selectors)].slice(0, 10);
}

/**
 * Check if a class name is unstable (CSS-in-JS, generated hash, etc.)
 */
export function isUnstableClassName(className: string): boolean {
  if (!className || className.length < 2) return true;

  return CSS_IN_JS_PATTERNS.some((pattern) => pattern.test(className));
}

/**
 * Normalize text for comparison
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s$€£¥.,%-]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Calculate sibling index among same-tag siblings
 */
function calculateSiblingIndex(
  _$: cheerio.CheerioAPI,
  element: cheerio.Cheerio<any>,
  tagName: string
): number {
  const parent = element.parent();
  const siblings = parent.children(tagName);
  let index = 0;

  siblings.each((i: number, el: any) => {
    if (el === element[0]) {
      index = i;
      return false; // stop iteration
    }
    return true; // continue iteration
  });

  return index;
}

/**
 * Calculate depth from body
 */
function calculateDepth(element: cheerio.Cheerio<any>): number {
  let depth = 0;
  let current = element;

  while (current.length > 0 && current[0]?.type === 'tag') {
    const el = current[0] as any;
    if (el.tagName.toLowerCase() === 'body' || el.tagName.toLowerCase() === 'html') {
      break;
    }
    depth++;
    current = current.parent();
  }

  return depth;
}

// CSS.escape polyfill for Node.js
const CSS = {
  escape: (str: string): string => {
    return str.replace(/([^\w-])/g, '\\$1');
  },
};
