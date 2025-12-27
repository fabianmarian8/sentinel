import { normalizeAvailability } from './availability';
import { AvailabilityNormalization } from '@sentinel/shared';

describe('normalizeAvailability', () => {
  const config: AvailabilityNormalization = {
    kind: 'availability',
    mapping: [
      { match: 'skladom', status: 'in_stock' },
      { match: 'na sklade', status: 'in_stock' },
      { match: 'dostupné', status: 'in_stock' },
      { match: 'vypredané', status: 'out_of_stock' },
      { match: 'nedostupné', status: 'out_of_stock' },
      { match: 'na objednávku', status: 'backorder' },
      { match: 'do \\d+ dní', status: 'lead_time', extractLeadTimeDays: true },
      {
        match: 'do \\d+ pracovných dní',
        status: 'lead_time',
        extractLeadTimeDays: true,
      },
    ],
    defaultStatus: 'unknown',
  };

  describe('in_stock status', () => {
    it('should recognize "Skladom"', () => {
      const result = normalizeAvailability('Skladom', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should recognize "Na sklade > 5 ks"', () => {
      const result = normalizeAvailability('Na sklade > 5 ks', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should handle case insensitivity for "SKLADOM"', () => {
      const result = normalizeAvailability('SKLADOM', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should recognize "dostupné"', () => {
      const result = normalizeAvailability('dostupné', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });
  });

  describe('out_of_stock status', () => {
    it('should recognize "Vypredané"', () => {
      const result = normalizeAvailability('Vypredané', config);
      expect(result).toEqual({
        status: 'out_of_stock',
        leadTimeDays: null,
      });
    });

    it('should recognize "nedostupné"', () => {
      const result = normalizeAvailability('nedostupné', config);
      expect(result).toEqual({
        status: 'out_of_stock',
        leadTimeDays: null,
      });
    });
  });

  describe('lead_time status with extraction', () => {
    it('should extract lead time from "Dodanie do 3 dní"', () => {
      const result = normalizeAvailability('Dodanie do 3 dní', config);
      expect(result).toEqual({
        status: 'lead_time',
        leadTimeDays: 3,
      });
    });

    it('should extract lead time from "Expedícia do 5 pracovných dní"', () => {
      const result = normalizeAvailability(
        'Expedícia do 5 pracovných dní',
        config
      );
      expect(result).toEqual({
        status: 'lead_time',
        leadTimeDays: 5,
      });
    });

    it('should handle "do 14 dní"', () => {
      const result = normalizeAvailability('do 14 dní', config);
      expect(result).toEqual({
        status: 'lead_time',
        leadTimeDays: 14,
      });
    });

    it('should handle "Do 1 pracovných dní"', () => {
      const result = normalizeAvailability('Do 1 pracovných dní', config);
      expect(result).toEqual({
        status: 'lead_time',
        leadTimeDays: 1,
      });
    });
  });

  describe('backorder status', () => {
    it('should recognize "Na objednávku (2-3 týždne)"', () => {
      const result = normalizeAvailability('Na objednávku (2-3 týždne)', config);
      expect(result).toEqual({
        status: 'backorder',
        leadTimeDays: null,
      });
    });

    it('should recognize "na objednávku" case insensitive', () => {
      const result = normalizeAvailability('NA OBJEDNÁVKU', config);
      expect(result).toEqual({
        status: 'backorder',
        leadTimeDays: null,
      });
    });
  });

  describe('unknown status (default)', () => {
    it('should return unknown for "Neznámy stav"', () => {
      const result = normalizeAvailability('Neznámy stav', config);
      expect(result).toEqual({
        status: 'unknown',
        leadTimeDays: null,
      });
    });

    it('should return unknown for empty string', () => {
      const result = normalizeAvailability('', config);
      expect(result).toEqual({
        status: 'unknown',
        leadTimeDays: null,
      });
    });

    it('should return unknown for unrecognized text', () => {
      const result = normalizeAvailability('Totally random text', config);
      expect(result).toEqual({
        status: 'unknown',
        leadTimeDays: null,
      });
    });
  });

  describe('priority and matching order', () => {
    it('should match first rule when multiple could apply', () => {
      // "skladom" appears before "na sklade" in mapping
      const result = normalizeAvailability('na sklade skladom', config);
      expect(result.status).toBe('in_stock');
    });
  });

  describe('whitespace normalization', () => {
    it('should handle multiple spaces', () => {
      const result = normalizeAvailability('Na   sklade    > 5 ks', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should handle tabs and newlines', () => {
      const result = normalizeAvailability('Skladom\n\t\n', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle availability with accented characters', () => {
      const result = normalizeAvailability('Dostupné ihneď', config);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should not extract lead time when extractLeadTimeDays is false', () => {
      const result = normalizeAvailability('Skladom do 3 dní', config);
      // "skladom" rule matches first, doesn't extract days
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });

    it('should handle regex special characters in substring matches', () => {
      const customConfig: AvailabilityNormalization = {
        kind: 'availability',
        mapping: [{ match: 'available (now)', status: 'in_stock' }],
        defaultStatus: 'unknown',
      };
      const result = normalizeAvailability('Available (now)', customConfig);
      expect(result).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });
    });
  });

  describe('custom configurations', () => {
    it('should work with minimal config', () => {
      const minimalConfig: AvailabilityNormalization = {
        kind: 'availability',
        mapping: [],
        defaultStatus: 'unknown',
      };
      const result = normalizeAvailability('Anything', minimalConfig);
      expect(result).toEqual({
        status: 'unknown',
        leadTimeDays: null,
      });
    });

    it('should work with English availability terms', () => {
      const englishConfig: AvailabilityNormalization = {
        kind: 'availability',
        mapping: [
          { match: 'in stock', status: 'in_stock' },
          { match: 'out of stock', status: 'out_of_stock' },
          { match: 'ships in \\d+ days', status: 'lead_time', extractLeadTimeDays: true },
        ],
        defaultStatus: 'unknown',
      };

      expect(normalizeAvailability('In Stock', englishConfig)).toEqual({
        status: 'in_stock',
        leadTimeDays: null,
      });

      expect(normalizeAvailability('Ships in 7 days', englishConfig)).toEqual({
        status: 'lead_time',
        leadTimeDays: 7,
      });
    });
  });
});
