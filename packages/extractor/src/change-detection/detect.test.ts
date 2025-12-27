// Comprehensive tests for change detection module

import { detectChange } from './detect';
import { detectPriceChange } from './price';
import { detectAvailabilityChange } from './availability';
import { detectTextChange } from './text';
import { detectNumberChange } from './number';
import type {
  NormalizedPrice,
  NormalizedAvailability,
  NormalizedText,
} from '@sentinel/shared';

describe('Change Detection Module', () => {
  describe('detectPriceChange', () => {
    it('should detect price increase', () => {
      const prev: NormalizedPrice = { value: 100, currency: 'EUR' };
      const curr: NormalizedPrice = { value: 120, currency: 'EUR' };

      const result = detectPriceChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(20);
      expect(result.diffSummary).toBe('100 → 120 EUR (+20.0%)');
    });

    it('should detect price decrease', () => {
      const prev: NormalizedPrice = { value: 100, currency: 'USD' };
      const curr: NormalizedPrice = { value: 75, currency: 'USD' };

      const result = detectPriceChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('decreased');
      expect(result.percentChange).toBe(-25);
      expect(result.diffSummary).toBe('100 → 75 USD (-25.0%)');
    });

    it('should handle no price change', () => {
      const prev: NormalizedPrice = { value: 100, currency: 'GBP' };
      const curr: NormalizedPrice = { value: 100, currency: 'GBP' };

      const result = detectPriceChange(prev, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
      expect(result.percentChange).toBeUndefined();
    });

    it('should handle null previous value', () => {
      const curr: NormalizedPrice = { value: 100, currency: 'EUR' };

      const result = detectPriceChange(null, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });

    it('should handle undefined current value', () => {
      const prev: NormalizedPrice = { value: 100, currency: 'EUR' };

      const result = detectPriceChange(prev, undefined);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });

    it('should handle price increase from zero', () => {
      const prev: NormalizedPrice = { value: 0, currency: 'EUR' };
      const curr: NormalizedPrice = { value: 100, currency: 'EUR' };

      const result = detectPriceChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(100); // 100% when dividing by zero scenario
    });

    it('should handle small price changes with decimals', () => {
      const prev: NormalizedPrice = { value: 99.99, currency: 'USD' };
      const curr: NormalizedPrice = { value: 89.99, currency: 'USD' };

      const result = detectPriceChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('decreased');
      expect(result.percentChange).toBeCloseTo(-10.0, 1);
      expect(result.diffSummary).toContain('99.99 → 89.99 USD');
    });
  });

  describe('detectAvailabilityChange', () => {
    it('should detect status change', () => {
      const prev: NormalizedAvailability = { status: 'in_stock' };
      const curr: NormalizedAvailability = { status: 'out_of_stock' };

      const result = detectAvailabilityChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('status_change');
      expect(result.diffSummary).toBe('in_stock → out_of_stock');
    });

    it('should detect lead time change', () => {
      const prev: NormalizedAvailability = { status: 'lead_time', leadTimeDays: 5 };
      const curr: NormalizedAvailability = { status: 'lead_time', leadTimeDays: 10 };

      const result = detectAvailabilityChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('status_change');
      expect(result.diffSummary).toContain('lead time: 5 → 10 days');
    });

    it('should detect both status and lead time change', () => {
      const prev: NormalizedAvailability = { status: 'in_stock', leadTimeDays: null };
      const curr: NormalizedAvailability = { status: 'lead_time', leadTimeDays: 7 };

      const result = detectAvailabilityChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('status_change');
      expect(result.diffSummary).toContain('in_stock → lead_time');
      expect(result.diffSummary).toContain('lead time');
    });

    it('should handle no availability change', () => {
      const prev: NormalizedAvailability = { status: 'in_stock' };
      const curr: NormalizedAvailability = { status: 'in_stock' };

      const result = detectAvailabilityChange(prev, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });

    it('should handle null previous value', () => {
      const curr: NormalizedAvailability = { status: 'in_stock' };

      const result = detectAvailabilityChange(null, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle undefined current value', () => {
      const prev: NormalizedAvailability = { status: 'in_stock' };

      const result = detectAvailabilityChange(prev, undefined);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle N/A lead times in diff summary', () => {
      const prev: NormalizedAvailability = { status: 'lead_time', leadTimeDays: null };
      const curr: NormalizedAvailability = { status: 'lead_time', leadTimeDays: 3 };

      const result = detectAvailabilityChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.diffSummary).toContain('N/A → 3');
    });
  });

  describe('detectTextChange', () => {
    it('should detect text change via hash', () => {
      const prev: NormalizedText = {
        hash: 'abc123',
        snippet: 'Original text content',
      };
      const curr: NormalizedText = {
        hash: 'def456',
        snippet: 'Updated text content with more info',
      };

      const result = detectTextChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('text_diff');
      expect(result.diffSummary).toContain('Content changed');
      expect(result.diffSummary).toContain('+14 chars');
    });

    it('should detect text shortening', () => {
      const prev: NormalizedText = {
        hash: 'abc123',
        snippet: 'Very long text content here',
      };
      const curr: NormalizedText = {
        hash: 'def456',
        snippet: 'Short text',
      };

      const result = detectTextChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('text_diff');
      expect(result.diffSummary).toContain('-17 chars');
    });

    it('should handle no text change (same hash)', () => {
      const prev: NormalizedText = {
        hash: 'abc123',
        snippet: 'Same content',
      };
      const curr: NormalizedText = {
        hash: 'abc123',
        snippet: 'Same content',
      };

      const result = detectTextChange(prev, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });

    it('should handle null previous value', () => {
      const curr: NormalizedText = {
        hash: 'abc123',
        snippet: 'New content',
      };

      const result = detectTextChange(null, curr);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle undefined current value', () => {
      const prev: NormalizedText = {
        hash: 'abc123',
        snippet: 'Old content',
      };

      const result = detectTextChange(prev, undefined);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle same length but different content', () => {
      const prev: NormalizedText = {
        hash: 'abc123',
        snippet: 'Text A',
      };
      const curr: NormalizedText = {
        hash: 'def456',
        snippet: 'Text B',
      };

      const result = detectTextChange(prev, curr);

      expect(result.changed).toBe(true);
      expect(result.diffSummary).toContain('0 chars');
    });
  });

  describe('detectNumberChange', () => {
    it('should detect number increase', () => {
      const result = detectNumberChange(100, 150);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(50);
      expect(result.diffSummary).toBe('100 → 150');
    });

    it('should detect number decrease', () => {
      const result = detectNumberChange(200, 100);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('decreased');
      expect(result.percentChange).toBe(-50);
      expect(result.diffSummary).toBe('200 → 100');
    });

    it('should handle no number change', () => {
      const result = detectNumberChange(42, 42);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });

    it('should handle null previous value', () => {
      const result = detectNumberChange(null, 100);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle undefined current value', () => {
      const result = detectNumberChange(100, undefined);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });

    it('should handle increase from zero', () => {
      const result = detectNumberChange(0, 100);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(100);
    });

    it('should handle negative numbers', () => {
      const result = detectNumberChange(-50, -30);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      // (-30 - (-50)) / -50 * 100 = 20 / -50 * 100 = -40
      expect(result.percentChange).toBe(-40);
    });

    it('should handle decimal numbers', () => {
      const result = detectNumberChange(10.5, 12.6);

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBeCloseTo(20, 0);
    });

    it('should handle zero to zero', () => {
      const result = detectNumberChange(0, 0);

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
    });
  });

  describe('detectChange (main function)', () => {
    it('should route to price detection', () => {
      const prev: NormalizedPrice = { value: 100, currency: 'EUR' };
      const curr: NormalizedPrice = { value: 120, currency: 'EUR' };

      const result = detectChange(prev, curr, 'price');

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(20);
    });

    it('should route to availability detection', () => {
      const prev: NormalizedAvailability = { status: 'in_stock' };
      const curr: NormalizedAvailability = { status: 'out_of_stock' };

      const result = detectChange(prev, curr, 'availability');

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('status_change');
    });

    it('should route to text detection', () => {
      const prev: NormalizedText = { hash: 'abc', snippet: 'Old' };
      const curr: NormalizedText = { hash: 'def', snippet: 'New' };

      const result = detectChange(prev, curr, 'text');

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('text_diff');
    });

    it('should route to number detection', () => {
      const result = detectChange(100, 200, 'number');

      expect(result.changed).toBe(true);
      expect(result.changeKind).toBe('increased');
      expect(result.percentChange).toBe(100);
    });

    it('should handle invalid rule type gracefully', () => {
      // @ts-expect-error - testing invalid type
      const result = detectChange(100, 200, 'invalid_type');

      expect(result.changed).toBe(false);
      expect(result.changeKind).toBe(null);
      expect(result.diffSummary).toBe(null);
    });
  });
});
