/**
 * Unit tests for missingPrice support in schema extraction
 */

import { extractWithSchema } from '../schema';

describe('Schema Extraction - missingPrice support', () => {
  describe('JSON-LD path', () => {
    it('should return missingPrice=true when product has availability but no price (OutOfStock)', () => {
      // Amazon-style JSON-LD with OutOfStock availability but no price
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Test Product",
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

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBeNull();
      expect(result.meta?.missingPrice).toBe(true);
      expect(result.meta?.availabilityStatus).toBe('out_of_stock');
    });

    it('should return missingPrice=true when product has Discontinued availability', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Discontinued Product",
            "offers": {
              "@type": "Offer",
              "availability": "https://schema.org/Discontinued"
            }
          }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBeNull();
      expect(result.meta?.missingPrice).toBe(true);
      expect(result.meta?.availabilityStatus).toBe('out_of_stock');
    });

    it('should return missingPrice=true for AggregateOffer with availability but no lowPrice/highPrice', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Aggregate Product",
            "offers": {
              "@type": "AggregateOffer",
              "availability": "http://schema.org/OutOfStock",
              "offerCount": 0
            }
          }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBeNull();
      expect(result.meta?.missingPrice).toBe(true);
      expect(result.meta?.availabilityStatus).toBe('out_of_stock');
    });

    it('should NOT return missingPrice when product has price (normal case)', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Available Product",
            "offers": {
              "@type": "Offer",
              "price": 29.99,
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
      expect(result.rawValue).toBe('29.99');
      expect(result.meta?.missingPrice).toBeUndefined();
      expect(result.meta?.valueLow).toBe(29.99);
    });

    it('should fail when no availability info exists (no missingPrice, real extraction failure)', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Product Without Offers"
          }
          </script>
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(false);
      expect(result.meta?.missingPrice).toBeUndefined();
    });
  });

  describe('Meta fallback path', () => {
    it('should return missingPrice=true when meta has availability but no price', () => {
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta property="og:title" content="Test Product">
          <meta property="product:availability" content="out of stock">
        </head>
        <body></body>
        </html>
      `;

      const result = extractWithSchema(html, { kind: 'price' });

      expect(result.success).toBe(true);
      expect(result.rawValue).toBeNull();
      expect(result.meta?.missingPrice).toBe(true);
      expect(result.meta?.source).toBe('meta');
    });
  });
});
