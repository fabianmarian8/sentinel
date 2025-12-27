import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
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
      // Decrypt channel config (for now, assume it's stored as JSON)
      // In production, this should use proper encryption
      const emailConfig = JSON.parse(channel.configEncrypted);

      // Get SMTP config from environment
      const smtpConfig: SmtpConfig = {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
        from: process.env.SMTP_FROM || 'alerts@sentinel.app',
      };

      // Prepare alert data for email template
      const alertData: AlertData = {
        id: alert.id,
        ruleId: alert.ruleId,
        ruleName: alert.rule.name,
        sourceUrl: alert.rule.source.url,
        severity: this.mapAlertSeverity(alert.severity),
        title: alert.title,
        body: alert.body,
        triggeredAt: alert.triggeredAt,
        currentValue: null, // Not stored in alert record
        previousValue: null, // Not stored in alert record
        changeKind: '', // Not stored in alert record
        diffSummary: '', // Embedded in body
      };

      // Send email
      const result = await sendEmailAlert(emailConfig, alertData, smtpConfig);

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
      const slackConfig = JSON.parse(channel.configEncrypted) as SlackConfig;
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
      const telegramConfig = JSON.parse(channel.configEncrypted) as TelegramConfig;
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
      const webhookConfig = JSON.parse(channel.configEncrypted) as WebhookConfig;
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
