import { Test, TestingModule } from '@nestjs/testing';
import { ConditionEvaluatorService } from './condition-evaluator.service';
import type { AlertCondition, RuleType } from '@sentinel/shared';
import type { ChangeDetectionResult } from '../utils/change-detection';

describe('ConditionEvaluatorService', () => {
  let service: ConditionEvaluatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConditionEvaluatorService],
    }).compile();

    service = module.get<ConditionEvaluatorService>(ConditionEvaluatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('price_below condition', () => {
    it('should trigger when price is below threshold', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'price_below',
          value: 100,
          severity: 'warning',
        },
      ];

      const normalizedValue = { value: 80, currency: 'USD' };
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Price decreased',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'price' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(1);
      expect(triggered[0].type).toBe('price_below');
    });

    it('should not trigger when price is above threshold', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'price_below',
          value: 100,
          severity: 'warning',
        },
      ];

      const normalizedValue = { value: 120, currency: 'USD' };
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Price increased',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'price' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(0);
    });
  });

  describe('price_drop_percent condition', () => {
    it('should trigger when price drops by required percentage', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'price_drop_percent',
          value: 10, // 10% drop threshold
          severity: 'critical',
        },
      ];

      const previousValue = { value: 100, currency: 'USD' };
      const normalizedValue = { value: 85, currency: 'USD' }; // 15% drop
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Price decreased',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        previousValue,
        'price' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(1);
      expect(triggered[0].type).toBe('price_drop_percent');
    });

    it('should not trigger when price increases', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'price_drop_percent',
          value: 10,
          severity: 'critical',
        },
      ];

      const previousValue = { value: 100, currency: 'USD' };
      const normalizedValue = { value: 110, currency: 'USD' }; // 10% increase
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Price increased',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        previousValue,
        'price' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(0);
    });
  });

  describe('availability_is condition', () => {
    it('should trigger when availability matches expected status', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'availability_is',
          value: 'out_of_stock',
          severity: 'critical',
        },
      ];

      const normalizedValue = { status: 'out_of_stock' };
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Availability changed',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'availability' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(1);
      expect(triggered[0].type).toBe('availability_is');
    });
  });

  describe('number_below and number_above conditions', () => {
    it('should trigger number_below when value is below threshold', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'number_below',
          value: 50,
          severity: 'warning',
        },
      ];

      const normalizedValue = 30;
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Number changed',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'number' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(1);
      expect(triggered[0].type).toBe('number_below');
    });

    it('should trigger number_above when value is above threshold', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'number_above',
          value: 100,
          severity: 'info',
        },
      ];

      const normalizedValue = 150;
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Number increased',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'number' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(1);
      expect(triggered[0].type).toBe('number_above');
    });
  });

  describe('multiple conditions', () => {
    it('should trigger multiple conditions when all are met', () => {
      const conditions: AlertCondition[] = [
        {
          id: '1',
          type: 'price_below',
          value: 100,
          severity: 'warning',
        },
        {
          id: '2',
          type: 'price_above',
          value: 50,
          severity: 'info',
        },
      ];

      const normalizedValue = { value: 75, currency: 'USD' };
      const changeResult: ChangeDetectionResult = {
        changeKind: 'value_changed' as any,
        diffSummary: 'Price changed',
      };

      const triggered = service.evaluateConditions(
        conditions,
        normalizedValue,
        null,
        'price' as RuleType,
        changeResult,
      );

      expect(triggered).toHaveLength(2);
      expect(triggered.map((c) => c.type)).toContain('price_below');
      expect(triggered.map((c) => c.type)).toContain('price_above');
    });
  });
});
