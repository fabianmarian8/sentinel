import type { RuleType, ChangeKind } from '@sentinel/shared';

/**
 * Result of change detection
 */
export interface ChangeDetectionResult {
  changeKind: ChangeKind | null;
  diffSummary: string | null;
}

/**
 * Detect the kind of change between old and new values
 *
 * @param oldValue Previous stable value
 * @param newValue New observed value
 * @param ruleType Type of rule being monitored
 * @returns Change kind and human-readable diff summary
 */
export function detectChange(
  oldValue: any,
  newValue: any,
  ruleType: RuleType
): ChangeDetectionResult {
  // First observation - no previous value to compare
  if (oldValue === null || oldValue === undefined) {
    return {
      changeKind: 'new_value' as ChangeKind,
      diffSummary: `Initial value: ${formatValue(newValue, ruleType)}`,
    };
  }

  // Value disappeared (extraction failed after success)
  if (newValue === null || newValue === undefined) {
    return {
      changeKind: 'value_disappeared' as ChangeKind,
      diffSummary: `Value disappeared. Previous: ${formatValue(oldValue, ruleType)}`,
    };
  }

  switch (ruleType) {
    case 'price':
      return detectPriceChange(oldValue, newValue);

    case 'availability':
      return detectAvailabilityChange(oldValue, newValue);

    case 'number':
      return detectNumberChange(oldValue, newValue);

    case 'text':
      return detectTextChange(oldValue, newValue);

    case 'json_field':
      return detectJsonChange(oldValue, newValue);

    default:
      return {
        changeKind: 'value_changed' as ChangeKind,
        diffSummary: `Changed from ${formatValue(oldValue, ruleType)} to ${formatValue(newValue, ruleType)}`,
      };
  }
}

/**
 * Detect price changes
 */
function detectPriceChange(oldValue: any, newValue: any): ChangeDetectionResult {
  const oldPrice = oldValue?.value ?? oldValue;
  const newPrice = newValue?.value ?? newValue;
  const currency = newValue?.currency ?? '';

  if (typeof oldPrice !== 'number' || typeof newPrice !== 'number') {
    return {
      changeKind: 'format_changed' as ChangeKind,
      diffSummary: 'Price format changed',
    };
  }

  const diff = newPrice - oldPrice;
  const percentChange = ((diff / oldPrice) * 100).toFixed(1);

  if (diff > 0) {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Price increased: ${oldPrice} ${currency} → ${newPrice} ${currency} (+${percentChange}%)`,
    };
  } else {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Price decreased: ${oldPrice} ${currency} → ${newPrice} ${currency} (${percentChange}%)`,
    };
  }
}

/**
 * Detect availability changes
 */
function detectAvailabilityChange(oldValue: any, newValue: any): ChangeDetectionResult {
  const oldStatus = oldValue?.status ?? oldValue;
  const newStatus = newValue?.status ?? newValue;

  const oldLeadTime = oldValue?.leadTimeDays;
  const newLeadTime = newValue?.leadTimeDays;

  // Status changed
  if (oldStatus !== newStatus) {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Availability changed: ${oldStatus} → ${newStatus}`,
    };
  }

  // Lead time changed
  if (oldLeadTime !== newLeadTime) {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Lead time changed: ${oldLeadTime ?? 'none'} → ${newLeadTime ?? 'none'} days`,
    };
  }

  return {
    changeKind: null,
    diffSummary: null,
  };
}

/**
 * Detect number changes
 */
function detectNumberChange(oldValue: any, newValue: any): ChangeDetectionResult {
  const oldNum = typeof oldValue === 'number' ? oldValue : parseFloat(oldValue);
  const newNum = typeof newValue === 'number' ? newValue : parseFloat(newValue);

  if (isNaN(oldNum) || isNaN(newNum)) {
    return {
      changeKind: 'format_changed' as ChangeKind,
      diffSummary: 'Number format changed',
    };
  }

  const diff = newNum - oldNum;
  const percentChange = oldNum !== 0 ? ((diff / oldNum) * 100).toFixed(1) : 'N/A';

  if (diff > 0) {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Number increased: ${oldNum} → ${newNum} (+${percentChange}%)`,
    };
  } else if (diff < 0) {
    return {
      changeKind: 'value_changed' as ChangeKind,
      diffSummary: `Number decreased: ${oldNum} → ${newNum} (${percentChange}%)`,
    };
  }

  return {
    changeKind: null,
    diffSummary: null,
  };
}

/**
 * Detect text changes
 */
function detectTextChange(oldValue: any, newValue: any): ChangeDetectionResult {
  const oldText = oldValue?.snippet ?? oldValue;
  const newText = newValue?.snippet ?? newValue;

  if (typeof oldText !== 'string' || typeof newText !== 'string') {
    return {
      changeKind: 'format_changed' as ChangeKind,
      diffSummary: 'Text format changed',
    };
  }

  // Simple word count diff
  const oldWords = oldText.trim().split(/\s+/).length;
  const newWords = newText.trim().split(/\s+/).length;

  const preview = newText.length > 50 ? `${newText.slice(0, 50)}...` : newText;

  return {
    changeKind: 'value_changed' as ChangeKind,
    diffSummary: `Text changed (${oldWords} → ${newWords} words): "${preview}"`,
  };
}

/**
 * Detect JSON field changes
 */
function detectJsonChange(oldValue: any, newValue: any): ChangeDetectionResult {
  const oldStr = JSON.stringify(oldValue);
  const newStr = JSON.stringify(newValue);

  return {
    changeKind: 'value_changed' as ChangeKind,
    diffSummary: `JSON changed: ${oldStr.slice(0, 100)} → ${newStr.slice(0, 100)}`,
  };
}

/**
 * Format value for display
 */
function formatValue(value: any, ruleType: RuleType): string {
  if (value === null || value === undefined) return 'null';

  switch (ruleType) {
    case 'price':
      return `${value?.value ?? value} ${value?.currency ?? ''}`;
    case 'availability':
      return value?.status ?? value;
    case 'text':
      return `"${value?.snippet ?? value}"`;
    default:
      return String(value);
  }
}
