import { Injectable, Logger } from '@nestjs/common';
import type {
  AlertCondition,
  AlertConditionType,
  RuleType,
  NormalizedPrice,
  NormalizedAvailability,
} from '@sentinel/shared';
import type { ChangeDetectionResult } from '../utils/change-detection';

/**
 * Service for evaluating alert conditions
 *
 * Implements all condition types defined in PRD:
 * - price_below, price_above, price_drop_percent
 * - availability_is
 * - text_changed, number_changed
 * - number_below, number_above
 */
@Injectable()
export class ConditionEvaluatorService {
  private readonly logger = new Logger(ConditionEvaluatorService.name);

  /**
   * Evaluate all conditions and return those that are triggered
   *
   * @param conditions Alert conditions to evaluate
   * @param normalizedValue Current normalized value
   * @param previousValue Previous stable value
   * @param ruleType Type of rule being monitored
   * @param changeResult Change detection result
   * @returns Array of triggered conditions
   */
  evaluateConditions(
    conditions: AlertCondition[],
    normalizedValue: any,
    previousValue: any,
    ruleType: RuleType,
    changeResult: ChangeDetectionResult,
  ): AlertCondition[] {
    const triggeredConditions: AlertCondition[] = [];

    for (const condition of conditions) {
      try {
        if (
          this.evaluateSingleCondition(
            condition,
            normalizedValue,
            previousValue,
            ruleType,
            changeResult,
          )
        ) {
          triggeredConditions.push(condition);
          this.logger.debug(
            `Condition triggered: ${condition.type} (severity: ${condition.severity})`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to evaluate condition ${condition.id} (${condition.type}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return triggeredConditions;
  }

  /**
   * Evaluate a single alert condition
   *
   * @param condition Alert condition to evaluate
   * @param value Current normalized value
   * @param prevValue Previous stable value
   * @param ruleType Type of rule
   * @param change Change detection result
   * @returns true if condition is triggered
   */
  private evaluateSingleCondition(
    condition: AlertCondition,
    value: any,
    prevValue: any,
    ruleType: RuleType,
    change: ChangeDetectionResult,
  ): boolean {
    switch (condition.type) {
      // Legacy PRD condition types
      case 'price_below':
        return this.evaluatePriceBelow(condition, value, ruleType);

      case 'price_above':
        return this.evaluatePriceAbove(condition, value, ruleType);

      case 'price_drop_percent':
        return this.evaluatePriceDropPercent(
          condition,
          value,
          prevValue,
          ruleType,
        );

      case 'availability_is':
        return this.evaluateAvailabilityIs(condition, value, ruleType);

      case 'text_changed':
        return this.evaluateTextChanged(ruleType, change);

      case 'number_changed':
        return this.evaluateNumberChanged(ruleType, change);

      case 'number_below':
        return this.evaluateNumberBelow(condition, value, ruleType);

      case 'number_above':
        return this.evaluateNumberAbove(condition, value, ruleType);

      // API condition types (from alert-policy.dto.ts)
      case 'value_changed':
        return this.evaluateValueChanged(change);

      case 'value_increased':
        return this.evaluateValueIncreased(value, prevValue, ruleType);

      case 'value_decreased':
        return this.evaluateValueDecreased(value, prevValue, ruleType);

      case 'value_above':
        return this.evaluateValueAbove(condition, value, ruleType);

      case 'value_below':
        return this.evaluateValueBelow(condition, value, ruleType);

      case 'value_disappeared':
        return change.changeKind === 'value_disappeared';

      case 'value_appeared':
        return change.changeKind === 'new_value';

      default:
        this.logger.warn(
          `Unknown condition type: ${(condition as any).type}`,
        );
        return false;
    }
  }

  /**
   * Evaluate value_changed condition (generic - works for all rule types)
   * Triggers when any value change is detected
   */
  private evaluateValueChanged(change: ChangeDetectionResult): boolean {
    // Trigger on any change except first observation
    return change.changeKind !== null && change.changeKind !== ('new_value' as any);
  }

  /**
   * Evaluate value_increased condition (for price/number types)
   * Triggers when value increased
   */
  private evaluateValueIncreased(
    value: any,
    prevValue: any,
    ruleType: RuleType,
  ): boolean {
    if (!prevValue) return false;

    const currentNum = this.extractNumericValue(value, ruleType);
    const prevNum = this.extractNumericValue(prevValue, ruleType);

    if (currentNum === null || prevNum === null) return false;

    return currentNum > prevNum;
  }

  /**
   * Evaluate value_decreased condition (for price/number types)
   * Triggers when value decreased
   */
  private evaluateValueDecreased(
    value: any,
    prevValue: any,
    ruleType: RuleType,
  ): boolean {
    if (!prevValue) return false;

    const currentNum = this.extractNumericValue(value, ruleType);
    const prevNum = this.extractNumericValue(prevValue, ruleType);

    if (currentNum === null || prevNum === null) return false;

    return currentNum < prevNum;
  }

  /**
   * Evaluate value_above condition (generic threshold)
   */
  private evaluateValueAbove(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    const num = this.extractNumericValue(value, ruleType);
    const threshold = condition.threshold ?? Number(condition.value);

    if (num === null || isNaN(threshold)) return false;

    return num > threshold;
  }

  /**
   * Evaluate value_below condition (generic threshold)
   */
  private evaluateValueBelow(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    const num = this.extractNumericValue(value, ruleType);
    const threshold = condition.threshold ?? Number(condition.value);

    if (num === null || isNaN(threshold)) return false;

    return num < threshold;
  }

  /**
   * Extract numeric value from normalized value based on rule type
   */
  private extractNumericValue(value: any, ruleType: RuleType): number | null {
    if (value === null || value === undefined) return null;

    if (ruleType === 'price') {
      const price = (value as NormalizedPrice)?.value;
      return typeof price === 'number' ? price : null;
    }

    if (ruleType === 'number') {
      const num = typeof value === 'number' ? value : parseFloat(value);
      return isNaN(num) ? null : num;
    }

    // For text type, try to parse as number
    if (typeof value === 'string') {
      const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
      return isNaN(num) ? null : num;
    }

    return typeof value === 'number' ? value : null;
  }

  /**
   * Evaluate price_below condition
   * Triggers when current price is below threshold
   */
  private evaluatePriceBelow(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'price') return false;

    const price = (value as NormalizedPrice)?.value;
    const threshold = Number(condition.value);

    if (typeof price !== 'number' || isNaN(threshold)) {
      return false;
    }

    return price < threshold;
  }

  /**
   * Evaluate price_above condition
   * Triggers when current price is above threshold
   */
  private evaluatePriceAbove(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'price') return false;

    const price = (value as NormalizedPrice)?.value;
    const threshold = Number(condition.value);

    if (typeof price !== 'number' || isNaN(threshold)) {
      return false;
    }

    return price > threshold;
  }

  /**
   * Evaluate price_drop_percent condition
   * Triggers when price dropped by at least X percent
   */
  private evaluatePriceDropPercent(
    condition: AlertCondition,
    value: any,
    prevValue: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'price') return false;
    if (!prevValue) return false; // Cannot compute percent change without previous value

    const currentPrice = (value as NormalizedPrice)?.value;
    const previousPrice = (prevValue as NormalizedPrice)?.value;
    const dropThreshold = Number(condition.value);

    if (
      typeof currentPrice !== 'number' ||
      typeof previousPrice !== 'number' ||
      isNaN(dropThreshold) ||
      previousPrice === 0
    ) {
      return false;
    }

    // Calculate percent change
    const percentChange = ((currentPrice - previousPrice) / previousPrice) * 100;

    // Drop is negative change
    // If threshold is 10, we trigger when percentChange <= -10
    return percentChange <= -dropThreshold;
  }

  /**
   * Evaluate availability_is condition
   * Triggers when availability status matches expected value
   */
  private evaluateAvailabilityIs(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'availability') return false;

    const status = (value as NormalizedAvailability)?.status;
    const expectedStatus = String(condition.value);

    return status === expectedStatus;
  }

  /**
   * Evaluate text_changed condition
   * Triggers when any text change is detected
   */
  private evaluateTextChanged(
    ruleType: RuleType,
    change: ChangeDetectionResult,
  ): boolean {
    if (ruleType !== 'text') return false;

    // Text changed if changeKind is not null (excluding new_value which is first observation)
    // We check for value_changed, format_changed, value_disappeared
    return change.changeKind !== null &&
           change.changeKind !== ('new_value' as any);
  }

  /**
   * Evaluate number_changed condition
   * Triggers when any number change is detected
   */
  private evaluateNumberChanged(
    ruleType: RuleType,
    change: ChangeDetectionResult,
  ): boolean {
    if (ruleType !== 'number') return false;

    // Number changed if changeKind is not null (excluding new_value which is first observation)
    // We check for value_changed, format_changed, value_disappeared
    return change.changeKind !== null &&
           change.changeKind !== ('new_value' as any);
  }

  /**
   * Evaluate number_below condition
   * Triggers when current number is below threshold
   */
  private evaluateNumberBelow(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'number') return false;

    const num = typeof value === 'number' ? value : parseFloat(value);
    const threshold = Number(condition.value);

    if (isNaN(num) || isNaN(threshold)) {
      return false;
    }

    return num < threshold;
  }

  /**
   * Evaluate number_above condition
   * Triggers when current number is above threshold
   */
  private evaluateNumberAbove(
    condition: AlertCondition,
    value: any,
    ruleType: RuleType,
  ): boolean {
    if (ruleType !== 'number') return false;

    const num = typeof value === 'number' ? value : parseFloat(value);
    const threshold = Number(condition.value);

    if (isNaN(num) || isNaN(threshold)) {
      return false;
    }

    return num > threshold;
  }
}
