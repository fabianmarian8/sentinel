/**
 * Value comparison utility tests
 */

import { equals } from './equals';

describe('equals', () => {
  describe('null and undefined handling', () => {
    it('should return true for two nulls', () => {
      expect(equals(null, null)).toBe(true);
    });

    it('should return true for two undefined', () => {
      expect(equals(undefined, undefined)).toBe(true);
    });

    it('should return false for null vs undefined', () => {
      expect(equals(null, undefined)).toBe(false);
    });

    it('should return false for null vs value', () => {
      expect(equals(null, 100)).toBe(false);
      expect(equals(100, null)).toBe(false);
    });

    it('should return false for undefined vs value', () => {
      expect(equals(undefined, 'test')).toBe(false);
      expect(equals('test', undefined)).toBe(false);
    });
  });

  describe('price objects', () => {
    it('should compare prices by value and currency', () => {
      const price1 = { value: 99.99, currency: 'USD' };
      const price2 = { value: 99.99, currency: 'USD' };

      expect(equals(price1, price2)).toBe(true);
    });

    it('should detect different price values', () => {
      const price1 = { value: 99.99, currency: 'USD' };
      const price2 = { value: 89.99, currency: 'USD' };

      expect(equals(price1, price2)).toBe(false);
    });

    it('should detect different currencies', () => {
      const price1 = { value: 99.99, currency: 'USD' };
      const price2 = { value: 99.99, currency: 'EUR' };

      expect(equals(price1, price2)).toBe(false);
    });

    it('should handle price objects with extra properties', () => {
      const price1 = { value: 99.99, currency: 'USD', other: 'data' };
      const price2 = { value: 99.99, currency: 'USD', other: 'different' };

      // Should match because value and currency match
      expect(equals(price1, price2)).toBe(true);
    });
  });

  describe('availability objects', () => {
    it('should compare availability by status and leadTimeDays', () => {
      const avail1 = { status: 'in_stock', leadTimeDays: 0 };
      const avail2 = { status: 'in_stock', leadTimeDays: 0 };

      expect(equals(avail1, avail2)).toBe(true);
    });

    it('should detect different status', () => {
      const avail1 = { status: 'in_stock', leadTimeDays: 0 };
      const avail2 = { status: 'out_of_stock', leadTimeDays: 0 };

      expect(equals(avail1, avail2)).toBe(false);
    });

    it('should detect different lead times', () => {
      const avail1 = { status: 'backorder', leadTimeDays: 7 };
      const avail2 = { status: 'backorder', leadTimeDays: 14 };

      expect(equals(avail1, avail2)).toBe(false);
    });

    it('should handle null lead times', () => {
      const avail1 = { status: 'out_of_stock', leadTimeDays: null };
      const avail2 = { status: 'out_of_stock', leadTimeDays: null };

      expect(equals(avail1, avail2)).toBe(true);
    });
  });

  describe('text objects', () => {
    it('should compare text objects by hash', () => {
      const text1 = { hash: 'abc123', snippet: 'Original text' };
      const text2 = { hash: 'abc123', snippet: 'Original text' };

      expect(equals(text1, text2)).toBe(true);
    });

    it('should detect different hashes', () => {
      const text1 = { hash: 'abc123', snippet: 'Original text' };
      const text2 = { hash: 'def456', snippet: 'Changed text' };

      expect(equals(text1, text2)).toBe(false);
    });

    it('should ignore snippet differences if hash matches', () => {
      const text1 = { hash: 'abc123', snippet: 'Text A' };
      const text2 = { hash: 'abc123', snippet: 'Text B' };

      // Should match because hash matches
      expect(equals(text1, text2)).toBe(true);
    });
  });

  describe('generic values - JSON fallback', () => {
    it('should compare primitive values', () => {
      expect(equals(100, 100)).toBe(true);
      expect(equals(100, 200)).toBe(false);
      expect(equals('hello', 'hello')).toBe(true);
      expect(equals('hello', 'world')).toBe(false);
      expect(equals(true, true)).toBe(true);
      expect(equals(true, false)).toBe(false);
    });

    it('should compare simple objects', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 2 };
      const obj3 = { a: 1, b: 3 };

      expect(equals(obj1, obj2)).toBe(true);
      expect(equals(obj1, obj3)).toBe(false);
    });

    it('should compare nested objects', () => {
      const obj1 = { a: 1, b: { c: 2, d: 3 } };
      const obj2 = { a: 1, b: { c: 2, d: 3 } };
      const obj3 = { a: 1, b: { c: 2, d: 4 } };

      expect(equals(obj1, obj2)).toBe(true);
      expect(equals(obj1, obj3)).toBe(false);
    });

    it('should compare arrays', () => {
      const arr1 = [1, 2, 3];
      const arr2 = [1, 2, 3];
      const arr3 = [1, 2, 4];

      expect(equals(arr1, arr2)).toBe(true);
      expect(equals(arr1, arr3)).toBe(false);
    });

    it('should be sensitive to key order in JSON comparison', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      // Note: JSON.stringify is order-sensitive
      // This is a known limitation but acceptable for our use case
      expect(equals(obj1, obj2)).toBe(false);
    });
  });

  describe('type precedence', () => {
    it('should prioritize price comparison over generic', () => {
      const price = { value: 99.99, currency: 'USD', extra: 'data' };
      const similar = { value: 99.99, currency: 'USD', extra: 'different' };

      // Should use price comparison (ignoring extra field)
      expect(equals(price, similar)).toBe(true);
    });

    it('should prioritize availability comparison over generic', () => {
      const avail = { status: 'in_stock', leadTimeDays: 0, extra: 'data' };
      const similar = { status: 'in_stock', leadTimeDays: 0, extra: 'different' };

      // Should use availability comparison (ignoring extra field)
      expect(equals(avail, similar)).toBe(true);
    });

    it('should prioritize text hash comparison over generic', () => {
      const text = { hash: 'abc123', content: 'Text A', other: 'data' };
      const similar = { hash: 'abc123', content: 'Text B', other: 'different' };

      // Should use hash comparison (ignoring other fields)
      expect(equals(text, similar)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty objects', () => {
      expect(equals({}, {})).toBe(true);
    });

    it('should handle empty arrays', () => {
      expect(equals([], [])).toBe(true);
    });

    it('should handle objects vs arrays', () => {
      expect(equals({}, [])).toBe(false);
    });

    it('should handle numbers vs strings', () => {
      expect(equals(100, '100')).toBe(false);
    });

    it('should handle boolean vs number', () => {
      expect(equals(true, 1)).toBe(false);
      expect(equals(false, 0)).toBe(false);
    });

    it('should handle very large objects', () => {
      const large1 = { data: Array(1000).fill({ value: 1 }) };
      const large2 = { data: Array(1000).fill({ value: 1 }) };

      expect(equals(large1, large2)).toBe(true);
    });
  });
});
