// Local types for change detection module

import type { ChangeKind } from '@sentinel/shared';

export interface ChangeDetectionResult {
  changed: boolean;
  changeKind: ChangeKind | null;
  diffSummary: string | null;
  percentChange?: number; // for price changes and number changes
}
