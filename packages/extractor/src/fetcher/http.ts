// HTTP fetcher using undici
import { request } from 'undici';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'zlib';
import type { FetchResult, FetchOptions } from './types';
import { getRandomUserAgent } from './user-agents';

/**
 * Decompress response body based on Content-Encoding header
 */
function decompressBody(buffer: Buffer, encoding: string | null): string {
  if (!encoding) {
    return buffer.toString('utf-8');
  }

  const enc = encoding.toLowerCase().trim();

  try {
    if (enc === 'gzip' || enc === 'x-gzip') {
      return gunzipSync(buffer).toString('utf-8');
    } else if (enc === 'deflate') {
      return inflateSync(buffer).toString('utf-8');
    } else if (enc === 'br') {
      return brotliDecompressSync(buffer).toString('utf-8');
    } else if (enc === 'identity' || enc === '') {
      return buffer.toString('utf-8');
    } else {
      // Unknown encoding, try raw
      return buffer.toString('utf-8');
    }
  } catch {
    // Decompression failed, return as-is
    return buffer.toString('utf-8');
  }
}

const DEFAULT_TIMEOUT = 15000;
const MAX_REDIRECTS = 5;

/**
 * Fetch a URL using undici with comprehensive error handling and timing capture
 */
export async function fetchHttp(options: FetchOptions): Promise<FetchResult> {
  const startTime = Date.now();
  const {
    url,
    timeout = DEFAULT_TIMEOUT,
    userAgent = getRandomUserAgent(),
    headers = {},
    cookies,
    followRedirects = true,
    acceptEncoding = true,
  } = options;

  // Prepare headers
  const requestHeaders: Record<string, string> = {
    'User-Agent': userAgent,
    ...headers,
  };

  if (acceptEncoding) {
    requestHeaders['Accept-Encoding'] = 'gzip, deflate, br';
  }

  if (cookies) {
    requestHeaders['Cookie'] = cookies;
  }

  const result: FetchResult = {
    success: false,
    url,
    finalUrl: url,
    httpStatus: null,
    contentType: null,
    html: null,
    errorCode: null,
    errorDetail: null,
    timings: {
      total: 0,
    },
    headers: {},
  };

  try {
    const response = await request(url, {
      method: 'GET',
      headers: requestHeaders,
      maxRedirections: followRedirects ? MAX_REDIRECTS : 0,
      headersTimeout: timeout,
      bodyTimeout: timeout,
    });

    const endTime = Date.now();
    result.timings.total = endTime - startTime;

    // Capture response metadata
    result.httpStatus = response.statusCode;
    result.finalUrl = url; // undici doesn't expose final URL directly, would need custom redirect handling

    // Capture headers
    const responseHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === 'string') {
        responseHeaders[key] = value;
      } else if (Array.isArray(value)) {
        responseHeaders[key] = value.join(', ');
      }
    }
    result.headers = responseHeaders;

    // Capture content type
    result.contentType = responseHeaders['content-type'] || null;

    // Get content-encoding for decompression
    const contentEncoding = responseHeaders['content-encoding'] || null;

    // Handle HTTP status codes
    if (response.statusCode >= 400 && response.statusCode < 500) {
      result.errorCode = 'FETCH_HTTP_4XX';
      result.errorDetail = `HTTP ${response.statusCode}`;

      // Read body even on error for debugging
      try {
        const buffer = Buffer.from(await response.body.arrayBuffer());
        result.html = decompressBody(buffer, contentEncoding);
      } catch {
        // Ignore body read errors
      }

      return result;
    }

    if (response.statusCode >= 500) {
      result.errorCode = 'FETCH_HTTP_5XX';
      result.errorDetail = `HTTP ${response.statusCode}`;

      try {
        const buffer = Buffer.from(await response.body.arrayBuffer());
        result.html = decompressBody(buffer, contentEncoding);
      } catch {
        // Ignore body read errors
      }

      return result;
    }

    // Read response body with decompression
    const buffer = Buffer.from(await response.body.arrayBuffer());
    result.html = decompressBody(buffer, contentEncoding);
    result.success = true;

    return result;

  } catch (error: any) {
    const endTime = Date.now();
    result.timings.total = endTime - startTime;

    // Classify errors
    if (error.code === 'UND_ERR_CONNECT_TIMEOUT' || error.code === 'UND_ERR_HEADERS_TIMEOUT' || error.code === 'UND_ERR_BODY_TIMEOUT') {
      result.errorCode = 'FETCH_TIMEOUT';
      result.errorDetail = `Request timeout after ${timeout}ms`;
    } else if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      result.errorCode = 'FETCH_DNS';
      result.errorDetail = `DNS lookup failed: ${error.message}`;
    } else if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'EPIPE' ||
      error.code === 'EHOSTUNREACH' ||
      error.code === 'ENETUNREACH'
    ) {
      result.errorCode = 'FETCH_CONNECTION';
      result.errorDetail = `Connection failed: ${error.code} - ${error.message}`;
    } else {
      // Generic connection error for unknown cases
      result.errorCode = 'FETCH_CONNECTION';
      result.errorDetail = `Fetch failed: ${error.message}`;
    }

    return result;
  }
}
