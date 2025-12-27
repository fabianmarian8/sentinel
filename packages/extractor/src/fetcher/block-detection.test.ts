// Block detection tests
import { detectBlock, blockTypeToErrorCode } from './block-detection';

describe('detectBlock', () => {
  describe('HTTP status-based detection', () => {
    it('should detect 429 rate limit with high confidence', () => {
      const result = detectBlock(429, null, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('rate_limit');
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toBe('Reduce check frequency for this domain');
    });

    it('should detect 403 forbidden with high confidence', () => {
      const result = detectBlock(403, null, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('forbidden');
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toContain('authentication or try headless mode');
    });

    it('should detect 403 as cloudflare when Cloudflare headers present', () => {
      const result = detectBlock(403, null, { 'cf-ray': '123456789abc-SJC' });

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare');
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toContain('headless mode or reduce request frequency');
    });

    it('should detect 503 as cloudflare when Cloudflare headers present', () => {
      const result = detectBlock(503, null, { 'cf-cache-status': 'DYNAMIC' });

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare');
      expect(result.confidence).toBe('high');
    });

    it('should not detect 503 without Cloudflare headers', () => {
      const result = detectBlock(503, null, {});

      expect(result.blocked).toBe(false);
      expect(result.blockType).toBe(null);
    });

    it('should not detect blocks for 200 status', () => {
      const result = detectBlock(200, null, {});

      expect(result.blocked).toBe(false);
      expect(result.blockType).toBe(null);
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toBe(null);
    });
  });

  describe('HTML content-based detection', () => {
    it('should detect Cloudflare challenge page', () => {
      const html = `
        <html>
          <head><title>Just a moment...</title></head>
          <body>
            <div id="cf-browser-verification">
              Checking your browser before accessing example.com
            </div>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, { 'cf-ray': '123' });

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare');
      expect(result.confidence).toBe('high');
    });

    it('should detect reCAPTCHA with high confidence', () => {
      const html = `
        <html>
          <body>
            <div class="g-recaptcha" data-sitekey="xxx"></div>
            <script src="https://www.google.com/recaptcha/api.js"></script>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('captcha');
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toContain('headless mode with longer wait times');
    });

    it('should detect hCaptcha', () => {
      const html = `
        <html>
          <body>
            <div class="h-captcha" data-sitekey="xxx"></div>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('captcha');
      expect(result.confidence).toBe('high');
    });

    it('should detect rate limit message in HTML', () => {
      const html = `
        <html>
          <body>
            <h1>Too Many Requests</h1>
            <p>You have exceeded the rate limit. Please try again later.</p>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('rate_limit');
      expect(result.confidence).toBe('medium');
    });

    it('should detect geo-blocking message', () => {
      const html = `
        <html>
          <body>
            <h1>Access Denied</h1>
            <p>This content is not available in your country.</p>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('geo_block');
      expect(result.confidence).toBe('high');
      expect(result.recommendation).toContain('proxy from allowed region');
    });

    it('should detect bot detection with small HTML and "access denied"', () => {
      const html = `
        <html>
          <body>
            <h1>Access Denied</h1>
            <p>Automated access detected and blocked.</p>
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('bot_detection');
      expect(result.confidence).toBe('medium');
    });

    it('should detect blocking with small HTML and protection headers', () => {
      const html = '<html><body>Error</body></html>';

      const result = detectBlock(200, html, { 'cf-ray': '123' });

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare');
      expect(result.confidence).toBe('low');
    });

    it('should not detect blocks with normal 200 response and sufficient content', () => {
      const html = `
        <html>
          <head><title>Product Page</title></head>
          <body>
            <h1>Amazing Product</h1>
            <p>This is a normal product page with plenty of content.</p>
            <div class="price">$99.99</div>
            <div class="description">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit.
              Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
              Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
            </div>
          </body>
        </html>
      `.repeat(10); // Make it large enough

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(false);
      expect(result.blockType).toBe(null);
      expect(result.confidence).toBe('high');
    });
  });

  describe('Priority of detection methods', () => {
    it('should prioritize HTTP status over HTML content', () => {
      const html = '<html><body>Normal content</body></html>';

      const result = detectBlock(429, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('rate_limit');
      expect(result.confidence).toBe('high');
    });

    it('should prioritize Cloudflare patterns over other patterns', () => {
      const html = `
        <html>
          <body>
            Checking your browser before accessing site.com
            This page contains a CAPTCHA
          </body>
        </html>
      `;

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare'); // Not captcha
    });
  });

  describe('Edge cases', () => {
    it('should handle null HTTP status', () => {
      const result = detectBlock(null, null, {});

      expect(result.blocked).toBe(false);
      expect(result.blockType).toBe(null);
    });

    it('should handle null HTML', () => {
      const result = detectBlock(200, null, {});

      expect(result.blocked).toBe(false);
      expect(result.blockType).toBe(null);
    });

    it('should handle empty headers', () => {
      const html = '<html><body>Test</body></html>';

      const result = detectBlock(200, html, {});

      expect(result.blocked).toBe(false);
    });

    it('should handle case-insensitive header matching', () => {
      const result = detectBlock(403, null, { 'CF-Ray': '123456789abc-SJC' });

      expect(result.blocked).toBe(true);
      expect(result.blockType).toBe('cloudflare');
    });
  });
});

describe('blockTypeToErrorCode', () => {
  it('should map captcha to BLOCK_CAPTCHA_SUSPECTED', () => {
    expect(blockTypeToErrorCode('captcha')).toBe('BLOCK_CAPTCHA_SUSPECTED');
  });

  it('should map cloudflare to BLOCK_CLOUDFLARE_SUSPECTED', () => {
    expect(blockTypeToErrorCode('cloudflare')).toBe('BLOCK_CLOUDFLARE_SUSPECTED');
  });

  it('should map rate_limit to BLOCK_RATE_LIMIT_429', () => {
    expect(blockTypeToErrorCode('rate_limit')).toBe('BLOCK_RATE_LIMIT_429');
  });

  it('should map forbidden to BLOCK_FORBIDDEN_403', () => {
    expect(blockTypeToErrorCode('forbidden')).toBe('BLOCK_FORBIDDEN_403');
  });

  it('should map bot_detection to BLOCK_CAPTCHA_SUSPECTED as fallback', () => {
    expect(blockTypeToErrorCode('bot_detection')).toBe('BLOCK_CAPTCHA_SUSPECTED');
  });

  it('should map geo_block to BLOCK_FORBIDDEN_403', () => {
    expect(blockTypeToErrorCode('geo_block')).toBe('BLOCK_FORBIDDEN_403');
  });
});
