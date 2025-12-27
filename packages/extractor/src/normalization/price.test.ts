import { normalizePrice } from './price';
import { PriceNormalization } from '@sentinel/shared';

describe('normalizePrice', () => {
  describe('Slovak format (sk-SK)', () => {
    const skConfig: PriceNormalization = {
      kind: 'price',
      locale: 'sk-SK',
      currency: 'EUR'
    };

    it('should normalize "1 299,00 €"', () => {
      const result = normalizePrice('1 299,00 €', skConfig);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should normalize "1\\u00A0299,99\\u00A0€" (NBSP)', () => {
      const result = normalizePrice('1\u00A0299,99\u00A0€', skConfig);
      expect(result).toEqual({ value: 1299.99, currency: 'EUR' });
    });

    it('should normalize integer "1299"', () => {
      const result = normalizePrice('1299', skConfig);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should normalize decimal "0,99 €"', () => {
      const result = normalizePrice('0,99 €', skConfig);
      expect(result).toEqual({ value: 0.99, currency: 'EUR' });
    });

    it('should normalize "99,90 EUR"', () => {
      const result = normalizePrice('99,90 EUR', skConfig);
      expect(result).toEqual({ value: 99.90, currency: 'EUR' });
    });

    it('should normalize "10 000,50 €"', () => {
      const result = normalizePrice('10 000,50 €', skConfig);
      expect(result).toEqual({ value: 10000.50, currency: 'EUR' });
    });
  });

  describe('US format (en-US)', () => {
    const usConfig: PriceNormalization = {
      kind: 'price',
      locale: 'en-US',
      currency: 'EUR'
    };

    const usdConfig: PriceNormalization = {
      kind: 'price',
      locale: 'en-US',
      currency: 'USD'
    };

    it('should normalize "€1,299.00"', () => {
      const result = normalizePrice('€1,299.00', usConfig);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should normalize "$1,299.99"', () => {
      const result = normalizePrice('$1,299.99', usdConfig);
      expect(result).toEqual({ value: 1299.99, currency: 'USD' });
    });

    it('should normalize "1,299.00 USD"', () => {
      const result = normalizePrice('1,299.00 USD', usdConfig);
      expect(result).toEqual({ value: 1299.00, currency: 'USD' });
    });

    it('should normalize "10,000.50"', () => {
      const result = normalizePrice('10,000.50', usConfig);
      expect(result).toEqual({ value: 10000.50, currency: 'EUR' });
    });
  });

  describe('German format (de-DE)', () => {
    const deConfig: PriceNormalization = {
      kind: 'price',
      locale: 'de-DE',
      currency: 'EUR'
    };

    it('should normalize "1.299,00 EUR"', () => {
      const result = normalizePrice('1.299,00 EUR', deConfig);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should normalize "1.299,99 €"', () => {
      const result = normalizePrice('1.299,99 €', deConfig);
      expect(result).toEqual({ value: 1299.99, currency: 'EUR' });
    });

    it('should normalize "10.000,50 EUR"', () => {
      const result = normalizePrice('10.000,50 EUR', deConfig);
      expect(result).toEqual({ value: 10000.50, currency: 'EUR' });
    });
  });

  describe('Edge cases', () => {
    const skConfig: PriceNormalization = {
      kind: 'price',
      locale: 'sk-SK',
      currency: 'EUR'
    };

    it('should return null for "invalid"', () => {
      const result = normalizePrice('invalid', skConfig);
      expect(result).toBeNull();
    });

    it('should return null for empty string', () => {
      const result = normalizePrice('', skConfig);
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = normalizePrice(null as any, skConfig);
      expect(result).toBeNull();
    });

    it('should return null for undefined input', () => {
      const result = normalizePrice(undefined as any, skConfig);
      expect(result).toBeNull();
    });

    it('should return null for "abc 123"', () => {
      const result = normalizePrice('abc 123', skConfig);
      expect(result).toBeNull();
    });

    it('should normalize "0,00 €" to zero', () => {
      const result = normalizePrice('0,00 €', skConfig);
      expect(result).toEqual({ value: 0.00, currency: 'EUR' });
    });

    it('should normalize very large number "999 999,99 €"', () => {
      const result = normalizePrice('999 999,99 €', skConfig);
      expect(result).toEqual({ value: 999999.99, currency: 'EUR' });
    });
  });

  describe('Custom configuration', () => {
    it('should respect custom stripTokens', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'sk-SK',
        currency: 'EUR',
        stripTokens: ['Kč', 'CZK']
      };

      const result = normalizePrice('1 299,00 Kč', config);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should respect custom scale (0 decimal places)', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'sk-SK',
        currency: 'EUR',
        scale: 0
      };

      const result = normalizePrice('1 299,99 €', config);
      expect(result).toEqual({ value: 1300, currency: 'EUR' });
    });

    it('should respect custom scale (3 decimal places)', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'sk-SK',
        currency: 'EUR',
        scale: 3
      };

      const result = normalizePrice('1 299,995 €', config);
      expect(result).toEqual({ value: 1299.995, currency: 'EUR' });
    });

    it('should respect explicit decimalSeparator and thousandSeparators', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'custom',
        currency: 'EUR',
        decimalSeparator: '.',
        thousandSeparators: ["'"]
      };

      const result = normalizePrice("1'299.00 €", config);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });
  });

  describe('Mixed formats', () => {
    it('should handle price with multiple spaces', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'sk-SK',
        currency: 'EUR'
      };

      const result = normalizePrice('  1 299,00   €  ', config);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should handle price without currency symbol', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'sk-SK',
        currency: 'EUR'
      };

      const result = normalizePrice('1 299,00', config);
      expect(result).toEqual({ value: 1299.00, currency: 'EUR' });
    });

    it('should handle price with only decimal part "0.99"', () => {
      const config: PriceNormalization = {
        kind: 'price',
        locale: 'en-US',
        currency: 'USD'
      };

      const result = normalizePrice('0.99', config);
      expect(result).toEqual({ value: 0.99, currency: 'USD' });
    });
  });
});
