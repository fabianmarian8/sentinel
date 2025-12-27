// Text change detection

import type { NormalizedText } from '@sentinel/shared';
import type { ChangeDetectionResult } from './types';

export function detectTextChange(
  prev: NormalizedText | null | undefined,
  curr: NormalizedText | null | undefined
): ChangeDetectionResult {
  // Handle null/undefined cases
  if (!prev || !curr) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Compare hashes for quick equality check
  if (prev.hash === curr.hash) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Calculate simple diff metrics
  const lengthDiff = curr.snippet.length - prev.snippet.length;
  const sign = lengthDiff > 0 ? '+' : (lengthDiff === 0 ? '' : '');

  return {
    changed: true,
    changeKind: 'text_diff',
    diffSummary: `Content changed (${sign}${lengthDiff} chars)`,
  };
}
