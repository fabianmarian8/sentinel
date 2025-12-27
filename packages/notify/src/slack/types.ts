/**
 * Slack notification types for Sentinel alerts
 */

import type { AlertData, SendResult } from '../email/types';

export { AlertData, SendResult };

export interface SlackConfig {
  /** Slack webhook URL */
  webhookUrl: string;
  /** Optional channel override (if webhook is for a different channel) */
  channel?: string;
  /** Optional bot username */
  username?: string;
  /** Optional bot icon emoji (e.g., ":eyes:") */
  iconEmoji?: string;
}

export interface SlackAttachment {
  color: string;
  title: string;
  title_link?: string;
  text: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
  footer?: string;
  ts?: number;
}

export interface SlackMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text: string;
  attachments?: SlackAttachment[];
}
