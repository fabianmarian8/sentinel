/**
 * Webhook notification types for Sentinel alerts
 */

import type { AlertData, SendResult } from '../email/types';

export { AlertData, SendResult };

export interface WebhookConfig {
  /** Webhook URL to POST to */
  url: string;
  /** HTTP method (default: POST) */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Custom headers to send */
  headers?: Record<string, string>;
  /** Secret for HMAC signature (optional, for verification) */
  secret?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Retry count on failure (default: 3) */
  retries?: number;
}

export interface WebhookPayload {
  /** Event type */
  event: 'alert.triggered';
  /** Timestamp ISO string */
  timestamp: string;
  /** Alert data */
  alert: {
    id: string;
    ruleId: string;
    ruleName: string;
    sourceUrl: string;
    severity: string;
    title: string;
    body: string;
    triggeredAt: string;
    currentValue: any;
    previousValue: any;
    changeKind: string;
    diffSummary: string;
  };
  /** HMAC signature if secret is configured */
  signature?: string;
}
