import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  AlertCondition,
  Severity,
  RuleType,
  NormalizedPrice,
  NormalizedAvailability,
} from '@sentinel/shared';
import type { ChangeDetectionResult } from '../utils/change-detection';

/**
 * Service for generating alert messages
 *
 * Generates titles, bodies, and dedupe keys for alerts
 */
@Injectable()
export class AlertGeneratorService {
  private readonly logger = new Logger(AlertGeneratorService.name);

  /**
   * Get highest severity from triggered conditions
   *
   * Severity hierarchy: critical > warning > info
   */
  getHighestSeverity(conditions: AlertCondition[]): Severity {
    if (conditions.length === 0) {
      return 'info';
    }

    const severityOrder: Severity[] = ['critical', 'warning', 'info'];

    for (const severity of severityOrder) {
      if (conditions.some((c) => c.severity === severity)) {
        return severity;
      }
    }

    return 'info';
  }

  /**
   * Generate alert title
   *
   * Creates a concise title based on rule and triggered conditions
   */
  generateAlertTitle(
    rule: any,
    triggeredConditions: AlertCondition[],
  ): string {
    const conditionTypes = triggeredConditions.map((c) => c.type);
    const primaryCondition = triggeredConditions[0];

    // Build title based on condition type
    if (conditionTypes.includes('price_below')) {
      return `Price Alert: ${rule.name} - Below Threshold`;
    }

    if (conditionTypes.includes('price_above')) {
      return `Price Alert: ${rule.name} - Above Threshold`;
    }

    if (conditionTypes.includes('price_drop_percent')) {
      return `Price Alert: ${rule.name} - Significant Drop`;
    }

    if (conditionTypes.includes('availability_is')) {
      return `Availability Alert: ${rule.name}`;
    }

    if (conditionTypes.includes('text_changed')) {
      return `Text Change Alert: ${rule.name}`;
    }

    if (conditionTypes.includes('number_changed')) {
      return `Number Change Alert: ${rule.name}`;
    }

    if (conditionTypes.includes('number_below')) {
      return `Number Alert: ${rule.name} - Below Threshold`;
    }

    if (conditionTypes.includes('number_above')) {
      return `Number Alert: ${rule.name} - Above Threshold`;
    }

    // Fallback
    return `Change Detected: ${rule.name}`;
  }

  /**
   * Generate alert body
   *
   * Creates a detailed message with change information
   */
  generateAlertBody(
    rule: any,
    normalizedValue: any,
    changeResult: ChangeDetectionResult,
    triggeredConditions: AlertCondition[],
  ): string {
    const lines: string[] = [];

    // Header
    lines.push(`Rule: ${rule.name}`);
    lines.push(`URL: ${rule.source.url}`);
    lines.push('');

    // Change summary
    if (changeResult.diffSummary) {
      lines.push(`Change: ${changeResult.diffSummary}`);
      lines.push('');
    }

    // Current value
    lines.push(
      `Current Value: ${this.formatValue(normalizedValue, rule.ruleType)}`,
    );
    lines.push('');

    // Triggered conditions
    if (triggeredConditions.length > 0) {
      lines.push('Triggered Conditions:');
      for (const condition of triggeredConditions) {
        lines.push(
          `  - ${this.formatCondition(condition)} (${condition.severity})`,
        );
      }
      lines.push('');
    }

    // Footer
    lines.push(`Triggered at: ${new Date().toISOString()}`);
    lines.push(`Rule ID: ${rule.id}`);

    return lines.join('\n');
  }

  /**
   * Generate deduplication key
   *
   * Creates a unique key to prevent duplicate alerts for the same change
   */
  generateDedupeKey(
    ruleId: string,
    triggeredConditions: AlertCondition[],
    normalizedValue: any,
  ): string {
    // Create a deterministic hash based on:
    // - rule ID
    // - triggered condition types (sorted)
    // - normalized value (stringified)
    // - time window (5 minutes)

    const conditionTypes = triggeredConditions
      .map((c) => c.type)
      .sort()
      .join(',');

    const valueString = JSON.stringify(normalizedValue);
    const timeWindow = Math.floor(Date.now() / 300000); // 5-minute windows

    const dedupString = `${ruleId}|${conditionTypes}|${valueString}|${timeWindow}`;

    return createHash('sha256').update(dedupString).digest('hex').slice(0, 16);
  }

  /**
   * Map severity to AlertSeverity enum
   */
  mapSeverityToAlertSeverity(
    severity: Severity,
  ): 'low' | 'medium' | 'high' | 'critical' {
    const mapping: Record<Severity, 'low' | 'medium' | 'high' | 'critical'> = {
      info: 'low',
      warning: 'medium',
      critical: 'critical',
    };

    return mapping[severity] || 'medium';
  }

  /**
   * Format value for display
   */
  private formatValue(value: any, ruleType: RuleType): string {
    if (value === null || value === undefined) {
      return 'null';
    }

    switch (ruleType) {
      case 'price': {
        const price = value as NormalizedPrice;
        return `${price.value} ${price.currency}`;
      }

      case 'availability': {
        const availability = value as NormalizedAvailability;
        if (availability.leadTimeDays) {
          return `${availability.status} (${availability.leadTimeDays} days)`;
        }
        return availability.status;
      }

      case 'text': {
        return `"${value.snippet || value}"`;
      }

      case 'number': {
        return String(value);
      }

      default:
        return JSON.stringify(value);
    }
  }

  /**
   * Format condition for display
   */
  private formatCondition(condition: AlertCondition): string {
    switch (condition.type) {
      case 'price_below':
        return `Price below ${condition.value}`;

      case 'price_above':
        return `Price above ${condition.value}`;

      case 'price_drop_percent':
        return `Price dropped by ${condition.value}%`;

      case 'availability_is':
        return `Availability is ${condition.value}`;

      case 'text_changed':
        return 'Text changed';

      case 'number_changed':
        return 'Number changed';

      case 'number_below':
        return `Number below ${condition.value}`;

      case 'number_above':
        return `Number above ${condition.value}`;

      default:
        return `Unknown condition: ${condition.type}`;
    }
  }
}
