/**
 * Webhook notification adapter for Sentinel alerts
 */

import { createHmac } from 'crypto';
import type { WebhookConfig, AlertData, SendResult, WebhookPayload } from './types';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Format alert data into webhook payload
 */
function formatWebhookPayload(alert: AlertData, secret?: string): WebhookPayload {
  const payload: WebhookPayload = {
    event: 'alert.triggered',
    timestamp: new Date().toISOString(),
    alert: {
      id: alert.id,
      ruleId: alert.ruleId,
      ruleName: alert.ruleName,
      sourceUrl: alert.sourceUrl,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      triggeredAt: alert.triggeredAt instanceof Date
        ? alert.triggeredAt.toISOString()
        : String(alert.triggeredAt),
      currentValue: alert.currentValue,
      previousValue: alert.previousValue,
      changeKind: alert.changeKind,
      diffSummary: alert.diffSummary,
    },
  };

  // Add signature if secret is provided
  if (secret) {
    const payloadString = JSON.stringify(payload);
    payload.signature = generateSignature(payloadString, secret);
  }

  return payload;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a webhook alert to a custom URL
 *
 * @param config - Webhook configuration (URL, headers, secret, etc.)
 * @param alert - Alert data to send
 * @returns Promise with send result
 */
export async function sendWebhookAlert(
  config: WebhookConfig,
  alert: AlertData,
): Promise<SendResult> {
  const maxRetries = config.retries ?? DEFAULT_RETRIES;
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const method = config.method ?? 'POST';

  const payload = formatWebhookPayload(alert, config.secret);
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Sentinel/1.0',
    ...config.headers,
  };

  // Add signature header if secret is configured
  if (config.secret && payload.signature) {
    headers['X-Sentinel-Signature'] = payload.signature;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(config.url, {
          method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check for success (2xx status codes)
        if (response.ok) {
          return {
            success: true,
            messageId: `webhook-${Date.now()}-${response.status}`,
          };
        }

        // Non-2xx response
        const errorText = await response.text().catch(() => 'No response body');
        lastError = new Error(`HTTP ${response.status}: ${errorText}`);

        // Don't retry on 4xx client errors (except 429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            success: false,
            error: `Webhook returned ${response.status}: ${errorText}`,
          };
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${timeout}ms`);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Wait before retry with exponential backoff
    if (attempt < maxRetries) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 30000);
      await sleep(backoffMs);
    }
  }

  return {
    success: false,
    error: lastError?.message ?? 'Unknown error after retries',
  };
}

/**
 * Verify a webhook signature
 * Use this on the receiving end to validate the payload
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = generateSignature(payload, secret);

  // Timing-safe comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Test a webhook configuration by sending a test payload
 */
export async function testWebhookConfig(
  config: WebhookConfig,
): Promise<{ valid: boolean; error?: string; responseTime?: number }> {
  const testAlert: AlertData = {
    id: 'test-' + Date.now(),
    ruleId: 'test-rule',
    ruleName: 'Test Rule',
    sourceUrl: 'https://example.com',
    severity: 'info',
    title: 'Webhook Test',
    body: 'This is a test message from Sentinel to verify your webhook configuration.',
    triggeredAt: new Date(),
    currentValue: 'test',
    previousValue: null,
    changeKind: 'test',
    diffSummary: 'Test webhook delivery',
  };

  const startTime = Date.now();
  const result = await sendWebhookAlert(
    { ...config, retries: 0 }, // No retries for test
    testAlert,
  );
  const responseTime = Date.now() - startTime;

  if (result.success) {
    return { valid: true, responseTime };
  }

  return { valid: false, error: result.error, responseTime };
}
