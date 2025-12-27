/**
 * Telegram notification types for Sentinel alerts
 */

import type { AlertData, SendResult } from '../email/types';

export { AlertData, SendResult };

export interface TelegramConfig {
  /** Telegram Bot API token */
  botToken: string;
  /** Chat ID (can be user, group, or channel) */
  chatId: string;
  /** Parse mode for message formatting */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  /** Disable link previews */
  disableWebPagePreview?: boolean;
  /** Disable notification sound */
  disableNotification?: boolean;
}

export interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode?: string;
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
}

export interface TelegramApiResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: { id: number };
    date: number;
    text?: string;
  };
  description?: string;
  error_code?: number;
}
