// Availability change detection

import type { NormalizedAvailability } from '@sentinel/shared';
import type { ChangeDetectionResult } from './types';

export function detectAvailabilityChange(
  prev: NormalizedAvailability | null | undefined,
  curr: NormalizedAvailability | null | undefined
): ChangeDetectionResult {
  // Handle null/undefined cases
  if (!prev || !curr) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Check if both status and leadTimeDays are unchanged
  if (prev.status === curr.status && prev.leadTimeDays === curr.leadTimeDays) {
    return {
      changed: false,
      changeKind: null,
      diffSummary: null,
    };
  }

  // Build diff summary
  let diffSummary = `${prev.status} → ${curr.status}`;

  // Add lead time info if it changed
  if (prev.leadTimeDays !== curr.leadTimeDays) {
    const prevLead = prev.leadTimeDays ?? 'N/A';
    const currLead = curr.leadTimeDays ?? 'N/A';
    diffSummary += ` (lead time: ${prevLead} → ${currLead} days)`;
  }

  return {
    changed: true,
    changeKind: 'status_change',
    diffSummary,
  };
}
