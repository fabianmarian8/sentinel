// Price change detection

import type { NormalizedPrice } from '@sentinel/shared';
import type { ChangeDetectionResult } from './types';

export function detectPriceChange(
  prev: NormalizedPrice | null | undefined,
  curr: NormalizedPrice | null | undefined
): ChangeDetectionResult {
  // Handle null/undefined cases
  if (!prev || !curr) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // No change if values are equal
  if (prev.value === curr.value) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Calculate percentage change
  const percentChange = prev.value !== 0
    ? ((curr.value - prev.value) / prev.value) * 100
    : 100;

  const changeKind = curr.value > prev.value ? 'increased' : 'decreased';
  const sign = percentChange > 0 ? '+' : '';

  return {
    changed: true,
    changeKind,
    diffSummary: `${prev.value} → ${curr.value} ${curr.currency} (${sign}${percentChange.toFixed(1)}%)`,
    percentChange,
  };
}
