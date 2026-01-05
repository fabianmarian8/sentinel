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
      const html = `
        <script type="application/ld+json">
        {"@type": ["Product", "SomeOther"]}
        </script>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('detects Product in @graph structure', () => {
      const html = `
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {"@type": "WebPage", "name": "Page"},
            {"@type": "Product", "name": "Widget", "sku": "123"}
          ]
        }
        </script>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('detects Product across multiple script blocks', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "Organization", "name": "Acme"}
        </script>
        <script type="application/ld+json">
        {"@type": "Product", "name": "Widget"}
        </script>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('detects commerce via offers field (without explicit Product type)', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "WebPage", "offers": {"@type": "Offer", "price": "29.99"}}
        </script>
      `;
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('falls back to regex for broken JSON-LD (trailing comma)', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Widget",}
        </script>
      `;
      // JSON.parse will fail, but regex fallback should catch it
      expect(hasSchemaOrgProduct(html)).toBe(true);
    });

    it('detects ItemList (product listings)', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "ItemList", "itemListElement": []}
        </script>
      `;
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

  describe('GUARDRAIL: Tier 1 signatures ALWAYS win regardless of page size', () => {
    it('blocks large DataDome interstitial (200KB) despite size', () => {
      // Large page with DataDome CAPTCHA signature - Tier 1 MUST fire
      const padding = 'x'.repeat(200000);
      const html = `
        <!DOCTYPE html>
        <html>
        <head><title>Security Check</title></head>
        <body>
          ${padding}
          <iframe src="https://geo.captcha-delivery.com/captcha/?id=123"></iframe>
          <p>Please complete the security check</p>
        </body>
        </html>
      `;
      const result = classifyBlock(html);

      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('datadome');
      expect(result.signals).toContain('datadome_url_signature');
    });

    it('blocks large Cloudflare challenge page despite size', () => {
      const padding = 'x'.repeat(100000);
      const html = `
        <!DOCTYPE html>
        <html>
        <body class="cf-browser-verification">
          ${padding}
          <h1>Checking your browser...</h1>
        </body>
        </html>
      `;
      const result = classifyBlock(html);

      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('cloudflare');
      expect(result.signals).toContain('cloudflare_verification_signature');
    });

    it('blocks PerimeterX even on large page', () => {
      const padding = 'x'.repeat(150000);
      const html = `
        <html>
        <body>
          ${padding}
          <div id="px-captcha">Verify</div>
        </body>
        </html>
      `;
      const result = classifyBlock(html);

      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('perimeterx');
    });
  });

  describe('GUARDRAIL: Broken JSON-LD does not cause false negatives', () => {
    it('detects product via regex when JSON-LD has HTML entities', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "Product", "name": "Widget &amp; Gadget"}
        </script>
      ` + 'x'.repeat(60000);

      // The &amp; makes it invalid JSON, but regex should still detect Product
      expect(hasSchemaOrgProduct(html)).toBe(true);

      // And therefore should skip heuristics on this large page
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });

    it('detects product via regex when JSON-LD has unescaped quotes', () => {
      const html = `
        <script type="application/ld+json">
        {"@type": "Product", "description": "The "best" widget"}
        </script>
      ` + 'x'.repeat(60000);

      expect(hasSchemaOrgProduct(html)).toBe(true);
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

    describe('Amazon CAPTCHA Soft-wall', () => {
      it('detects Amazon CAPTCHA page via fixture', () => {
        const html = loadFixture('amazon-captcha-softwall.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.confidence).toBe(0.99);
        expect(result.signals).toContain('amazon_captcha_signature');
      });

      it('detects validateCaptcha form action', () => {
        const html = '<form action="/errors/validateCaptcha"><button>Continue</button></form>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.signals).toContain('amazon_captcha_signature');
      });

      it('detects opfcaptcha.amazon.com script', () => {
        const html = '<script src="https://opfcaptcha.amazon.com/script.js"></script>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
      });
    });

    describe('Temu/Kwai JS Challenge', () => {
      it('detects Temu challenge page via fixture', () => {
        const html = loadFixture('temu-challenge.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.confidence).toBe(0.95);
        expect(result.signals).toContain('temu_challenge_signature');
      });

      it('detects kwcdn.com challenge script URL', () => {
        const html = '<script src="https://static.kwcdn.com/upload-static/assets/chl/js/abc.js"></script>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.signals).toContain('temu_challenge_signature');
      });

      it('detects Temu challenge token', () => {
        const html = '<script>var token = "tcf4d6d81375da79971fbf9d1e81b99bb9";</script>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
      });
    });

    describe('Target Store/ZIP Chooser Interstitial', () => {
      it('detects Target store chooser page via fixture', () => {
        const html = loadFixture('target-store-chooser.html');
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.confidence).toBe(0.9);
        expect(result.signals).toContain('target_store_chooser_interstitial');
      });

      it('detects "choose your store" text on target.com', () => {
        const html = '<html><body>target.com - Choose your store for delivery options</body></html>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.kind).toBe('captcha');
        expect(result.signals).toContain('target_store_chooser_interstitial');
      });

      it('detects "enter your zip" on target.com', () => {
        const html = '<html><body><p>target.com</p><label>Enter your zip code:</label></body></html>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.signals).toContain('target_store_chooser_interstitial');
      });

      it('detects storelocator + fulfillment on target.com', () => {
        const html = '<html><body><script>target.com storelocator fulfillment</script></body></html>';
        const result = classifyBlock(html);

        expect(result.isBlocked).toBe(true);
        expect(result.signals).toContain('target_store_chooser_interstitial');
      });

      it('does NOT block non-Target pages with "choose your store"', () => {
        // Without target.com domain, should not trigger
        const html = '<html><body><h1>Choose your store</h1><p>Walmart stores</p></body></html>';
        const result = classifyBlock(html);

        expect(result.signals).not.toContain('target_store_chooser_interstitial');
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

    // STILL_BLOCKED handling tests (Temu/BrightData issue)
    describe('STILL_BLOCKED error handling', () => {
      it('returns captcha_required for BRIGHTDATA_STILL_BLOCKED with DataDome content', () => {
        const challengeHtml = loadFixture('temu-challenge.html');
        const result = determineFetchOutcome(
          200,
          challengeHtml,
          'text/html',
          'BRIGHTDATA_STILL_BLOCKED: datadome challenge text',
        );
        expect(result.outcome).toBe('captcha_required');
        expect(result.signals).toContain('still_blocked');
      });

      it('returns blocked for STILL_BLOCKED without specific captcha signal', () => {
        const result = determineFetchOutcome(
          200,
          '<html><body>Some blocked content</body></html>',
          'text/html',
          'BRIGHTDATA_STILL_BLOCKED: unknown block',
        );
        expect(result.outcome).toBe('blocked');
        expect(result.signals).toContain('still_blocked');
      });

      it('returns captcha_required for challenge in error detail', () => {
        const result = determineFetchOutcome(
          200,
          undefined,
          undefined,
          'BRIGHTDATA_STILL_BLOCKED: challenge detected',
        );
        expect(result.outcome).toBe('captcha_required');
        expect(result.signals).toContain('still_blocked');
      });

      it('returns rate_limited for rate limit error (before STILL_BLOCKED)', () => {
        const result = determineFetchOutcome(
          429,
          undefined,
          undefined,
          'BRIGHTDATA_RATE_LIMITED: Account limit exceeded',
        );
        expect(result.outcome).toBe('rate_limited');
      });
    });
  });
});
