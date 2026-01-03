/**
 * Fetch Classifier Regression Tests
 *
 * These tests use fixture HTML files to ensure the classifier
 * correctly identifies blocked pages vs legitimate content.
 *
 * ARCHITECTURE:
 * - Tier 1: Precise signatures (always fire, any page size)
 * - Tier 2: Heuristics (size-gated, can be bypassed for large product pages)
 *
 * Test categories:
 * 1. SHOULD BLOCK - Pages that must be detected as blocked
 * 2. SHOULD NOT BLOCK - Legitimate pages that must pass
 * 3. EDGE CASES - Tricky scenarios that previously caused issues
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  classifyBlock,
  classifyEmpty,
  hasSchemaOrgProduct,
  determineFetchOutcome,
  HEURISTIC_SIZE_THRESHOLD,
} from '../fetch-classifiers';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

describe('fetch-classifiers', () => {
  describe('hasSchemaOrgProduct', () => {
    it('detects schema.org Product JSON-LD', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Test"}
        </script>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('detects Product in array syntax', () => {
      const html = `{"@type": ["Product", "SomeOther"]}`;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('returns false for non-product pages', () => {
      const html = `
        <html><body>
          <script type="application/ld+json">
          {"@type": "Organization", "name": "Test"}
          </script>
        </body></html>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(false);
    });

    it('returns false for pages without @type', () => {
      expect(hasSchemaOrgProduct('<html><body>Hello</body></html>')).toBe(false);
    });
  });

  describe('classifyBlock - Tier 1: Precise Signatures', () => {
    describe('DataDome CAPTCHA', () => {
      it('detects DataDome CAPTCHA page via fixture', () => {
        const html = loadFixture('datadome-captcha.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('datadome');
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
        expect(result.signals).toContain('datadome_url_signature');
      });

      it('detects geo.captcha-delivery.com URL', () => {
        const html = '<iframe src="https://geo.captcha-delivery.com/captcha"></iframe>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('datadome');
      });

      it('detects captcha-delivery.com/captcha URL', () => {
        const html = 'Loading from https://captcha-delivery.com/captcha/123';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('datadome');
      });

      it('detects DataDome Slovak challenge text', () => {
        const html = '<p>Posunutím doprava zložte puzzle</p>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('datadome');
        expect(result.signals).toContain('datadome_challenge_text');
      });

      it('detects "press & hold" challenge', () => {
        const html = '<div class="challenge">Press & Hold to verify</div>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('datadome');
      });
    });

    describe('Cloudflare Challenge', () => {
      it('detects Cloudflare challenge page via fixture', () => {
        const html = loadFixture('cloudflare-challenge.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('cloudflare');
        expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      });

      it('detects cf-browser-verification attribute (precise signature)', () => {
        const html = '<body class="cf-browser-verification">Loading...</body>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('cloudflare');
        expect(result.confidence).toBe(0.99);
        expect(result.signals).toContain('cloudflare_verification_signature');
      });
    });

    describe('PerimeterX CAPTCHA', () => {
      it('detects PerimeterX CAPTCHA page via fixture', () => {
        const html = loadFixture('perimeterx-captcha.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('perimeterx');
        expect(result.confidence).toBe(0.99);
        expect(result.signals).toContain('perimeterx_captcha_signature');
      });

      it('detects px-captcha element', () => {
        const html = '<div id="px-captcha"></div>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('perimeterx');
      });
    });

    describe('hCaptcha Challenge', () => {
      it('detects hcaptcha-challenge frame', () => {
        const html = '<iframe class="hcaptcha-challenge" src="..."></iframe>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.signals).toContain('hcaptcha_challenge_signature');
      });

      it('detects h-captcha-response field', () => {
        const html = '<textarea name="h-captcha-response"></textarea>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
      });
    });
  });

  describe('classifyBlock - Tier 2: Heuristics (size-gated)', () => {
    describe('Rate Limiting', () => {
      it('detects rate limit page via fixture', () => {
        const html = loadFixture('rate-limit.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('rate_limit');
        expect(result.signals).toContain('rate_limit_detected');
      });

      it('detects "too many requests" message', () => {
        const html = '<h1>Too Many Requests</h1><p>Please slow down.</p>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('rate_limit');
      });
    });

    describe('Generic Block Detection', () => {
      it('detects generic block page via fixture', () => {
        const html = loadFixture('generic-block-small.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('unknown');
        expect(result.signals).toContain('generic_block_heuristic');
      });

      it('detects "access denied" on small pages', () => {
        const html = '<h1>Access Denied</h1>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('unknown');
      });

      it('does NOT detect "access denied" on large pages', () => {
        const padding = 'x'.repeat(HEURISTIC_SIZE_THRESHOLD + 1000);
        const html = `<html>${padding}<h1>Access Denied</h1></html>`;
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(false);
      });
    });
  });

  describe('classifyBlock - False Positive Prevention', () => {
    it('does NOT block Etsy product page with recaptcha widget', () => {
      // Fixture is small, so we need to pad it to be >50KB to trigger large page logic
      const fixture = loadFixture('etsy-product-with-recaptcha.html');
      const html = fixture + 'x'.repeat(HEURISTIC_SIZE_THRESHOLD);
      const result = classifyBlock(html);

      expect(result.isBlocked).toBe(false);
      expect(result.signals).toContain('heuristics_skipped_product_page');
    });

    it('does NOT block pages with DataDome SDK scripts', () => {
      // This is a normal product page that uses DataDome for protection
      // The SDK script presence does NOT mean the page is blocked
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">{"@type": "Product", "name": "Test"}</script>
          <script>
            window.DD_BLOCKED_EVENT_NAME = 'datadome:blocked';
            window.ddCaptchaSettings = { CaptchaPassed: false };
          </script>
        </head>
        <body>
          <h1>Product Name</h1>
          <button>Add to Cart</button>
        </body>
        </html>
      ` + 'x'.repeat(50000); // Make it large

      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });

    it('does NOT block pages with g-recaptcha widget', () => {
      // Contact form with reCAPTCHA should not trigger block detection
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">{"@type": "Product", "name": "Test"}</script>
        </head>
        <body>
          <form id="contact-form">
            <div class="g-recaptcha" data-sitekey="xyz"></div>
            <button>Submit</button>
          </form>
        </body>
        </html>
      ` + 'x'.repeat(50000);

      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });

    it('blocks CAPTCHA page even if it has "recaptcha" text', () => {
      // This is an actual CAPTCHA challenge page (small, no product schema)
      const html = `
        <html>
        <body>
          <h1>Verify you are human</h1>
          <p>Please complete this reCAPTCHA to continue.</p>
          <div class="g-recaptcha"></div>
        </body>
        </html>
      `;
      const result = classifyBlock(html);

      // Small page without product schema + CAPTCHA indicators = blocked
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('captcha');
    });
  });

  describe('classifyEmpty', () => {
    it('detects body too small', () => {
      const result = classifyEmpty('Hello', 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('body_too_small');
    });

    it('detects JSON error in HTML response (large enough body)', () => {
      // JSON error detection only fires if body is >= MIN_BODY_BYTES
      // so we need to pad the JSON to be large enough
      const json = `{"error": "not found", "padding": "${'x'.repeat(3000)}"}`;
      const result = classifyEmpty(json, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('json_error_in_html');
    });

    it('detects missing HTML markers', () => {
      const html = 'x'.repeat(3000); // Long enough but no HTML
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('missing_html_markers');
    });

    it('detects loading placeholder (small page with Loading...)', () => {
      // Loading placeholder detection requires page < 5000 bytes
      const html = '<html><body>Loading...' + 'x'.repeat(2500) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('loading_placeholder');
    });

    it('accepts valid HTML page', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <body>${'x'.repeat(3000)}</body>
        </html>
      `;
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(false);
    });
  });

  describe('determineFetchOutcome', () => {
    it('returns ok for successful response', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <body>
          <script type="application/ld+json">{"@type": "Product"}</script>
          ${'x'.repeat(100000)}
        </body>
        </html>
      `;
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('ok');
    });

    it('returns blocked for DataDome page', () => {
      const html = loadFixture('datadome-captcha.html');
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('blocked');
      expect(result.blockKind).toBe('datadome');
    });

    it('returns captcha_required for generic CAPTCHA', () => {
      const html = '<h1>Verify you are human</h1>';
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('captcha_required');
      expect(result.blockKind).toBe('captcha');
    });

    it('returns timeout for timeout error', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'ETIMEDOUT');
      expect(result.outcome).toBe('timeout');
    });

    it('returns network_error for connection refused', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'ECONNREFUSED');
      expect(result.outcome).toBe('network_error');
    });

    it('returns blocked for 403 status', () => {
      const result = determineFetchOutcome(403, '<h1>Forbidden</h1>', 'text/html');
      expect(result.outcome).toBe('blocked');
    });

    it('returns empty for small response', () => {
      const result = determineFetchOutcome(200, 'Hi', 'text/html');
      expect(result.outcome).toBe('empty');
    });
  });
});
