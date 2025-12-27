import { Test, TestingModule } from '@nestjs/testing';
import { AlertGeneratorService } from './alert-generator.service';
import type { AlertCondition } from '@sentinel/shared';
import type { ChangeDetectionResult } from '../utils/change-detection';

describe('AlertGeneratorService', () => {
  let service: AlertGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertGeneratorService],
    }).compile();

    service = module.get<AlertGeneratorService>(AlertGeneratorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHighestSeverity', () => {
    it('should return critical when critical condition is present', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'info' },
        { id: '2', type: 'price_drop_percent', value: 10, severity: 'critical' },
        { id: '3', type: 'price_above', value: 200, severity: 'warning' },
      ];

      const severity = service.getHighestSeverity(conditions);
      expect(severity).toBe('critical');
    });

    it('should return warning when no critical but warning is present', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'info' },
        { id: '2', type: 'price_above', value: 200, severity: 'warning' },
      ];

      const severity = service.getHighestSeverity(conditions);
      expect(severity).toBe('warning');
    });

    it('should return info for info-only conditions', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'info' },
      ];

      const severity = service.getHighestSeverity(conditions);
      expect(severity).toBe('info');
    });

    it('should return info for empty conditions', () => {
      const severity = service.getHighestSeverity([]);
      expect(severity).toBe('info');
    });
  });

  describe('generateAlertTitle', () => {
    const mockRule = {
      id: 'rule-1',
      name: 'iPhone Price Monitor',
      ruleType: 'price',
    };

    it('should generate title for price_below condition', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'warning' },
      ];

      const title = service.generateAlertTitle(mockRule, conditions);
      expect(title).toContain('Price Alert');
      expect(title).toContain('Below Threshold');
      expect(title).toContain(mockRule.name);
    });

    it('should generate title for price_drop_percent condition', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_drop_percent', value: 10, severity: 'critical' },
      ];

      const title = service.generateAlertTitle(mockRule, conditions);
      expect(title).toContain('Price Alert');
      expect(title).toContain('Significant Drop');
    });

    it('should generate title for availability condition', () => {
      const ruleAvail = { ...mockRule, ruleType: 'availability' };
      const conditions: AlertCondition[] = [
        { id: '1', type: 'availability_is', value: 'out_of_stock', severity: 'critical' },
      ];

      const title = service.generateAlertTitle(ruleAvail, conditions);
      expect(title).toContain('Availability Alert');
    });
  });

  describe('generateAlertBody', () => {
    const mockRule = {
      id: 'rule-1',
      name: 'iPhone Price Monitor',
      ruleType: 'price',
      source: {
        url: 'https://example.com/iphone',
      },
    };

    const mockChangeResult: ChangeDetectionResult = {
      changeKind: 'value_changed' as any,
      diffSummary: 'Price decreased: 999 USD → 799 USD (-20.0%)',
    };

    const mockConditions: AlertCondition[] = [
      { id: '1', type: 'price_below', value: 800, severity: 'warning' },
    ];

    it('should include rule name and URL', () => {
      const body = service.generateAlertBody(
        mockRule,
        { value: 799, currency: 'USD' },
        mockChangeResult,
        mockConditions,
      );

      expect(body).toContain(mockRule.name);
      expect(body).toContain(mockRule.source.url);
    });

    it('should include change summary', () => {
      const body = service.generateAlertBody(
        mockRule,
        { value: 799, currency: 'USD' },
        mockChangeResult,
        mockConditions,
      );

      expect(body).toContain(mockChangeResult.diffSummary!);
    });

    it('should include triggered conditions', () => {
      const body = service.generateAlertBody(
        mockRule,
        { value: 799, currency: 'USD' },
        mockChangeResult,
        mockConditions,
      );

      expect(body).toContain('Triggered Conditions');
      expect(body).toContain('Price below 800');
      expect(body).toContain('warning');
    });

    it('should include current value', () => {
      const body = service.generateAlertBody(
        mockRule,
        { value: 799, currency: 'USD' },
        mockChangeResult,
        mockConditions,
      );

      expect(body).toContain('Current Value');
      expect(body).toContain('799 USD');
    });
  });

  describe('generateDedupeKey', () => {
    it('should generate consistent keys for same input', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'warning' },
      ];
      const value = { value: 80, currency: 'USD' };

      const key1 = service.generateDedupeKey('rule-1', conditions, value);
      const key2 = service.generateDedupeKey('rule-1', conditions, value);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different rules', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'warning' },
      ];
      const value = { value: 80, currency: 'USD' };

      const key1 = service.generateDedupeKey('rule-1', conditions, value);
      const key2 = service.generateDedupeKey('rule-2', conditions, value);

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different values', () => {
      const conditions: AlertCondition[] = [
        { id: '1', type: 'price_below', value: 100, severity: 'warning' },
      ];

      const key1 = service.generateDedupeKey('rule-1', conditions, { value: 80, currency: 'USD' });
      const key2 = service.generateDedupeKey('rule-1', conditions, { value: 85, currency: 'USD' });

      expect(key1).not.toBe(key2);
    });
  });

  describe('mapSeverityToAlertSeverity', () => {
    it('should map info to low', () => {
      expect(service.mapSeverityToAlertSeverity('info')).toBe('low');
    });

    it('should map warning to medium', () => {
      expect(service.mapSeverityToAlertSeverity('warning')).toBe('medium');
    });

    it('should map critical to critical', () => {
      expect(service.mapSeverityToAlertSeverity('critical')).toBe('critical');
    });
  });
});
