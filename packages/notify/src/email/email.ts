/**
 * Email notification adapter for Sentinel alerts
 */

import nodemailer from 'nodemailer';
import type { EmailConfig, AlertData, SmtpConfig, SendResult } from './types';
import { generateEmailHtml, generateEmailText } from './templates';

/**
 * Sends an email alert using SMTP
 *
 * @param config - Email configuration (recipients, sender)
 * @param alert - Alert data to send
 * @param smtpConfig - SMTP server configuration
 * @returns Promise with send result
 */
export async function sendEmailAlert(
  config: EmailConfig,
  alert: AlertData,
  smtpConfig: SmtpConfig
): Promise<SendResult> {
  try {
    // Create SMTP transporter
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    // Send email with both HTML and plain text versions
    const result = await transporter.sendMail({
      from: config.from || smtpConfig.from,
      to: config.to.join(', '),
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      text: generateEmailText(alert),
      html: generateEmailHtml(alert)
    });

    return {
      success: true,
      messageId: result.messageId
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage
    };
  }
}
