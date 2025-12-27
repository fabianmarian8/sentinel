// Number change detection

import type { ChangeDetectionResult } from './types';

export function detectNumberChange(
  prev: number | null | undefined,
  curr: number | null | undefined
): ChangeDetectionResult {
  // Handle null/undefined cases
  if (prev == null || curr == null) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // No change if values are equal
  if (prev === curr) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Calculate percentage change
  const percentChange = prev !== 0 ? ((curr - prev) / prev) * 100 : 100;
  const changeKind = curr > prev ? 'increased' : 'decreased';

  return {
    changed: true,
    changeKind,
    diffSummary: `${prev} → ${curr}`,
    percentChange,
  };
}
