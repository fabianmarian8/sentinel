/**
 * Slack notification adapter for Sentinel alerts
 */

import type { SlackConfig, AlertData, SendResult, SlackMessage, SlackAttachment } from './types';

/**
 * Map severity to Slack color
 */
function getSeverityColor(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return '#dc2626'; // red
    case 'warning':
      return '#f59e0b'; // amber
    case 'info':
    default:
      return '#3b82f6'; // blue
  }
}

/**
 * Map severity to emoji
 */
function getSeverityEmoji(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return ':rotating_light:';
    case 'warning':
      return ':warning:';
    case 'info':
    default:
      return ':information_source:';
  }
}

/**
 * Format alert data into Slack message
 */
function formatSlackMessage(config: SlackConfig, alert: AlertData): SlackMessage {
  const emoji = getSeverityEmoji(alert.severity);
  const color = getSeverityColor(alert.severity);

  const fields: Array<{ title: string; value: string; short?: boolean }> = [];

  // Add current and previous values if available
  if (alert.currentValue !== null && alert.currentValue !== undefined) {
    fields.push({
      title: 'Current Value',
      value: String(alert.currentValue),
      short: true,
    });
  }

  if (alert.previousValue !== null && alert.previousValue !== undefined) {
    fields.push({
      title: 'Previous Value',
      value: String(alert.previousValue),
      short: true,
    });
  }

  // Add change kind if available
  if (alert.changeKind) {
    fields.push({
      title: 'Change Type',
      value: alert.changeKind,
      short: true,
    });
  }

  // Add rule info
  fields.push({
    title: 'Rule',
    value: alert.ruleName,
    short: true,
  });

  const attachment: SlackAttachment = {
    color,
    title: alert.title,
    title_link: alert.sourceUrl,
    text: alert.body || alert.diffSummary || 'Value has changed',
    fields,
    footer: 'Sentinel Monitoring',
    ts: Math.floor(new Date(alert.triggeredAt).getTime() / 1000),
  };

  return {
    channel: config.channel,
    username: config.username || 'Sentinel',
    icon_emoji: config.iconEmoji || ':eyes:',
    text: `${emoji} *[${alert.severity.toUpperCase()}]* Alert for <${alert.sourceUrl}|${alert.ruleName}>`,
    attachments: [attachment],
  };
}

/**
 * Sends a Slack alert using webhook
 *
 * @param config - Slack configuration (webhook URL, channel, etc.)
 * @param alert - Alert data to send
 * @returns Promise with send result
 */
export async function sendSlackAlert(
  config: SlackConfig,
  alert: AlertData,
): Promise<SendResult> {
  try {
    const message = formatSlackMessage(config, alert);

    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `Slack API error: ${response.status} - ${errorText}`,
      };
    }

    const responseText = await response.text();

    // Slack webhook returns "ok" on success
    if (responseText === 'ok') {
      return {
        success: true,
        messageId: `slack-${Date.now()}`,
      };
    }

    return {
      success: false,
      error: `Unexpected Slack response: ${responseText}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
