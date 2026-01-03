import { Injectable, Logger } from '@nestjs/common';
import { PROVIDER_COSTS } from '../types/fetch-result';

/**
 * Bright Data Web Unlocker Integration
 *
 * Uses Bright Data's Web Unlocker API for DataDome bypass
 * Pricing: Uses PROVIDER_COSTS.brightdata.perRequest (single source of truth)
 *
 * Features:
 * - AI-driven CAPTCHA solving
 * - Automatic IP rotation (100M+ pool)
 * - Browser fingerprinting
 * - DataDome detection and bypass
 */

export interface BrightDataFetchRequest {
  url: string;
  timeout?: number;
  format?: 'raw' | 'json';
  country?: string;
  // Note: Web Unlocker handles JS rendering automatically, no need for renderJs option
}

export interface BrightDataFetchResult {
  success: boolean;
  html?: string;
  httpStatus?: number;
  error?: string;
  cost?: number; // Uses PROVIDER_COSTS.brightdata.perRequest
}

@Injectable()
export class BrightDataService {
  private readonly logger = new Logger(BrightDataService.name);
  private readonly apiEndpoint = 'https://api.brightdata.com/request';
  private readonly apiToken: string;
  private readonly zoneName: string;

  constructor() {
    this.apiToken = process.env.BRIGHTDATA_API_KEY || '';
    this.zoneName = process.env.BRIGHTDATA_ZONE || 'web_unlocker1';

    if (!this.apiToken) {
      this.logger.warn('BRIGHTDATA_API_KEY not set - Bright Data services unavailable');
    } else {
      this.logger.log(`Bright Data initialized with zone: ${this.zoneName}`);
    }
  }

  /**
   * Check if Bright Data is available
   */
  isAvailable(): boolean {
    return !!this.apiToken;
  }

  /**
   * Fetch URL using Bright Data Web Unlocker API
   * Automatically handles:
   * - DataDome CAPTCHA
   * - Cloudflare challenges
   * - Bot detection
   * - IP rotation
   *
   * Cost: PROVIDER_COSTS.brightdata.perRequest (single source of truth)
   */
  async fetch(request: BrightDataFetchRequest): Promise<BrightDataFetchResult> {
    if (!this.apiToken) {
      return {
        success: false,
        error: 'BRIGHTDATA_API_KEY not configured',
      };
    }

    this.logger.log(`[BrightData] Fetching: ${request.url}`);
    const startTime = Date.now();

    try {
      const payload: Record<string, unknown> = {
        zone: this.zoneName,
        url: request.url,
        format: request.format || 'raw',
      };

      // Optional: Geo-targeting (Web Unlocker handles JS rendering automatically)
      if (request.country) {
        payload.country = request.country;
      }

      this.logger.debug(`[BrightData] Request payload: ${JSON.stringify(payload)}`);

      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(request.timeout || 60000),
      });

      const elapsed = Date.now() - startTime;

      // Debug: Log response details
      const headersObj = Object.fromEntries(response.headers.entries());
      this.logger.debug(`[BrightData] Response status: ${response.status}, headers: ${JSON.stringify(headersObj)}`);

      // Check for DataDome protection in headers (indicates CAPTCHA page returned)
      const xDatadome = response.headers.get('x-datadome');
      if (xDatadome === 'protected') {
        this.logger.warn(`[BrightData] x-datadome: protected header detected - CAPTCHA page likely returned`);
      }

      // Check for API errors
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `[BrightData] API error ${response.status}: ${errorText}`,
        );

        // Parse common errors
        if (response.status === 401) {
          return {
            success: false,
            error: 'BRIGHTDATA_AUTH_FAILED: Invalid API token',
            httpStatus: 401,
          };
        }

        if (response.status === 402) {
          return {
            success: false,
            error: 'BRIGHTDATA_INSUFFICIENT_BALANCE: Top up required',
            httpStatus: 402,
          };
        }

        if (response.status === 403) {
          return {
            success: false,
            error: 'BRIGHTDATA_ZONE_INACTIVE: Zone not active or wrong name',
            httpStatus: 403,
          };
        }

        return {
          success: false,
          error: `BRIGHTDATA_API_ERROR: ${response.status} - ${errorText}`,
          httpStatus: response.status,
        };
      }

      // Success - get HTML content
      const html = await response.text();
      const cost = PROVIDER_COSTS.brightdata.perRequest;

      this.logger.log(
        `[BrightData] Response received: ${html.length} bytes in ${elapsed}ms (~$${cost.toFixed(4)})`,
      );

      // Debug: Log first 500 chars of small responses to understand what we got
      if (html.length < 5000) {
        this.logger.debug(
          `[BrightData] Small response content preview: ${html.substring(0, 500).replace(/\n/g, ' ')}`,
        );
      }

      // Validate response - empty responses are failures
      if (!html || html.length === 0) {
        this.logger.error(`[BrightData] Empty response received from API`);
        return {
          success: false,
          error: 'BRIGHTDATA_EMPTY_RESPONSE: API returned empty content',
          httpStatus: response.status,
        };
      }

      // Check if response is still blocked (CAPTCHA page returned instead of actual content)
      // Check both small pages (traditional blocks) and CAPTCHA indicators in any size page
      const blockResult = this.isBlocked(html, xDatadome === 'protected');
      if (blockResult.blocked) {
        this.logger.warn(`[BrightData] Response appears blocked (${blockResult.reason}): ${html.substring(0, 300).replace(/\n/g, ' ')}`);
        return {
          success: false,
          html,
          error: `BRIGHTDATA_STILL_BLOCKED: ${blockResult.reason}`,
          httpStatus: response.status,
          cost, // Still costs money even if blocked
        };
      }

      return {
        success: true,
        html,
        httpStatus: 200,
        cost,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`[BrightData] Fetch failed: ${err.message}`);

      if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
        return {
          success: false,
          error: 'BRIGHTDATA_TIMEOUT: Request timed out',
        };
      }

      return {
        success: false,
        error: `BRIGHTDATA_FETCH_ERROR: ${err.message}`,
      };
    }
  }

  /**
   * Fetch with DataDome-specific settings
   * Uses US IP for best compatibility (JS rendering is automatic)
   */
  async fetchWithDataDomeBypass(url: string): Promise<BrightDataFetchResult> {
    return this.fetch({
      url,
      country: 'us',
      timeout: 90000, // DataDome solving can take longer
    });
  }

  /**
   * Check if HTML indicates content is blocked (DataDome, Cloudflare, etc.)
   * Used to verify if bypass was successful
   *
   * @param html - The HTML content to check
   * @param hasDataDomeHeader - Whether x-datadome: protected header was present
   * @returns Object with blocked status and reason
   */
  isBlocked(html: string, hasDataDomeHeader = false): { blocked: boolean; reason: string } {
    if (!html) {
      return { blocked: true, reason: 'Empty response' };
    }

    const htmlLower = html.toLowerCase();

    // CAPTCHA page patterns (check regardless of page size)
    // These indicate the actual CAPTCHA challenge page was returned
    const captchaPatterns = [
      { pattern: 'nie s robotom', reason: 'DataDome CAPTCHA (Slovak)' },
      { pattern: 'not a robot', reason: 'DataDome CAPTCHA (English)' },
      { pattern: 'geo.captcha-delivery.com', reason: 'DataDome CAPTCHA delivery' },
      { pattern: 'posunutím doprava zložte puzzle', reason: 'DataDome puzzle CAPTCHA' },
      { pattern: 'slide to complete the puzzle', reason: 'DataDome puzzle CAPTCHA' },
      { pattern: 'dd.datadome.', reason: 'DataDome script' },
      { pattern: 'captcha-delivery.com/captcha', reason: 'DataDome CAPTCHA iframe' },
    ];

    for (const { pattern, reason } of captchaPatterns) {
      if (htmlLower.includes(pattern)) {
        return { blocked: true, reason };
      }
    }

    // If x-datadome: protected header is present, check for thin content
    // (real pages are usually much larger and have product-specific content)
    if (hasDataDomeHeader) {
      // Check if the page lacks typical product page indicators
      const hasProductContent =
        htmlLower.includes('add to cart') ||
        htmlLower.includes('buy now') ||
        htmlLower.includes('price') ||
        htmlLower.includes('product');

      if (!hasProductContent && html.length < 100000) {
        return { blocked: true, reason: 'DataDome header + no product content' };
      }
    }

    // Traditional block page patterns (only for small pages)
    if (html.length < 5000) {
      const blockPatterns = [
        { pattern: 'access denied', reason: 'Access denied' },
        { pattern: 'blocked', reason: 'Blocked message' },
        { pattern: 'cloudflare', reason: 'Cloudflare challenge' },
        { pattern: 'checking your browser', reason: 'Browser check' },
        { pattern: 'ray id', reason: 'Cloudflare Ray ID' },
      ];

      for (const { pattern, reason } of blockPatterns) {
        if (htmlLower.includes(pattern)) {
          return { blocked: true, reason };
        }
      }
    }

    return { blocked: false, reason: '' };
  }
}
