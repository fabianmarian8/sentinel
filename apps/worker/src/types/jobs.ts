/**
 * Job payload types for BullMQ queues
 */

/**
 * Payload for rules:run queue
 * Triggers rule execution: fetch + extract + persist
 */
export interface RunJobPayload {
  /** Unique rule identifier */
  ruleId: string;

  /** What triggered this job execution */
  trigger: 'schedule' | 'manual_test' | 'retry';

  /** ISO 8601 timestamp when job was requested */
  requestedAt: string;

  /** Force specific execution mode (overrides rule settings) */
  forceMode?: 'http' | 'headless' | 'flaresolverr' | null;

  /** Enable debug logging for this job */
  debug?: boolean;

  /**
   * Rate limit retry tracking - number of times this job was deferred due to rate limiting.
   * Used to limit retries and prevent infinite loops.
   * Max 2 retries allowed (60-180s delay each).
   */
  rateLimitRetryCount?: number;

  /**
   * Timeout retry tracking - number of times this job was retried due to timeout.
   * Used to implement 1x timeout retry with backoff.
   */
  timeoutRetryCount?: number;
}

/**
 * Payload for alerts:dispatch queue
 * Handles notification delivery across channels
 */
export interface AlertDispatchPayload {
  /** Unique alert identifier */
  alertId: string;

  /** Workspace context for this alert */
  workspaceId: string;

  /** Associated rule that triggered the alert */
  ruleId: string;

  /** Notification channels to dispatch to (e.g., ['slack', 'email']) */
  channels: string[];

  /** Deduplication key to prevent duplicate alerts */
  dedupeKey: string;
}

/**
 * Payload for maintenance jobs (cleanup, retention, etc.)
 */
export interface MaintenanceJobPayload {
  /** Type of maintenance task */
  task: 'rawsample-cleanup' | 'fetch-attempts-cleanup';

  /** Optional configuration overrides */
  config?: {
    retentionDays?: number;
  };
}

/**
 * Queue names as constants
 */
export const QUEUE_NAMES = {
  RULES_RUN: 'rules-run',
  ALERTS_DISPATCH: 'alerts-dispatch',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
