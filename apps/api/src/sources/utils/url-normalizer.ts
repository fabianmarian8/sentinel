/**
 * Normalizes URLs and extracts domain information
 */
export interface NormalizedUrl {
  canonical: string;
  domain: string;
}

/**
 * Normalize a URL by:
 * - Converting domain to lowercase
 * - Removing trailing slash from pathname
 * - Preserving query parameters and hash
 * - Extracting hostname as domain
 *
 * @param url - The URL to normalize
 * @returns Normalized URL and domain
 * @throws Error if URL is invalid
 */
export function normalizeUrl(url: string): NormalizedUrl {
  try {
    const parsed = new URL(url);

    // Extract and lowercase domain
    const domain = parsed.hostname.toLowerCase();

    // Build canonical URL
    // Remove trailing slash from pathname, but keep query and hash
    let pathname = parsed.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }

    // Reconstruct URL with normalized components
    const canonical = `${parsed.protocol}//${domain}${pathname}${parsed.search}${parsed.hash}`;

    return {
      canonical,
      domain,
    };
  } catch (error) {
    throw new Error(`Invalid URL format: ${url}`);
  }
}

/**
 * Validate if a string is a valid URL
 *
 * @param url - The URL to validate
 * @returns true if valid URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
