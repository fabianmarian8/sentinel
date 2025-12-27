/**
 * Email templates for Sentinel alerts
 */

import type { AlertData } from './types';

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

/**
 * Formats date in human-readable format
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

/**
 * Generates HTML email template for alert
 */
export function generateEmailHtml(alert: AlertData): string {
  const severityColors = {
    info: '#3B82F6',
    warning: '#F59E0B',
    critical: '#EF4444'
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${severityColors[alert.severity]}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .value-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .change { font-size: 24px; font-weight: bold; }
    .meta { color: #6b7280; font-size: 14px; }
    .button { display: inline-block; background: #3B82F6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge" style="background: rgba(255,255,255,0.2);">${alert.severity.toUpperCase()}</span>
      <h1 style="margin: 12px 0 0;">${escapeHtml(alert.title)}</h1>
    </div>
    <div class="content">
      <p><strong>Rule:</strong> ${escapeHtml(alert.ruleName)}</p>
      <p><strong>URL:</strong> <a href="${escapeHtml(alert.sourceUrl)}">${escapeHtml(alert.sourceUrl)}</a></p>

      <div class="value-box">
        <div class="change">${escapeHtml(alert.diffSummary || alert.body)}</div>
        <div class="meta">Changed at ${formatDate(alert.triggeredAt)}</div>
      </div>

      <a href="https://app.sentinel.dev/alerts/${alert.id}" class="button">View Alert</a>

      <p class="meta" style="margin-top: 24px;">
        This alert was triggered by Sentinel Change Intelligence Platform.<br>
        Alert ID: ${alert.id}
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generates plain text email template for alert
 */
export function generateEmailText(alert: AlertData): string {
  return `
${alert.severity.toUpperCase()}: ${alert.title}

Rule: ${alert.ruleName}
URL: ${alert.sourceUrl}
Change: ${alert.diffSummary || alert.body}
Time: ${formatDate(alert.triggeredAt)}

View alert: https://app.sentinel.dev/alerts/${alert.id}

---
Sentinel Change Intelligence Platform
Alert ID: ${alert.id}
  `.trim();
}
