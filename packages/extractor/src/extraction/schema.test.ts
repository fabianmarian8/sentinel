/**
 * Schema.org JSON-LD Extraction Tests
 *
 * Tests entity-based extraction, fingerprinting, and fallback behavior.
 */

import { extractWithSchema, detectSchemaDrift } from './schema';

describe('extractWithSchema', () => {
  describe('JSON-LD extraction', () => {
    it('should extract price from simple Product schema', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org/",
              "@type": "Product",
              "name": "Test Product",
              "offers": {
                "@type": "Offer",
                "price": "99.99",
                "priceCurrency": "USD",
                "availability": "https://schema.org/InStock"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('99.99');
      expect(result.meta?.source).toBe('jsonld');
      expect(result.meta?.currency).toBe('USD');
    });

    it('should extract lowPrice from AggregateOffer when prefer=low', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Etsy Product",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "26.74",
                "highPrice": "29.87",
                "priceCurrency": "EUR"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price', prefer: 'low' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('26.74');
      expect(result.meta?.currency).toBe('EUR');
      expect(result.meta?.valueLow).toBe(26.74);
      expect(result.meta?.valueHigh).toBe(29.87);
    });

    it('should extract highPrice from AggregateOffer when prefer=high', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "10.00",
                "highPrice": "50.00",
                "priceCurrency": "GBP"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price', prefer: 'high' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('50');
    });

    it('should handle @graph wrapper structure', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org/",
              "@graph": [
                {
                  "@type": "Organization",
                  "name": "Shop Name"
                },
                {
                  "@type": "Product",
                  "name": "Product in Graph",
                  "offers": {
                    "@type": "Offer",
                    "price": "123.45",
                    "priceCurrency": "EUR"
                  }
                }
              ]
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('123.45');
    });

    it('should extract availability from schema.org URL', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Available Product",
              "offers": {
                "@type": "Offer",
                "price": "50.00",
                "availability": "https://schema.org/InStock"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'availability' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('in_stock');
      expect(result.meta?.availabilityUrl).toBe('https://schema.org/InStock');
    });

    it('should map OutOfStock correctly', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "offers": {
                "@type": "Offer",
                "availability": "https://schema.org/OutOfStock"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'availability' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('out_of_stock');
    });

    it('should score and select best Product candidate', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "aggregateRating": { "ratingValue": "4.5" }
            }
          </script>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Better Product",
              "sku": "ABC123",
              "image": "image.jpg",
              "brand": { "@type": "Brand", "name": "Acme" },
              "offers": {
                "@type": "Offer",
                "price": "75.00",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('75');
      // Better candidate was selected (has offers, sku, image, brand)
    });

    it('should generate schema fingerprint', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Test",
              "offers": {
                "@type": "Offer",
                "price": "10.00",
                "priceCurrency": "USD"
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.meta?.fingerprint).toBeDefined();
      expect(result.meta?.fingerprint?.schemaTypes).toContain('Product');
      expect(result.meta?.fingerprint?.shapeHash).toHaveLength(16);
      expect(result.meta?.fingerprint?.jsonLdBlockCount).toBe(1);
      expect(result.meta?.fingerprint?.hasOffers).toBe(true);
    });
  });

  describe('Meta tag fallback', () => {
    it('should fall back to meta tags when no JSON-LD', () => {
      const html = `
        <html>
        <head>
          <meta property="product:price:amount" content="41.58" />
          <meta property="product:price:currency" content="GBP" />
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('41.58');
      expect(result.meta?.source).toBe('meta');
      expect(result.meta?.currency).toBe('GBP');
    });

    it('should handle og:price:amount fallback', () => {
      const html = `
        <html>
        <head>
          <meta property="og:price:amount" content="99.00" />
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('99.00');
      expect(result.meta?.source).toBe('meta');
    });

    it('should respect source=jsonld (no meta fallback)', () => {
      const html = `
        <html>
        <head>
          <meta property="product:price:amount" content="41.58" />
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price', source: 'jsonld' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON-LD');
    });

    it('should extract availability from meta tags', () => {
      const html = `
        <html>
        <head>
          <meta property="product:availability" content="https://schema.org/InStock" />
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'availability' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('in_stock');
      expect(result.meta?.source).toBe('meta');
    });
  });

  describe('Error handling', () => {
    it('should fail on empty HTML', () => {
      const result = extractWithSchema('', { kind: 'price' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Empty HTML input');
    });

    it('should fail when no Product entity found', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Organization",
              "name": "Not a Product"
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      // Use source=jsonld to prevent fallback to meta
      const result = extractWithSchema(html, { kind: 'price', source: 'jsonld' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No Product');
    });

    it('should fail when Product has no offers', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "name": "Product without offers"
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      // Use source=jsonld to prevent fallback to meta
      const result = extractWithSchema(html, { kind: 'price', source: 'jsonld' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no offers');
    });

    it('should handle malformed JSON-LD gracefully', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            { invalid json here }
          </script>
          <meta property="product:price:amount" content="25.00" />
        </head>
        <body></body>
        </html>
      `;

      // Should fall back to meta
      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('25.00');
      expect(result.meta?.source).toBe('meta');
    });
  });

  describe('Currency handling', () => {
    it('should detect currency conflict in multiple offers', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "offers": [
                { "@type": "Offer", "price": "10.00", "priceCurrency": "USD" },
                { "@type": "Offer", "price": "8.50", "priceCurrency": "EUR" }
              ]
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.meta?.currencyConflict).toBe(true);
    });
  });

  describe('Offers array handling', () => {
    it('should prefer AggregateOffer over individual offers', () => {
      const html = `
        <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "Product",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": "10.00",
                "highPrice": "50.00",
                "priceCurrency": "USD",
                "offerCount": 5
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price', prefer: 'low' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBe('10');
      expect(result.meta?.valueLow).toBe(10);
      expect(result.meta?.valueHigh).toBe(50);
    });
  });
});

describe('detectSchemaDrift', () => {
  it('should detect shape hash change', () => {
    const oldFingerprint = {
      schemaTypes: ['Product'],
      shapeHash: 'abc123',
      jsonLdBlockCount: 1,
      hasOffers: true,
      hasMeta: false,
      timestamp: '2024-01-01',
    };

    const newFingerprint = {
      schemaTypes: ['Product'],
      shapeHash: 'xyz789', // Changed
      jsonLdBlockCount: 1,
      hasOffers: true,
      hasMeta: false,
      timestamp: '2024-01-02',
    };

    const result = detectSchemaDrift(oldFingerprint, newFingerprint);

    expect(result.drifted).toBe(true);
    expect(result.reason).toContain('shape');
  });

  it('should detect schema type change', () => {
    const oldFingerprint = {
      schemaTypes: ['Product'],
      shapeHash: 'abc123',
      jsonLdBlockCount: 1,
      hasOffers: true,
      hasMeta: false,
      timestamp: '2024-01-01',
    };

    const newFingerprint = {
      schemaTypes: ['Product', 'IndividualProduct'], // Added type
      shapeHash: 'abc123',
      jsonLdBlockCount: 1,
      hasOffers: true,
      hasMeta: false,
      timestamp: '2024-01-02',
    };

    const result = detectSchemaDrift(oldFingerprint, newFingerprint);

    expect(result.drifted).toBe(true);
    expect(result.reason).toContain('types');
  });

  it('should not detect drift when fingerprints match', () => {
    const fingerprint = {
      schemaTypes: ['Product'],
      shapeHash: 'abc123',
      jsonLdBlockCount: 1,
      hasOffers: true,
      hasMeta: false,
      timestamp: '2024-01-01',
    };

    const result = detectSchemaDrift(fingerprint, { ...fingerprint, timestamp: '2024-01-02' });

    expect(result.drifted).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('should handle null fingerprints', () => {
    const result = detectSchemaDrift(null, null);

    expect(result.drifted).toBe(false);
  });
});
