// Text change detection with real diff

import * as Diff from 'diff';
import type { NormalizedText } from '@sentinel/shared';
import type { ChangeDetectionResult } from './types';

/**
 * Detect changes between two text values using word-level diff
 */
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

  // Calculate word-level diff
  const diffResult = Diff.diffWords(prev.snippet, curr.snippet);

  // Count added/removed words
  let addedWords = 0;
  let removedWords = 0;
  const addedParts: string[] = [];
  const removedParts: string[] = [];

  for (const part of diffResult) {
    const wordCount = part.value.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (part.added) {
      addedWords += wordCount;
      if (addedParts.length < 3) {
        addedParts.push(truncate(part.value.trim(), 30));
      }
    } else if (part.removed) {
      removedWords += wordCount;
      if (removedParts.length < 3) {
        removedParts.push(truncate(part.value.trim(), 30));
      }
    }
  }

  // Build human-readable diff summary
  const diffSummary = buildDiffSummary(addedWords, removedWords, addedParts, removedParts);

  return {
    changed: true,
    changeKind: 'text_diff',
    diffSummary,
    // Include detailed diff for API consumers
    diffDetails: {
      addedWords,
      removedWords,
      addedParts: addedParts.slice(0, 3),
      removedParts: removedParts.slice(0, 3),
    },
  };
}

/**
 * Build a human-readable diff summary
 */
function buildDiffSummary(
  addedWords: number,
  removedWords: number,
  addedParts: string[],
  removedParts: string[]
): string {
  const parts: string[] = [];

  // If only small changes, show the actual text
  if (addedWords <= 3 && removedWords <= 3) {
    if (removedParts.length > 0 && addedParts.length > 0) {
      // Replacement: "X" → "Y"
      return `"${removedParts[0]}" → "${addedParts[0]}"`;
    } else if (addedParts.length > 0) {
      // Addition
      return `Added: "${addedParts[0]}"`;
    } else if (removedParts.length > 0) {
      // Removal
      return `Removed: "${removedParts[0]}"`;
    }
  }

  // For larger changes, show word counts
  if (removedWords > 0) {
    parts.push(`-${removedWords} words`);
  }
  if (addedWords > 0) {
    parts.push(`+${addedWords} words`);
  }

  // Add example of change if available
  if (addedParts.length > 0) {
    parts.push(`(e.g. "${addedParts[0]}")`);
  } else if (removedParts.length > 0) {
    parts.push(`(removed "${removedParts[0]}")`);
  }

  return parts.join(' ');
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
