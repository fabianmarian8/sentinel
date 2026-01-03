import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerConfigService } from '../config/config.service';
import { QUEUE_NAMES, MaintenanceJobPayload } from '../types/jobs';

/**
 * Maintenance Processor
 *
 * Handles scheduled cleanup and maintenance tasks:
 * - rawsample-cleanup: Clear rawSample from runs older than retention period
 * - fetch-attempts-cleanup: Delete old fetch attempts (future)
 *
 * Runs via repeatable jobs configured on module init
 */
@Processor(QUEUE_NAMES.MAINTENANCE, {
  concurrency: 1, // Only one maintenance job at a time
})
export class MaintenanceProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  // Default retention in days
  private readonly DEFAULT_RAWSAMPLE_RETENTION_DAYS = 7;
  private readonly DEFAULT_FETCH_ATTEMPTS_RETENTION_DAYS = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: WorkerConfigService,
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) private readonly maintenanceQueue: Queue,
  ) {
    super();
  }

  /**
   * On module init, set up repeatable maintenance jobs
   */
  async onModuleInit() {
    this.logger.log('[Maintenance] Initializing repeatable jobs...');

    try {
      // Remove existing repeatable jobs to prevent duplicates
      const existing = await this.maintenanceQueue.getRepeatableJobs();
      for (const job of existing) {
        await this.maintenanceQueue.removeRepeatableByKey(job.key);
        this.logger.debug(`[Maintenance] Removed old repeatable job: ${job.key}`);
      }

      // Schedule rawSample cleanup daily at 03:30 UTC
      await this.maintenanceQueue.add(
        'rawsample-cleanup',
        { task: 'rawsample-cleanup' } as MaintenanceJobPayload,
        {
          repeat: {
            pattern: '30 3 * * *', // 03:30 UTC daily
          },
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 10 },
        },
      );
      this.logger.log('[Maintenance] Scheduled rawsample-cleanup at 03:30 UTC daily');

      // Schedule fetch attempts cleanup daily at 04:00 UTC
      await this.maintenanceQueue.add(
        'fetch-attempts-cleanup',
        { task: 'fetch-attempts-cleanup' } as MaintenanceJobPayload,
        {
          repeat: {
            pattern: '0 4 * * *', // 04:00 UTC daily
          },
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 10 },
        },
      );
      this.logger.log('[Maintenance] Scheduled fetch-attempts-cleanup at 04:00 UTC daily');

    } catch (error) {
      this.logger.error(`[Maintenance] Failed to set up repeatable jobs: ${error}`);
    }
  }

  async process(job: Job<MaintenanceJobPayload>): Promise<void> {
    const { task, config } = job.data;
    this.logger.log(`[Maintenance] Starting task: ${task}`);

    const startTime = Date.now();

    try {
      switch (task) {
        case 'rawsample-cleanup':
          await this.cleanupRawSamples(config?.retentionDays);
          break;

        case 'fetch-attempts-cleanup':
          await this.cleanupFetchAttempts(config?.retentionDays);
          break;

        default:
          this.logger.warn(`[Maintenance] Unknown task: ${task}`);
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(`[Maintenance] Task ${task} completed in ${elapsed}ms`);

    } catch (error) {
      const err = error as Error;
      this.logger.error(`[Maintenance] Task ${task} failed: ${err.message}`, err.stack);
      throw error; // Re-throw to mark job as failed
    }
  }

  /**
   * Clean up rawSample from old runs
   *
   * Sets rawSample to NULL for runs older than retention period.
   * Preserves the run record for audit trail.
   */
  private async cleanupRawSamples(retentionDays?: number): Promise<void> {
    const days = retentionDays ?? this.DEFAULT_RAWSAMPLE_RETENTION_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.logger.log(`[Maintenance] Cleaning rawSample older than ${days} days (cutoff: ${cutoffDate.toISOString()})`);

    // Use raw query for efficiency on large datasets
    const result = await this.prisma.$executeRaw`
      UPDATE runs
      SET raw_sample = NULL
      WHERE started_at < ${cutoffDate}
        AND raw_sample IS NOT NULL
    `;

    this.logger.log(`[Maintenance] Cleared rawSample from ${result} runs`);
  }

  /**
   * Clean up old fetch attempts
   *
   * Deletes fetch attempts older than retention period.
   * Domain stats are preserved separately.
   */
  private async cleanupFetchAttempts(retentionDays?: number): Promise<void> {
    const days = retentionDays ?? this.DEFAULT_FETCH_ATTEMPTS_RETENTION_DAYS;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    this.logger.log(`[Maintenance] Cleaning fetch attempts older than ${days} days (cutoff: ${cutoffDate.toISOString()})`);

    // Delete in batches to avoid locking
    const BATCH_SIZE = 10000;
    let totalDeleted = 0;
    let deleted: number;

    do {
      deleted = await this.prisma.$executeRaw`
        DELETE FROM fetch_attempts
        WHERE id IN (
          SELECT id FROM fetch_attempts
          WHERE created_at < ${cutoffDate}
          LIMIT ${BATCH_SIZE}
        )
      `;
      totalDeleted += deleted;

      if (deleted > 0) {
        this.logger.debug(`[Maintenance] Deleted batch of ${deleted} fetch attempts`);
      }
    } while (deleted === BATCH_SIZE);

    this.logger.log(`[Maintenance] Deleted ${totalDeleted} fetch attempts total`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<MaintenanceJobPayload>, error: Error): void {
    this.logger.error(
      `[Maintenance] Job ${job.id} (${job.data.task}) failed: ${error.message}`,
      error.stack,
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<MaintenanceJobPayload>): void {
    this.logger.debug(`[Maintenance] Job ${job.id} (${job.data.task}) completed`);
  }
}
