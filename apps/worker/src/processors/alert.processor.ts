import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createDecipheriv } from 'crypto';
import { AlertDispatchPayload, QUEUE_NAMES } from '../types/jobs';
import { PrismaService } from '../prisma/prisma.service';
import {
  sendEmailAlert,
  sendSlackAlert,
  sendTelegramAlert,
  sendWebhookAlert,
} from '@sentinel/notify';
import type {
  SmtpConfig,
  AlertData,
  SlackConfig,
  TelegramConfig,
  WebhookConfig,
} from '@sentinel/notify';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'sentinel-default-encryption-key-32';
const ALGORITHM = 'aes-256-gcm';

/**
 * Processor for alerts:dispatch queue
 *
 * Handles notification delivery across multiple channels
 *
 * Implementation: M2-005 (notification dispatch logic)
 */
@Processor(QUEUE_NAMES.ALERTS_DISPATCH, {
  concurrency: 10, // Will be overridden by config in module
})
export class AlertProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  /**
   * Decrypt channel configuration
   */
  private decrypt(encryptedText: string): string {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    const [ivHex, authTagHex, encrypted] = parts as [string, string, string];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted: string = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  async process(job: Job<AlertDispatchPayload>): Promise<void> {
    const { alertId, workspaceId, ruleId, channels, dedupeKey } = job.data;

    this.logger.log(
      `[Job ${job.id}] Dispatching alert ${alertId} to channels: ${channels.join(', ')}`,
    );

    // Step 1: Fetch alert with rule and source info
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: {
        rule: {
          include: {
            source: {
              include: {
                workspace: true,
              },
            },
          },
        },
      },
    });

    if (!alert) {
      this.logger.error(`[Job ${job.id}] Alert ${alertId} not found`);
      return;
    }

    // Step 2: Send to each channel
    const results: Array<{ channelId: string; success: boolean; error?: string }> = [];

    for (const channelId of channels) {
      try {
        const result = await this.sendToChannel(channelId, alert, workspaceId);
        results.push({
          channelId,
          success: result.success,
          error: result.error,
        });

        if (result.success) {
          this.logger.log(
            `[Job ${job.id}] Alert sent successfully to channel ${channelId}`,
          );
        } else {
          this.logger.error(
            `[Job ${job.id}] Failed to send alert to channel ${channelId}: ${result.error}`,
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        results.push({
          channelId,
          success: false,
          error: errorMessage,
        });
        this.logger.error(
          `[Job ${job.id}] Exception sending to channel ${channelId}: ${errorMessage}`,
        );
      }
    }

    // Step 3: Update alert with delivery status
    await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        channelsSent: results as any,
      },
    });

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(
      `[Job ${job.id}] Alert dispatch completed: ${successCount}/${results.length} channels successful`,
    );
  }

  /**
   * Send alert to a specific notification channel
   */
  private async sendToChannel(
    channelId: string,
    alert: any,
    workspaceId: string,
  ): Promise<{ success: boolean; error?: string }> {
    // Fetch notification channel configuration
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      return {
        success: false,
        error: `Channel ${channelId} not found`,
      };
    }

    if (!channel.enabled) {
      return {
        success: false,
        error: `Channel ${channelId} is disabled`,
      };
    }

    if (channel.workspaceId !== workspaceId) {
      return {
        success: false,
        error: `Channel ${channelId} does not belong to workspace ${workspaceId}`,
      };
    }

    // Dispatch based on channel type
    switch (channel.type) {
      case 'email':
        return await this.sendEmailNotification(channel, alert);

      case 'slack':
        return await this.sendSlackNotification(channel, alert);

      case 'telegram':
        return await this.sendTelegramNotification(channel, alert);

      case 'webhook':
        return await this.sendWebhookNotification(channel, alert);

      default:
        return {
          success: false,
          error: `Unknown channel type: ${channel.type}`,
        };
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    channel: any,
    alert: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Decrypt channel config
      const decryptedConfig = this.decrypt(channel.configEncrypted);
      const rawConfig = JSON.parse(decryptedConfig);

      const toEmail = rawConfig.email;
      const fromEmail = process.env.EMAIL_FROM || 'Sentinel <alerts@sentinel.taxinearme.sk>';
      const resendApiKey = process.env.RESEND_API_KEY;
      const sendgridApiKey = process.env.SENDGRID_API_KEY;

      // Use Resend API if configured
      if (resendApiKey) {
        return await this.sendViaResend(toEmail, fromEmail, alert, resendApiKey);
      }

      // Use SendGrid API if configured
      if (sendgridApiKey) {
        return await this.sendViaSendGrid(toEmail, fromEmail, alert, sendgridApiKey);
      }

      // Use Mailgun API if configured
      const mailgunApiKey = process.env.MAILGUN_API_KEY;
      const mailgunDomain = process.env.MAILGUN_DOMAIN;
      if (mailgunApiKey && mailgunDomain) {
        return await this.sendViaMailgun(toEmail, fromEmail, alert, mailgunApiKey, mailgunDomain);
      }

      // Fall back to SMTP
      const emailConfig = {
        to: [toEmail],
        from: rawConfig.from,
      };

      const smtpConfig: SmtpConfig = {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'alerts@sentinel.app',
      };

      const alertData: AlertData = {
        id: alert.id,
        ruleId: alert.ruleId,
        ruleName: alert.rule.name,
        sourceUrl: alert.rule.source.url,
        severity: this.mapAlertSeverity(alert.severity),
        title: alert.title,
        body: alert.body,
        triggeredAt: alert.triggeredAt,
        currentValue: null,
        previousValue: null,
        changeKind: '',
        diffSummary: '',
      };

      const result = await sendEmailAlert(emailConfig, alertData, smtpConfig);
      return { success: result.success, error: result.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send email via Resend API (HTTP)
   */
  private async sendViaResend(
    to: string,
    from: string,
    alert: any,
    apiKey: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${alert.severity === 'high' ? '#dc2626' : alert.severity === 'medium' ? '#f59e0b' : '#3b82f6'};">
            ${alert.title}
          </h2>
          <p><strong>Rule:</strong> ${alert.rule.name}</p>
          <p><strong>Source:</strong> <a href="${alert.rule.source.url}">${alert.rule.source.url}</a></p>
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
            ${alert.body.replace(/\n/g, '<br>')}
          </div>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            Triggered at: ${new Date(alert.triggeredAt).toLocaleString()}
          </p>
        </div>
      `;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject,
          html,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Resend API error: ${response.status} - ${errorText}` };
      }

      const result = await response.json();
      this.logger.log(`Email sent via Resend: ${result.id}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send email via Mailgun API (HTTP)
   */
  private async sendViaMailgun(
    to: string,
    from: string,
    alert: any,
    apiKey: string,
    domain: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${alert.severity === 'high' ? '#dc2626' : alert.severity === 'medium' ? '#f59e0b' : '#3b82f6'};">
            ${alert.title}
          </h2>
          <p><strong>Rule:</strong> ${alert.rule.name}</p>
          <p><strong>Source:</strong> <a href="${alert.rule.source.url}">${alert.rule.source.url}</a></p>
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
            ${alert.body.replace(/\n/g, '<br>')}
          </div>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            Triggered at: ${new Date(alert.triggeredAt).toLocaleString()}
          </p>
        </div>
      `;

      const formData = new URLSearchParams();
      formData.append('from', from);
      formData.append('to', to);
      formData.append('subject', subject);
      formData.append('html', html);

      const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Mailgun API error: ${response.status} - ${errorText}` };
      }

      const result = await response.json();
      this.logger.log(`Email sent via Mailgun: ${result.id}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send email via SendGrid API (HTTP)
   */
  private async sendViaSendGrid(
    to: string,
    from: string,
    alert: any,
    apiKey: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const subject = `[${alert.severity.toUpperCase()}] ${alert.title}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${alert.severity === 'high' ? '#dc2626' : alert.severity === 'medium' ? '#f59e0b' : '#3b82f6'};">
            ${alert.title}
          </h2>
          <p><strong>Rule:</strong> ${alert.rule.name}</p>
          <p><strong>Source:</strong> <a href="${alert.rule.source.url}">${alert.rule.source.url}</a></p>
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <div style="background: #f9fafb; padding: 15px; border-radius: 8px;">
            ${alert.body.replace(/\n/g, '<br>')}
          </div>
          <hr style="border: 1px solid #e5e7eb; margin: 20px 0;">
          <p style="color: #6b7280; font-size: 12px;">
            Triggered at: ${new Date(alert.triggeredAt).toLocaleString()}
          </p>
        </div>
      `;

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from.replace(/<|>/g, '').split(' ').pop() || from, name: from.split('<')[0].trim() || 'Sentinel' },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `SendGrid API error: ${response.status} - ${errorText}` };
      }

      this.logger.log(`Email sent via SendGrid to ${to}`);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Map AlertSeverity to email severity format
   */
  private mapAlertSeverity(
    severity: string,
  ): 'info' | 'warning' | 'critical' {
    switch (severity) {
      case 'low':
        return 'info';
      case 'medium':
        return 'warning';
      case 'high':
      case 'critical':
        return 'critical';
      default:
        return 'info';
    }
  }

  /**
   * Prepare alert data for notification adapters
   */
  private prepareAlertData(alert: any): AlertData {
    return {
      id: alert.id,
      ruleId: alert.ruleId,
      ruleName: alert.rule.name,
      sourceUrl: alert.rule.source.url,
      severity: this.mapAlertSeverity(alert.severity),
      title: alert.title,
      body: alert.body,
      triggeredAt: alert.triggeredAt,
      currentValue: null,
      previousValue: null,
      changeKind: '',
      diffSummary: '',
    };
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(
    channel: any,
    alert: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const decryptedConfig = this.decrypt(channel.configEncrypted);
      const slackConfig = JSON.parse(decryptedConfig) as SlackConfig;
      const alertData = this.prepareAlertData(alert);

      const result = await sendSlackAlert(slackConfig, alertData);

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send Telegram notification
   */
  private async sendTelegramNotification(
    channel: any,
    alert: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const decryptedConfig = this.decrypt(channel.configEncrypted);
      const telegramConfig = JSON.parse(decryptedConfig) as TelegramConfig;
      const alertData = this.prepareAlertData(alert);

      const result = await sendTelegramAlert(telegramConfig, alertData);

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send Webhook notification
   */
  private async sendWebhookNotification(
    channel: any,
    alert: any,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const decryptedConfig = this.decrypt(channel.configEncrypted);
      const webhookConfig = JSON.parse(decryptedConfig) as WebhookConfig;
      const alertData = this.prepareAlertData(alert);

      const result = await sendWebhookAlert(webhookConfig, alertData);

      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle job completion
   */
  async onCompleted(job: Job<AlertDispatchPayload>) {
    this.logger.log(
      `[Job ${job.id}] Alert dispatch completed for alert ${job.data.alertId}`,
    );
  }

  /**
   * Handle job failure
   */
  async onFailed(job: Job<AlertDispatchPayload> | undefined, error: Error) {
    if (!job) {
      this.logger.error('Alert dispatch failed without job data', error.stack);
      return;
    }

    this.logger.error(
      `[Job ${job.id}] Alert dispatch failed for alert ${job.data.alertId}: ${error.message}`,
      error.stack,
    );

    // Log failed delivery to database
    try {
      await this.prisma.alert.update({
        where: { id: job.data.alertId },
        data: {
          channelsSent: [
            {
              error: 'Job failed',
              message: error.message,
            },
          ] as any,
        },
      });
    } catch (updateError) {
      this.logger.error(
        `Failed to update alert delivery status: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
      );
    }
  }

  /**
   * Handle stalled jobs
   */
  async onStalled(job: Job<AlertDispatchPayload>) {
    this.logger.warn(
      `[Job ${job.id}] Alert dispatch stalled for alert ${job.data.alertId}, will be retried`,
    );
  }
}
