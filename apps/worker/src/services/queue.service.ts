import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  RunJobPayload,
  AlertDispatchPayload,
  QUEUE_NAMES,
} from '../types/jobs';
import { WorkerConfigService } from '../config/config.service';

/**
 * Queue service for job injection
 * Used by API to enqueue background jobs
 */
@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.RULES_RUN)
    private rulesRunQueue: Queue<RunJobPayload>,
    @InjectQueue(QUEUE_NAMES.ALERTS_DISPATCH)
    private alertsDispatchQueue: Queue<AlertDispatchPayload>,
    private config: WorkerConfigService,
  ) {}

  async onModuleInit() {
    this.logger.log('Queue service initialized');
    this.logger.log(
      `Rules:Run queue connected: ${await this.rulesRunQueue.isPaused() ? 'PAUSED' : 'ACTIVE'}`,
    );
    this.logger.log(
      `Alerts:Dispatch queue connected: ${await this.alertsDispatchQueue.isPaused() ? 'PAUSED' : 'ACTIVE'}`,
    );
  }

  /**
   * Enqueue a rule execution job
   */
  async enqueueRuleRun(payload: RunJobPayload, options?: { delay?: number }) {
    const job = await this.rulesRunQueue.add('run', payload, {
      attempts: this.config.retryPolicies.rulesRun.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.retryPolicies.rulesRun.backoffDelays[0],
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24 hours
        count: 1000, // Keep max 1000 completed jobs
      },
      removeOnFail: {
        age: 604800, // Keep failed jobs for 7 days
      },
      delay: options?.delay,
    });

    this.logger.log(
      `Enqueued rule run job ${job.id} for rule ${payload.ruleId} (trigger: ${payload.trigger})`,
    );
    return job;
  }

  /**
   * Enqueue an alert dispatch job
   */
  async enqueueAlertDispatch(
    payload: AlertDispatchPayload,
    options?: { delay?: number },
  ) {
    const job = await this.alertsDispatchQueue.add('dispatch', payload, {
      attempts: this.config.retryPolicies.alertsDispatch.maxAttempts,
      backoff: {
        type: 'exponential',
        delay: this.config.retryPolicies.alertsDispatch.backoffDelays[0],
      },
      removeOnComplete: {
        age: 86400,
        count: 1000,
      },
      removeOnFail: {
        age: 604800,
      },
      delay: options?.delay,
      // Deduplication: prevent duplicate alerts within 5 minutes
      jobId: `${payload.dedupeKey}-${Math.floor(Date.now() / 300000)}`,
    });

    this.logger.log(
      `Enqueued alert dispatch job ${job.id} for alert ${payload.alertId} (channels: ${payload.channels.join(', ')})`,
    );
    return job;
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const [rulesRunCounts, alertsDispatchCounts] = await Promise.all([
      this.rulesRunQueue.getJobCounts(),
      this.alertsDispatchQueue.getJobCounts(),
    ]);

    return {
      rulesRun: rulesRunCounts,
      alertsDispatch: alertsDispatchCounts,
    };
  }

  /**
   * Pause all queues (for maintenance)
   */
  async pauseAll() {
    await Promise.all([
      this.rulesRunQueue.pause(),
      this.alertsDispatchQueue.pause(),
    ]);
    this.logger.warn('All queues paused');
  }

  /**
   * Resume all queues
   */
  async resumeAll() {
    await Promise.all([
      this.rulesRunQueue.resume(),
      this.alertsDispatchQueue.resume(),
    ]);
    this.logger.log('All queues resumed');
  }
}
