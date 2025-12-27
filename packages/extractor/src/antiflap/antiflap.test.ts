/**
 * Anti-flap state machine tests
 *
 * Verifies:
 * - First observation behavior
 * - Stable value detection
 * - Candidate value accumulation
 * - Change confirmation threshold
 * - Candidate reset on value change
 * - Different value types (price, availability, text, generic)
 */

import { processAntiFlap } from './antiflap';
import { RuleState } from './types';

describe('processAntiFlap', () => {
  describe('first observation', () => {
    it('should set initial value as stable without confirming change', () => {
      const { result, newState } = processAntiFlap(100, null, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.previousStable).toBeNull();
      expect(result.newStable).toBe(100);
      expect(result.candidateValue).toBeNull();
      expect(result.candidateCount).toBe(0);

      expect(newState.lastStable).toBe(100);
      expect(newState.candidate).toBeNull();
      expect(newState.candidateCount).toBe(0);
    });

    it('should handle state with null lastStable as first observation', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: null,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(50, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.newStable).toBe(50);
      expect(newState.lastStable).toBe(50);
    });
  });

  describe('stable value - no change', () => {
    it('should reset candidate when value matches stable', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 200,
        candidateCount: 2,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(100, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.candidateValue).toBeNull();
      expect(result.candidateCount).toBe(0);

      expect(newState.candidate).toBeNull();
      expect(newState.candidateCount).toBe(0);
    });

    it('should handle returning to stable after candidate accumulation', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 150,
        candidateCount: 1,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(100, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(newState.candidate).toBeNull();
      expect(newState.candidateCount).toBe(0);
    });
  });

  describe('new candidate value', () => {
    it('should create new candidate on first different value', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(200, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.candidateValue).toBe(200);
      expect(result.candidateCount).toBe(1);

      expect(newState.candidate).toBe(200);
      expect(newState.candidateCount).toBe(1);
    });

    it('should reset candidate when value changes again', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 200,
        candidateCount: 2,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(300, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.candidateValue).toBe(300);
      expect(result.candidateCount).toBe(1);

      expect(newState.candidate).toBe(300);
      expect(newState.candidateCount).toBe(1);
    });
  });

  describe('candidate accumulation', () => {
    it('should increment count when candidate repeats', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 200,
        candidateCount: 1,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(200, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.candidateValue).toBe(200);
      expect(result.candidateCount).toBe(2);

      expect(newState.candidateCount).toBe(2);
    });

    it('should increment count multiple times', () => {
      let state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 200,
        candidateCount: 1,
        updatedAt: new Date(),
      };

      // Second observation
      const step1 = processAntiFlap(200, state, 4);
      expect(step1.result.candidateCount).toBe(2);

      state = { ...state, ...step1.newState };

      // Third observation
      const step2 = processAntiFlap(200, state, 4);
      expect(step2.result.candidateCount).toBe(3);
    });
  });

  describe('change confirmation', () => {
    it('should confirm change when threshold reached', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: 200,
        candidateCount: 2,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(200, state, 3);

      expect(result.confirmedChange).toBe(true);
      expect(result.previousStable).toBe(100);
      expect(result.newStable).toBe(200);
      expect(result.candidateValue).toBeNull();
      expect(result.candidateCount).toBe(0);

      expect(newState.lastStable).toBe(200);
      expect(newState.candidate).toBeNull();
      expect(newState.candidateCount).toBe(0);
    });

    it('should confirm change with requireConsecutive=1', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const { result, newState } = processAntiFlap(200, state, 1);

      expect(result.confirmedChange).toBe(true);
      expect(result.previousStable).toBe(100);
      expect(result.newStable).toBe(200);

      expect(newState.lastStable).toBe(200);
    });

    it('should handle full sequence: stable → candidate → confirm', () => {
      let state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      // First new value
      const step1 = processAntiFlap(200, state, 3);
      expect(step1.result.confirmedChange).toBe(false);
      expect(step1.result.candidateCount).toBe(1);
      state = { ...state, ...step1.newState };

      // Second same value
      const step2 = processAntiFlap(200, state, 3);
      expect(step2.result.confirmedChange).toBe(false);
      expect(step2.result.candidateCount).toBe(2);
      state = { ...state, ...step2.newState };

      // Third same value - confirm!
      const step3 = processAntiFlap(200, state, 3);
      expect(step3.result.confirmedChange).toBe(true);
      expect(step3.result.previousStable).toBe(100);
      expect(step3.result.newStable).toBe(200);
    });
  });

  describe('value types - price', () => {
    it('should handle price objects correctly', () => {
      const price1 = { value: 99.99, currency: 'USD' };
      const price2 = { value: 89.99, currency: 'USD' };

      let state: RuleState = {
        ruleId: 'rule-1',
        lastStable: price1,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      // Same price - no change
      const step1 = processAntiFlap(price1, state, 3);
      expect(step1.result.confirmedChange).toBe(false);
      expect(step1.newState.candidate).toBeNull();

      // Different price - new candidate
      const step2 = processAntiFlap(price2, state, 3);
      expect(step2.result.confirmedChange).toBe(false);
      expect(step2.result.candidateCount).toBe(1);
    });

    it('should confirm price change', () => {
      const price1 = { value: 99.99, currency: 'USD' };
      const price2 = { value: 89.99, currency: 'USD' };

      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: price1,
        candidate: price2,
        candidateCount: 2,
        updatedAt: new Date(),
      };

      const { result } = processAntiFlap(price2, state, 3);

      expect(result.confirmedChange).toBe(true);
      expect(result.previousStable).toEqual(price1);
      expect(result.newStable).toEqual(price2);
    });
  });

  describe('value types - availability', () => {
    it('should handle availability objects correctly', () => {
      const avail1 = { status: 'in_stock', leadTimeDays: 0 };
      const avail2 = { status: 'out_of_stock', leadTimeDays: null };

      let state: RuleState = {
        ruleId: 'rule-1',
        lastStable: avail1,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      // Same availability - no change
      const step1 = processAntiFlap(avail1, state, 2);
      expect(step1.result.confirmedChange).toBe(false);

      // Different availability - new candidate
      const step2 = processAntiFlap(avail2, state, 2);
      expect(step2.result.candidateCount).toBe(1);
      state = { ...state, ...step2.newState };

      // Confirm change
      const step3 = processAntiFlap(avail2, state, 2);
      expect(step3.result.confirmedChange).toBe(true);
      expect(step3.result.previousStable).toEqual(avail1);
      expect(step3.result.newStable).toEqual(avail2);
    });
  });

  describe('value types - text', () => {
    it('should handle text objects with hash', () => {
      const text1 = { hash: 'abc123', snippet: 'Original text' };
      const text2 = { hash: 'def456', snippet: 'Changed text' };

      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: text1,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      // Same hash - no change
      const step1 = processAntiFlap(text1, state, 2);
      expect(step1.result.confirmedChange).toBe(false);

      // Different hash - new candidate
      const step2 = processAntiFlap(text2, state, 2);
      expect(step2.result.candidateCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle requireConsecutive=0', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const { result } = processAntiFlap(200, state, 0);

      // With threshold 0, first observation should confirm
      expect(result.confirmedChange).toBe(true);
    });

    it('should handle complex objects', () => {
      const obj1 = { a: 1, b: { c: 2 } };
      const obj2 = { a: 1, b: { c: 3 } };

      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: obj1,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const step1 = processAntiFlap(obj1, state, 2);
      expect(step1.result.confirmedChange).toBe(false);

      const step2 = processAntiFlap(obj2, state, 2);
      expect(step2.result.candidateCount).toBe(1);
    });

    it('should handle null values', () => {
      const state: RuleState = {
        ruleId: 'rule-1',
        lastStable: null,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      const { result } = processAntiFlap(100, state, 3);

      expect(result.confirmedChange).toBe(false);
      expect(result.newStable).toBe(100);
    });

    it('should handle flapping scenario', () => {
      let state: RuleState = {
        ruleId: 'rule-1',
        lastStable: 100,
        candidate: null,
        candidateCount: 0,
        updatedAt: new Date(),
      };

      // Value flaps between 100 and 200
      const step1 = processAntiFlap(200, state, 3);
      expect(step1.result.candidateCount).toBe(1);
      state = { ...state, ...step1.newState };

      const step2 = processAntiFlap(100, state, 3); // Back to stable
      expect(step2.newState.candidate).toBeNull();
      state = { ...state, ...step2.newState };

      const step3 = processAntiFlap(200, state, 3); // New candidate again
      expect(step3.result.candidateCount).toBe(1);
      state = { ...state, ...step3.newState };

      const step4 = processAntiFlap(100, state, 3); // Back again
      expect(step4.newState.candidate).toBeNull();

      // Should never confirm change due to flapping
      expect(step1.result.confirmedChange).toBe(false);
      expect(step2.result.confirmedChange).toBe(false);
      expect(step3.result.confirmedChange).toBe(false);
      expect(step4.result.confirmedChange).toBe(false);
    });
  });
});
