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
 * Queue names as constants
 */
export const QUEUE_NAMES = {
  RULES_RUN: 'rules-run',
  ALERTS_DISPATCH: 'alerts-dispatch',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];
