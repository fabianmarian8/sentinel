import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { AttributeTarget } from '@sentinel/shared';

/**
 * Extract value using XPath selector
 */
export function extractWithXPath(
  html: string,
  selector: string,
  attribute: AttributeTarget,
  contextSelector?: string | null
): string | null {
  try {
    // Wrap HTML in simple root element for XML parsing
    const wrappedHtml = `<root>${html}</root>`;
    const doc = new DOMParser().parseFromString(wrappedHtml, 'text/xml');

    // Apply context selector if provided
    let contextNode: Node = doc;
    if (contextSelector) {
      const contextResults = xpath.select(contextSelector, doc);
      if (!contextResults || (Array.isArray(contextResults) && contextResults.length === 0)) {
        return null; // Context not found
      }
      contextNode = Array.isArray(contextResults) ? contextResults[0] as Node : contextResults as Node;
    }

    // Execute XPath query within context
    const results = xpath.select(selector, contextNode);

    if (!results || (Array.isArray(results) && results.length === 0)) {
      return null; // No results found
    }

    const node = Array.isArray(results) ? results[0] : results;

    return extractNodeValue(node, attribute);
  } catch (error) {
    // XPath parsing or evaluation error
    return null;
  }
}

/**
 * Extract the specified attribute from an XPath result node
 */
function extractNodeValue(node: any, attribute: AttributeTarget): string | null {
  // Handle text nodes
  if (node.nodeType === 3) {
    return node.textContent || node.nodeValue || null;
  }

  // Handle attribute nodes
  if (node.nodeType === 2) {
    return node.value || null;
  }

  // Handle element nodes
  if (node.nodeType === 1) {
    if (attribute === 'text') {
      return getTextContent(node);
    }

    if (attribute === 'html') {
      return getInnerHTML(node);
    }

    if (attribute === 'value') {
      return node.getAttribute('value') || null;
    }

    // attr:name format
    if (attribute.startsWith('attr:')) {
      const attrName = attribute.slice(5);
      return node.getAttribute(attrName) || null;
    }
  }

  return null;
}

/**
 * Get text content from a DOM node (similar to innerText)
 */
function getTextContent(node: any): string {
  if (node.textContent !== undefined) {
    return node.textContent;
  }

  // Fallback: recursively collect text
  let text = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3) {
      text += child.nodeValue || '';
    } else if (child.nodeType === 1) {
      text += getTextContent(child);
    }
  }
  return text;
}

/**
 * Get inner HTML from a DOM node
 */
function getInnerHTML(node: any): string {
  let html = '';
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      // Element node
      html += serializeNode(child);
    } else if (child.nodeType === 3) {
      // Text node
      html += child.nodeValue || '';
    }
  }
  return html;
}

/**
 * Serialize a DOM node to HTML string
 */
function serializeNode(node: any): string {
  if (node.nodeType === 3) {
    return node.nodeValue || '';
  }

  if (node.nodeType !== 1) {
    return '';
  }

  let html = `<${node.nodeName.toLowerCase()}`;

  // Add attributes
  if (node.attributes) {
    for (let i = 0; i < node.attributes.length; i++) {
      const attr = node.attributes[i];
      html += ` ${attr.name}="${attr.value || ''}"`;
    }
  }

  html += '>';

  // Add children
  for (let child = node.firstChild; child; child = child.nextSibling) {
    html += serializeNode(child);
  }

  html += `</${node.nodeName.toLowerCase()}>`;

  return html;
}
