/**
 * Anti-flap state machine types
 *
 * Prevents false alerts by requiring N consecutive observations
 * of a new value before confirming a change.
 */

/**
 * Persistent state for a monitoring rule
 * Stored in database (rule_state table)
 */
export interface RuleState {
  /** Unique rule identifier */
  ruleId: string;

  /** Last confirmed stable value (jsonb in database) */
  lastStable: any;

  /** Current candidate value that is being observed */
  candidate: any | null;

  /** Number of consecutive times the candidate has been observed */
  candidateCount: number;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Result of anti-flap processing
 */
export interface AntiFlipResult {
  /** Whether a change has been confirmed */
  confirmedChange: boolean;

  /** Previous stable value (only set when confirmedChange=true) */
  previousStable: any | null;

  /** New stable value (only set when confirmedChange=true or first observation) */
  newStable: any | null;

  /** Current candidate value (set when change not yet confirmed) */
  candidateValue: any | null;

  /** Current candidate count (set when change not yet confirmed) */
  candidateCount: number;
}
