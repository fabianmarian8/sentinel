/**
 * Anti-flap state machine
 *
 * Prevents false alerts by requiring N consecutive observations
 * of a new value before confirming a change.
 *
 * Algorithm:
 * 1. First observation → set as stable, no change confirmed
 * 2. Same as stable → reset candidate
 * 3. Same as candidate → increment count
 * 4. Count reaches threshold → confirm change, promote to stable
 * 5. Different value → new candidate, reset count to 1
 */

import { equals } from './equals';
import { RuleState, AntiFlipResult } from './types';

/**
 * Process a new value through the anti-flap state machine
 *
 * @param currentValue The newly observed value
 * @param state Current rule state (null if first observation)
 * @param requireConsecutive Number of consecutive observations required to confirm change
 * @returns Result indicating if change confirmed, plus new state to persist
 */
export function processAntiFlap(
  currentValue: any,
  state: RuleState | null,
  requireConsecutive: number
): {
  result: AntiFlipResult;
  newState: Partial<RuleState>;
} {
  // First observation ever
  if (!state || state.lastStable === null) {
    return {
      result: {
        confirmedChange: false,
        previousStable: null,
        newStable: currentValue,
        candidateValue: null,
        candidateCount: 0,
      },
      newState: {
        lastStable: currentValue,
        candidate: null,
        candidateCount: 0,
      },
    };
  }

  // Value matches current stable - no change
  if (equals(currentValue, state.lastStable)) {
    return {
      result: {
        confirmedChange: false,
        previousStable: null,
        newStable: null,
        candidateValue: null,
        candidateCount: 0,
      },
      newState: {
        candidate: null,
        candidateCount: 0,
      },
    };
  }

  // Value matches candidate - increment count
  if (state.candidate && equals(currentValue, state.candidate)) {
    const newCount = state.candidateCount + 1;

    // Threshold reached - confirm change!
    if (newCount >= requireConsecutive) {
      return {
        result: {
          confirmedChange: true,
          previousStable: state.lastStable,
          newStable: currentValue,
          candidateValue: null,
          candidateCount: 0,
        },
        newState: {
          lastStable: currentValue,
          candidate: null,
          candidateCount: 0,
        },
      };
    }

    // Not yet confirmed
    return {
      result: {
        confirmedChange: false,
        previousStable: null,
        newStable: null,
        candidateValue: currentValue,
        candidateCount: newCount,
      },
      newState: {
        candidateCount: newCount,
      },
    };
  }

  // New candidate value
  // If requireConsecutive is 1 or 0, confirm immediately
  if (requireConsecutive <= 1) {
    return {
      result: {
        confirmedChange: true,
        previousStable: state.lastStable,
        newStable: currentValue,
        candidateValue: null,
        candidateCount: 0,
      },
      newState: {
        lastStable: currentValue,
        candidate: null,
        candidateCount: 0,
      },
    };
  }

  // Otherwise, set as candidate
  return {
    result: {
      confirmedChange: false,
      previousStable: null,
      newStable: null,
      candidateValue: currentValue,
      candidateCount: 1,
    },
    newState: {
      candidate: currentValue,
      candidateCount: 1,
    },
  };
}
