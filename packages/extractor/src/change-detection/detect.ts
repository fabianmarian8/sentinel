// Main change detection function

import type {
  NormalizedPrice,
  NormalizedAvailability,
  NormalizedText,
} from '@sentinel/shared';
import type { ChangeDetectionResult } from './types';
import { detectPriceChange } from './price';
import { detectAvailabilityChange } from './availability';
import { detectTextChange } from './text';
import { detectNumberChange } from './number';

export function detectChange(
  previousValue: any,
  currentValue: any,
  ruleType: 'price' | 'availability' | 'text' | 'number'
): ChangeDetectionResult {
  switch (ruleType) {
    case 'price':
      return detectPriceChange(
        previousValue as NormalizedPrice,
        currentValue as NormalizedPrice
      );

    case 'availability':
      return detectAvailabilityChange(
        previousValue as NormalizedAvailability,
        currentValue as NormalizedAvailability
      );

    case 'text':
      return detectTextChange(
        previousValue as NormalizedText,
        currentValue as NormalizedText
      );

    case 'number':
      return detectNumberChange(
        previousValue as number,
        currentValue as number
      );

    default:
      // Should never happen due to type safety, but handle gracefully
      return {
        changed: false,
        changeKind: null,
        diffSummary: null,
      };
  }
}
