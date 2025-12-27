/**
 * Extract value using regex pattern
 * Note: context selector is not applicable for regex extraction
 */
export function extractWithRegex(
  html: string,
  pattern: string
): string | null {
  try {
    const regex = new RegExp(pattern);
    const match = html.match(regex);

    if (!match) {
      return null;
    }

    // Return first capturing group if exists, otherwise full match
    return match[1] !== undefined ? match[1] : match[0];
  } catch (error) {
    // Invalid regex pattern
    return null;
  }
}
