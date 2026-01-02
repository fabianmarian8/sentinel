import { Injectable, Logger } from '@nestjs/common';

/**
 * 2captcha.com Integration Service
 *
 * Provides two paid services:
 * 1. Residential Proxy - $0.70/GB for bypassing IP blocks
 * 2. DataDome CAPTCHA API - $1.45/1000 for solving DataDome challenges
 *
 * IMPORTANT: These are PAID services. Always try FREE options first!
 * See TieredFetchService for the correct order of operations.
 */

export interface ProxyFetchRequest {
  url: string;
  userAgent?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface ProxyFetchResult {
  success: boolean;
  html?: string;
  httpStatus?: number;
  error?: string;
  proxyUsed: boolean;
  cost?: number; // Estimated cost in USD
}

export interface DataDomeSolveRequest {
  websiteURL: string;
  captchaUrl: string; // geo.captcha-delivery.com URL from page
  userAgent: string;
  proxyType?: 'http' | 'socks5';
}

export interface DataDomeSolveResult {
  success: boolean;
  cookie?: string; // datadome cookie value
  error?: string;
  cost?: number; // $0.00145 per solve
}

@Injectable()
export class TwoCaptchaService {
  private readonly logger = new Logger(TwoCaptchaService.name);
  private readonly apiKey: string;
  private readonly proxyHost = 'proxy.2captcha.com';
  private readonly proxyPort = 8080;

  constructor() {
    this.apiKey = process.env.TWOCAPTCHA_API_KEY || '';
    if (!this.apiKey) {
      this.logger.warn('TWOCAPTCHA_API_KEY not set - paid services unavailable');
    }
  }

  /**
   * Check if 2captcha services are available
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Fetch URL through 2captcha residential proxy
   * Cost: ~$0.70/GB
   *
   * @param request - Fetch request options
   * @returns Fetch result with HTML
   */
  async fetchWithProxy(request: ProxyFetchRequest): Promise<ProxyFetchResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'TWOCAPTCHA_API_KEY not configured',
        proxyUsed: false,
      };
    }

    this.logger.log(`Fetching via 2captcha proxy: ${request.url}`);

    try {
      // 2captcha proxy format: http://apikey:@proxy.2captcha.com:8080
      const proxyUrl = `http://${this.apiKey}:@${this.proxyHost}:${this.proxyPort}`;

      // Use node-fetch with proxy agent
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const agent = new HttpsProxyAgent(proxyUrl);

      const response = await fetch(request.url, {
        // @ts-expect-error - agent is valid for node-fetch
        agent,
        headers: {
          'User-Agent':
            request.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          ...request.headers,
        },
        signal: AbortSignal.timeout(request.timeout || 30000),
      });

      const html = await response.text();

      // Estimate cost based on response size (~$0.70/GB)
      const sizeKb = Buffer.byteLength(html, 'utf8') / 1024;
      const cost = (sizeKb / (1024 * 1024)) * 0.7;

      this.logger.log(
        `Proxy fetch complete: ${response.status}, ${sizeKb.toFixed(1)}KB, ~$${cost.toFixed(6)}`,
      );

      return {
        success: response.ok,
        html,
        httpStatus: response.status,
        proxyUsed: true,
        cost,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Proxy fetch failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        proxyUsed: true,
      };
    }
  }

  /**
   * Solve DataDome CAPTCHA using 2captcha API
   * Cost: $1.45/1000 = $0.00145 per solve
   *
   * Uses the correct in.php endpoint with method=datadome
   * Requires proxy parameter for proper solving
   *
   * @param request - DataDome solve request
   * @returns Cookie value to bypass DataDome
   */
  async solveDataDome(
    request: DataDomeSolveRequest,
  ): Promise<DataDomeSolveResult> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'TWOCAPTCHA_API_KEY not configured',
      };
    }

    this.logger.log(`Solving DataDome for: ${request.websiteURL}`);
    this.logger.debug(`Captcha URL: ${request.captchaUrl}`);

    try {
      // Step 1: Submit CAPTCHA task using in.php with method=datadome
      // This is the correct endpoint for DataDome according to 2captcha docs
      const submitUrl = 'https://2captcha.com/in.php';
      const formData = new URLSearchParams({
        key: this.apiKey,
        method: 'datadome',
        captcha_url: request.captchaUrl,
        pageurl: request.websiteURL,
        userAgent: request.userAgent,
        // Use 2captcha's own proxy for solving
        proxy: `${this.apiKey}:@${this.proxyHost}:${this.proxyPort}`,
        proxytype: 'HTTP',
        json: '1',
      });

      const submitResponse = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      const submitResult = (await submitResponse.json()) as {
        status: number;
        request: string;
        error_text?: string;
      };

      if (submitResult.status !== 1) {
        this.logger.error(`DataDome submit failed: ${submitResult.request}`);
        return {
          success: false,
          error: submitResult.error_text || submitResult.request || 'Failed to submit task',
        };
      }

      const taskId = submitResult.request;
      this.logger.debug(`DataDome task created: ${taskId}`);

      // Step 2: Poll for result (max 120 seconds)
      const resultUrl = 'https://2captcha.com/res.php';
      const maxAttempts = 24; // 24 * 5s = 120s max
      let attempts = 0;

      while (attempts < maxAttempts) {
        await this.delay(5000); // Wait 5 seconds between polls
        attempts++;

        const resultResponse = await fetch(
          `${resultUrl}?key=${this.apiKey}&action=get&json=1&id=${taskId}`,
        );

        const result = (await resultResponse.json()) as {
          status: number;
          request: string;
          error_text?: string;
        };

        // Check if still processing
        if (result.request === 'CAPCHA_NOT_READY') {
          this.logger.debug(`DataDome polling attempt ${attempts}/${maxAttempts}`);
          continue;
        }

        // Check for errors
        if (result.status !== 1) {
          const errorCode = result.request;
          this.logger.error(`DataDome result error: ${errorCode}`);

          // Specific error handling
          if (errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') {
            this.logger.warn(
              `DataDome UNSOLVABLE: 2captcha workers could not solve this captcha. ` +
              `Site may have enhanced protection or proxy is blocked.`
            );
            return {
              success: false,
              error: 'CAPTCHA_UNSOLVABLE: Site protection too strong for 2captcha workers',
            };
          }

          if (errorCode === 'ERROR_PROXY_CONNECTION_FAILED') {
            this.logger.warn(`DataDome PROXY BLOCKED: Proxy is blocked by DataDome`);
            return {
              success: false,
              error: 'PROXY_BLOCKED: Proxy is blocked by DataDome protection',
            };
          }

          return {
            success: false,
            error: result.error_text || result.request || 'Task failed',
          };
        }

        // Success! Extract cookie from response
        // Response format: "datadome=<cookie_value>; ..."
        const cookieMatch = result.request.match(/datadome=([^;]+)/);
        const cookie = cookieMatch ? cookieMatch[1] : result.request;

        this.logger.log(`DataDome solved in ${attempts * 5}s`);
        return {
          success: true,
          cookie: cookie,
          cost: 0.00145, // $1.45/1000
        };
      }

      return {
        success: false,
        error: 'Timeout waiting for DataDome solution',
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`DataDome solve failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Fetch URL with DataDome bypass
   * Combines proxy + DataDome solver for full bypass
   *
   * @param url - URL to fetch
   * @param captchaUrl - DataDome captcha URL (geo.captcha-delivery.com/...)
   * @returns HTML content
   */
  async fetchWithDataDomeBypass(
    url: string,
    captchaUrl: string,
  ): Promise<ProxyFetchResult> {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // Step 1: Solve DataDome CAPTCHA
    const solveResult = await this.solveDataDome({
      websiteURL: url,
      captchaUrl,
      userAgent,
    });

    if (!solveResult.success || !solveResult.cookie) {
      return {
        success: false,
        error: `DataDome solve failed: ${solveResult.error}`,
        proxyUsed: false,
        cost: solveResult.cost,
      };
    }

    // Step 2: Fetch with solved cookie via proxy
    const result = await this.fetchWithProxy({
      url,
      userAgent,
      headers: {
        Cookie: `datadome=${solveResult.cookie}`,
      },
    });

    return {
      ...result,
      cost: (result.cost || 0) + (solveResult.cost || 0),
    };
  }

  /**
   * Extract DataDome captcha URL from blocked page HTML
   * DataDome pages contain a dd={...} JavaScript object with captcha parameters
   */
  extractDataDomeCaptchaUrl(html: string): string | null {
    // Method 1: Look for direct geo.captcha-delivery.com URL
    const directMatch = html.match(
      /https?:\/\/geo\.captcha-delivery\.com\/captcha\/[^\s"'<>]+/i,
    );
    if (directMatch) {
      return directMatch[0];
    }

    // Method 2: Extract from dd={...} JavaScript object
    // Format: var dd={'cid':'...','hsh':'...','t':'fe','host':'geo.captcha-delivery.com',...}
    const ddMatch = html.match(/var\s+dd\s*=\s*(\{[^}]+\})/);
    if (ddMatch) {
      try {
        // Parse the dd object (it's almost JSON, just need to handle single quotes)
        const ddStr = ddMatch[1].replace(/'/g, '"');
        const dd = JSON.parse(ddStr);

        if (dd.host && dd.cid) {
          // Construct captcha URL from dd parameters
          const params = new URLSearchParams();
          params.set('initialCid', dd.cid);
          if (dd.hsh) params.set('hash', dd.hsh);
          if (dd.t) params.set('t', dd.t);
          if (dd.s) params.set('s', String(dd.s));
          if (dd.e) params.set('e', dd.e);

          return `https://${dd.host}/captcha/?${params.toString()}`;
        }
      } catch (e) {
        this.logger.warn(`Failed to parse DataDome dd object: ${e}`);
      }
    }

    // Method 3: Look for ct.captcha-delivery.com script (fallback)
    const ctMatch = html.match(/src=["']https?:\/\/ct\.captcha-delivery\.com\/c\.js["']/);
    if (ctMatch) {
      // If we found the loader script, try to extract cid from the page
      const cidMatch = html.match(/'cid'\s*:\s*'([^']+)'/);
      if (cidMatch) {
        return `https://geo.captcha-delivery.com/captcha/?initialCid=${cidMatch[1]}`;
      }
    }

    return null;
  }

  /**
   * Check if HTML indicates DataDome block
   */
  isDataDomeBlocked(html: string): boolean {
    const htmlLower = html.toLowerCase();
    return (
      html.length < 10000 &&
      (htmlLower.includes('datadome') ||
        htmlLower.includes('captcha-delivery.com') ||
        htmlLower.includes('dd.js') ||
        htmlLower.includes('geo.captcha'))
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
