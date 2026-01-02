/**
 * Similarity Calculation for Element Fingerprints
 *
 * Calculates how similar two elements are based on their fingerprints.
 * Used for finding replacement elements when selectors break.
 */

import { ElementFingerprint } from './types';
import { normalizeText, isUnstableClassName } from './fingerprint';

/**
 * Weights for different fingerprint components
 * Higher weight = more important for matching
 */
const WEIGHTS = {
  tagName: 0.20, // Must match - this is binary (match = full weight, no match = 0)
  id: 0.15, // ID is very reliable when present
  classNames: 0.15, // Class similarity (Jaccard)
  textContent: 0.15, // Text content similarity
  parentStructure: 0.10, // Parent tag, classes, id
  attributes: 0.10, // Data attributes match
  position: 0.10, // Sibling index and depth proximity
  grandparent: 0.05, // Grandparent tag match
};

/**
 * Calculate similarity between two element fingerprints
 *
 * @returns Score between 0 and 1 (1 = identical)
 */
export function calculateSimilarity(
  stored: ElementFingerprint,
  candidate: ElementFingerprint
): number {
  let score = 0;

  // Tag name MUST match (binary - no partial credit)
  if (stored.tagName !== candidate.tagName) {
    return 0;
  }
  score += WEIGHTS.tagName;

  // ID match (binary when present)
  if (stored.id && candidate.id) {
    if (stored.id === candidate.id) {
      score += WEIGHTS.id;
    }
    // If IDs don't match but both have IDs, that's a strong negative signal
    // Don't add points, but also penalize slightly
  } else if (stored.id && !candidate.id) {
    // Stored has ID but candidate doesn't - minor penalty
    score -= WEIGHTS.id * 0.3;
  }
  // If stored doesn't have ID, we don't penalize

  // Class similarity (Jaccard coefficient)
  const classScore = calculateJaccardSimilarity(
    filterStableClasses(stored.classNames),
    filterStableClasses(candidate.classNames)
  );
  score += classScore * WEIGHTS.classNames;

  // Text content similarity
  const textScore = calculateTextSimilarity(
    stored.textContent,
    candidate.textContent
  );
  score += textScore * WEIGHTS.textContent;

  // Parent structure similarity
  const parentScore = calculateParentSimilarity(stored, candidate);
  score += parentScore * WEIGHTS.parentStructure;

  // Attribute similarity
  const attrScore = calculateAttributeSimilarity(
    stored.attributes,
    candidate.attributes
  );
  score += attrScore * WEIGHTS.attributes;

  // Position similarity (penalize large differences)
  const positionScore = calculatePositionSimilarity(stored, candidate);
  score += positionScore * WEIGHTS.position;

  // Grandparent tag match
  if (stored.grandparentTag && candidate.grandparentTag) {
    if (stored.grandparentTag === candidate.grandparentTag) {
      score += WEIGHTS.grandparent;
    }
  }

  // Ensure score is between 0 and 1
  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate Jaccard similarity between two sets
 * Jaccard = intersection / union
 */
export function calculateJaccardSimilarity(
  set1: string[],
  set2: string[]
): number {
  if (set1.length === 0 && set2.length === 0) return 1; // Both empty = match
  if (set1.length === 0 || set2.length === 0) return 0;

  const s1 = new Set(set1);
  const s2 = new Set(set2);

  const intersection = new Set([...s1].filter((x) => s2.has(x)));
  const union = new Set([...s1, ...s2]);

  return intersection.size / union.size;
}

/**
 * Calculate text similarity using normalized Levenshtein distance
 */
export function calculateTextSimilarity(text1: string, text2: string): number {
  const normalized1 = normalizeText(text1);
  const normalized2 = normalizeText(text2);

  if (normalized1 === normalized2) return 1;
  if (!normalized1 || !normalized2) return 0;

  // For very different lengths, quick reject
  const lengthRatio = Math.min(normalized1.length, normalized2.length) /
    Math.max(normalized1.length, normalized2.length);
  if (lengthRatio < 0.3) return lengthRatio * 0.5;

  // Use prefix/suffix matching for efficiency on long strings
  const maxLen = Math.max(normalized1.length, normalized2.length);
  if (maxLen > 100) {
    // For long strings, compare prefixes and suffixes
    const prefix1 = normalized1.slice(0, 50);
    const prefix2 = normalized2.slice(0, 50);
    const suffix1 = normalized1.slice(-30);
    const suffix2 = normalized2.slice(-30);

    const prefixSim = simpleStringSimilarity(prefix1, prefix2);
    const suffixSim = simpleStringSimilarity(suffix1, suffix2);

    return (prefixSim * 0.7 + suffixSim * 0.3) * lengthRatio;
  }

  // For shorter strings, use character-level similarity
  return simpleStringSimilarity(normalized1, normalized2);
}

/**
 * Simple string similarity using common character ratio
 */
function simpleStringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;

  // Count common characters
  const chars1 = new Map<string, number>();
  for (const c of s1) {
    chars1.set(c, (chars1.get(c) || 0) + 1);
  }

  let common = 0;
  for (const c of s2) {
    const count = chars1.get(c) || 0;
    if (count > 0) {
      common++;
      chars1.set(c, count - 1);
    }
  }

  return (2 * common) / (s1.length + s2.length);
}

/**
 * Calculate parent structure similarity
 */
function calculateParentSimilarity(
  stored: ElementFingerprint,
  candidate: ElementFingerprint
): number {
  let score = 0;
  let maxScore = 0;

  // Parent tag match
  maxScore += 0.4;
  if (stored.parentTag === candidate.parentTag) {
    score += 0.4;
  }

  // Parent ID match
  if (stored.parentId && candidate.parentId) {
    maxScore += 0.3;
    if (stored.parentId === candidate.parentId) {
      score += 0.3;
    }
  }

  // Parent classes similarity
  maxScore += 0.3;
  const parentClassSim = calculateJaccardSimilarity(
    filterStableClasses(stored.parentClasses),
    filterStableClasses(candidate.parentClasses)
  );
  score += parentClassSim * 0.3;

  return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Calculate attribute similarity
 */
function calculateAttributeSimilarity(
  stored: Record<string, string>,
  candidate: Record<string, string>
): number {
  const storedKeys = Object.keys(stored).filter((k) => k !== 'class' && k !== 'id');
  const candidateKeys = Object.keys(candidate).filter((k) => k !== 'class' && k !== 'id');

  if (storedKeys.length === 0 && candidateKeys.length === 0) return 1;
  if (storedKeys.length === 0 || candidateKeys.length === 0) return 0.5;

  let matches = 0;
  let total = storedKeys.length;

  for (const key of storedKeys) {
    if (candidate[key] === stored[key]) {
      matches++;
    }
  }

  return matches / total;
}

/**
 * Calculate position similarity
 * Penalizes large differences in sibling index and depth
 */
function calculatePositionSimilarity(
  stored: ElementFingerprint,
  candidate: ElementFingerprint
): number {
  // Sibling index difference (allow some variance)
  const siblingDiff = Math.abs(stored.siblingIndex - candidate.siblingIndex);
  const siblingScore = Math.max(0, 1 - siblingDiff * 0.2); // 20% penalty per position

  // Depth difference (allow some variance)
  const depthDiff = Math.abs(stored.depth - candidate.depth);
  const depthScore = Math.max(0, 1 - depthDiff * 0.15); // 15% penalty per level

  return (siblingScore * 0.6 + depthScore * 0.4);
}

/**
 * Filter out unstable class names
 */
function filterStableClasses(classes: string[]): string[] {
  return classes.filter((c) => !isUnstableClassName(c));
}

/**
 * Find best matching element from candidates
 *
 * @returns Best match with score, or null if no match above threshold
 */
export function findBestMatch(
  stored: ElementFingerprint,
  candidates: ElementFingerprint[],
  threshold: number = 0.6
): { fingerprint: ElementFingerprint; score: number; index: number } | null {
  let bestMatch: { fingerprint: ElementFingerprint; score: number; index: number } | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    const score = calculateSimilarity(stored, candidate);

    if (score >= threshold && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { fingerprint: candidate, score, index: i };
    }
  }

  return bestMatch;
}
