/**
 * Fetch Classifier Unit Tests
 *
 * Updated 2026-01-03 for two-tier architecture:
 * - Tier 1: Precise signatures (always fire, any page size)
 * - Tier 2: Heuristics (size-gated, low-precision)
 */

import { classifyEmpty, classifyBlock, determineFetchOutcome } from './fetch-classifiers';

describe('fetch-classifiers', () => {
  describe('classifyEmpty', () => {
    it('should detect body too small', () => {
      const result = classifyEmpty('<html></html>', 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('body_too_small');
    });

    it('should pass valid HTML', () => {
      const html = '<html><head></head><body>' + 'x'.repeat(3000) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(false);
    });

    it('should detect missing HTML markers', () => {
      const text = 'x'.repeat(3000);
      const result = classifyEmpty(text, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('missing_html_markers');
    });

    it('should detect loading placeholder', () => {
      const html = '<html><body>Loading...' + 'x'.repeat(3000) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('loading_placeholder');
    });

    it('should detect JSON error in HTML', () => {
      const json = '{"error": "Not Found", "message": "Resource does not exist", "data": "' + 'x'.repeat(3000) + '"}';
      const result = classifyEmpty(json, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('json_error_in_html');
    });
  });

  describe('classifyBlock - Tier 1: Precise Signatures', () => {
    it('should detect DataDome via URL signature', () => {
      const html = '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('datadome');
      expect(result.signals).toContain('datadome_url_signature');
    });

    it('should detect Cloudflare via cf-browser-verification', () => {
      const html = '<body class="cf-browser-verification">Checking your browser...</body>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('cloudflare');
      expect(result.signals).toContain('cloudflare_verification_signature');
    });

    it('should detect PerimeterX via px-captcha signature', () => {
      const html = '<html><body><div id="px-captcha">Verify you are human</div></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('perimeterx');
      expect(result.signals).toContain('perimeterx_captcha_signature');
    });
  });

  describe('classifyBlock - Tier 2: Heuristics (small pages only)', () => {
    it('should detect Cloudflare heuristic on small page', () => {
      const html = '<html><body>Checking your browser before accessing... Ray ID: abc123</body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('cloudflare');
      expect(result.signals).toContain('cloudflare_heuristic');
    });

    it('should detect PerimeterX heuristic on small page', () => {
      const html = '<html><body><div id="_pxhd">PerimeterX protection active</div></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('perimeterx');
      expect(result.signals).toContain('perimeterx_heuristic');
    });

    it('should detect CAPTCHA heuristic on small page', () => {
      // Small page with explicit challenge text (not just 'recaptcha' keyword)
      const html = '<html><body>Verify you are human to continue</body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('captcha');
      expect(result.signals).toContain('captcha_heuristic');
    });

    it('should detect rate limit', () => {
      const html = '<html><body><h1>Too many requests - Rate limit exceeded</h1></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('rate_limit');
      expect(result.signals).toContain('rate_limit_detected');
    });

    it('should detect generic block on small page', () => {
      const html = '<html><body><h1>Access Denied</h1></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('unknown');
      expect(result.signals).toContain('generic_block_heuristic');
    });

    it('should NOT detect block heuristics on large page', () => {
      // Large page with "blocked" keyword in JS - should NOT trigger
      const html = '<html><body>' + 'x'.repeat(60000) + 'DD_BLOCKED_EVENT_NAME</body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });

    it('should pass clean HTML', () => {
      const html = '<html><body><h1>Product Page</h1><span class="price">$99.99</span></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('classifyBlock - False Positive Prevention', () => {
    it('should NOT block large product page with recaptcha widget', () => {
      const html = `
        <html>
        <head><script type="application/ld+json">{"@type": "Product"}</script></head>
        <body>
          <div class="g-recaptcha">Contact form captcha</div>
          ${'x'.repeat(60000)}
        </body>
        </html>
      `;
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
      expect(result.signals).toContain('heuristics_skipped_product_page');
    });
  });

  describe('determineFetchOutcome', () => {
    it('should return ok for valid response', () => {
      const html = '<html><body>' + 'x'.repeat(5000) + '</body></html>';
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('ok');
    });

    it('should return empty for too small response', () => {
      const result = determineFetchOutcome(200, '<html></html>', 'text/html');
      expect(result.outcome).toBe('empty');
    });

    it('should return blocked for DataDome URL signature', () => {
      // Use precise DataDome URL signature (not just 'datadome' keyword)
      const html = '<html><iframe src="https://geo.captcha-delivery.com/captcha"></iframe></html>' + 'x'.repeat(3000);
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('blocked');
      expect(result.blockKind).toBe('datadome');
    });

    it('should return captcha_required for explicit CAPTCHA challenge', () => {
      // Use explicit challenge text (not just 'recaptcha' keyword)
      const html = '<html><body>Verify you are human to continue</body></html>';
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('captcha_required');
      expect(result.blockKind).toBe('captcha');
    });

    it('should return timeout for timeout error', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Request timeout ETIMEDOUT');
      expect(result.outcome).toBe('timeout');
    });

    it('should return network_error for connection errors', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Connection refused ECONNREFUSED');
      expect(result.outcome).toBe('network_error');
      expect(result.signals).toContain('network_error');
    });
  });
});
