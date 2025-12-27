/**
 * Telegram notification adapter for Sentinel alerts
 */

import type { TelegramConfig, AlertData, SendResult, TelegramMessage, TelegramApiResponse } from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Map severity to emoji
 */
function getSeverityEmoji(severity: 'info' | 'warning' | 'critical'): string {
  switch (severity) {
    case 'critical':
      return '\u{1F6A8}'; // rotating light
    case 'warning':
      return '\u{26A0}\u{FE0F}'; // warning
    case 'info':
    default:
      return '\u{2139}\u{FE0F}'; // info
  }
}

/**
 * Escape HTML special characters for Telegram HTML mode
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Format alert data into Telegram message (HTML format)
 */
function formatTelegramMessage(alert: AlertData): string {
  const emoji = getSeverityEmoji(alert.severity);
  const lines: string[] = [];

  // Header with severity and emoji
  lines.push(`${emoji} <b>[${alert.severity.toUpperCase()}] ${escapeHtml(alert.title)}</b>`);
  lines.push('');

  // Rule and source info
  lines.push(`<b>Rule:</b> ${escapeHtml(alert.ruleName)}`);
  lines.push(`<b>URL:</b> <a href="${alert.sourceUrl}">${escapeHtml(alert.sourceUrl)}</a>`);
  lines.push('');

  // Value changes
  if (alert.currentValue !== null && alert.currentValue !== undefined) {
    lines.push(`<b>Current:</b> <code>${escapeHtml(String(alert.currentValue))}</code>`);
  }

  if (alert.previousValue !== null && alert.previousValue !== undefined) {
    lines.push(`<b>Previous:</b> <code>${escapeHtml(String(alert.previousValue))}</code>`);
  }

  if (alert.changeKind) {
    lines.push(`<b>Change:</b> ${escapeHtml(alert.changeKind)}`);
  }

  // Body or diff summary
  if (alert.body) {
    lines.push('');
    lines.push(escapeHtml(alert.body));
  } else if (alert.diffSummary) {
    lines.push('');
    lines.push(`<i>${escapeHtml(alert.diffSummary)}</i>`);
  }

  // Timestamp
  lines.push('');
  const timestamp = new Date(alert.triggeredAt).toLocaleString('sk-SK', {
    timeZone: 'Europe/Bratislava',
  });
  lines.push(`<i>Triggered: ${timestamp}</i>`);

  return lines.join('\n');
}

/**
 * Sends a Telegram alert using Bot API
 *
 * @param config - Telegram configuration (bot token, chat ID, etc.)
 * @param alert - Alert data to send
 * @returns Promise with send result
 */
export async function sendTelegramAlert(
  config: TelegramConfig,
  alert: AlertData,
): Promise<SendResult> {
  try {
    const messageText = formatTelegramMessage(alert);

    const message: TelegramMessage = {
      chat_id: config.chatId,
      text: messageText,
      parse_mode: config.parseMode || 'HTML',
      disable_web_page_preview: config.disableWebPagePreview ?? true,
      disable_notification: config.disableNotification ?? false,
    };

    const url = `${TELEGRAM_API_BASE}${config.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json() as TelegramApiResponse;

    if (!data.ok) {
      return {
        success: false,
        error: `Telegram API error: ${data.error_code} - ${data.description}`,
      };
    }

    return {
      success: true,
      messageId: data.result?.message_id?.toString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Validate Telegram bot token and chat ID by sending a test message
 */
export async function validateTelegramConfig(
  config: TelegramConfig,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Try to get bot info to validate the token
    const url = `${TELEGRAM_API_BASE}${config.botToken}/getMe`;
    const response = await fetch(url);
    const data = await response.json() as { ok: boolean; description?: string };

    if (!data.ok) {
      return {
        valid: false,
        error: `Invalid bot token: ${data.description}`,
      };
    }

    // Try to get chat info to validate the chat_id
    const chatUrl = `${TELEGRAM_API_BASE}${config.botToken}/getChat?chat_id=${config.chatId}`;
    const chatResponse = await fetch(chatUrl);
    const chatData = await chatResponse.json() as { ok: boolean; description?: string };

    if (!chatData.ok) {
      return {
        valid: false,
        error: `Invalid chat ID: ${chatData.description}`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
