import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

interface ScheduleConfig {
  intervalSeconds: number;
  jitterSeconds?: number;
}

export interface RuleRunJobData {
  ruleId: string;
  trigger: 'schedule' | 'manual' | 'webhook';
  requestedAt: string;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isShuttingDown = false;

  private readonly TICK_INTERVAL: number;
  private readonly BATCH_SIZE: number;
  private readonly ENABLED: boolean;

  constructor(
    @InjectQueue('rules-run') private readonly rulesQueue: Queue<RuleRunJobData>,
    private readonly prisma: PrismaService,
  ) {
    this.TICK_INTERVAL = this.parseEnvInt('SCHEDULER_TICK_INTERVAL', 5000);
    this.BATCH_SIZE = this.parseEnvInt('SCHEDULER_BATCH_SIZE', 500);
    this.ENABLED = this.parseEnvBoolean('SCHEDULER_ENABLED', true);
  }

  async onModuleInit() {
    if (this.ENABLED) {
      this.logger.log(
        `Starting scheduler: tick=${this.TICK_INTERVAL}ms, batch=${this.BATCH_SIZE}`,
      );
      this.startScheduler();
    } else {
      this.logger.warn('Scheduler is disabled (SCHEDULER_ENABLED=false)');
    }
  }

  async onModuleDestroy() {
    await this.stopScheduler();
  }

  private startScheduler() {
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.TICK_INTERVAL);
  }

  private async stopScheduler() {
    this.logger.log('Stopping scheduler...');
    this.isShuttingDown = true;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Wait for current tick to finish
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();
    while (this.isProcessing && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isProcessing) {
      this.logger.warn('Scheduler stopped but tick still processing');
    } else {
      this.logger.log('Scheduler stopped gracefully');
    }
  }

  private async tick() {
    if (this.isProcessing || this.isShuttingDown) {
      return; // Prevent overlapping ticks
    }

    this.isProcessing = true;

    try {
      await this.processDueRules();
    } catch (error) {
      this.logger.error('Error during scheduler tick', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processDueRules() {
    const now = new Date();

    // Find due rules
    const dueRules = await this.prisma.rule.findMany({
      where: {
        enabled: true,
        nextRunAt: { lte: now },
      },
      take: this.BATCH_SIZE,
      orderBy: { nextRunAt: 'asc' },
      include: {
        source: {
          select: {
            domain: true,
          },
        },
      },
    });

    if (dueRules.length === 0) {
      return;
    }

    this.logger.debug(`Processing ${dueRules.length} due rules`);

    // Atomically claim these rules by setting nextRunAt to far future
    // This prevents other ticks from claiming the same rules
    const claimTime = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
    const ruleIds = dueRules.map((r) => r.id);

    const claimResult = await this.prisma.rule.updateMany({
      where: {
        id: { in: ruleIds },
        nextRunAt: { lte: now }, // Verify still due (atomic check)
      },
      data: {
        nextRunAt: claimTime,
      },
    });

    // If some rules were already claimed by another tick, filter them out
    const actuallyClaimedCount = claimResult.count;
    if (actuallyClaimedCount === 0) {
      this.logger.debug('All rules were already claimed by another tick');
      return;
    }

    if (actuallyClaimedCount < dueRules.length) {
      this.logger.debug(
        `Claimed ${actuallyClaimedCount}/${dueRules.length} rules (some already claimed)`,
      );
    }

    // Group rules by domain for rate limiting
    const rulesByDomain = this.groupByDomain(dueRules);

    // Process each domain group
    for (const [domain, rules] of rulesByDomain.entries()) {
      await this.processDomainRules(domain, rules);
    }

    this.logger.log(
      `Enqueued ${dueRules.length} rules across ${rulesByDomain.size} domains`,
    );
  }

  private groupByDomain(
    rules: Array<{ id: string; source: { domain: string }; schedule: any }>,
  ): Map<string, Array<{ id: string; schedule: any }>> {
    const grouped = new Map<string, Array<{ id: string; schedule: any }>>();

    for (const rule of rules) {
      const domain = rule.source.domain;
      if (!grouped.has(domain)) {
        grouped.set(domain, []);
      }
      grouped.get(domain)!.push({
        id: rule.id,
        schedule: rule.schedule,
      });
    }

    return grouped;
  }

  private async processDomainRules(
    domain: string,
    rules: Array<{ id: string; schedule: any }>,
  ) {
    // TODO: Implement domain rate limiting
    // For now, just enqueue all rules with a small delay between them
    const delayBetweenJobs = 100; // 100ms between jobs for same domain

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule) continue;

      try {
        // Calculate next run time BEFORE enqueue (since we already claimed it)
        const nextRunAt = this.calculateNextRunTime(rule.schedule);

        // Enqueue job
        await this.rulesQueue.add(
          'run',
          {
            ruleId: rule.id,
            trigger: 'schedule',
            requestedAt: new Date().toISOString(),
          },
          {
            jobId: `rule:${rule.id}:${Date.now()}`,
            removeOnComplete: { age: 3600 * 24 }, // Keep for 24 hours
            removeOnFail: { age: 3600 * 24 * 7 }, // Keep failures for 7 days
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        );

        // After successful enqueue, update nextRunAt to the correct value
        // Note: Worker may update this again if CAPTCHA is detected
        await this.prisma.rule.update({
          where: { id: rule.id },
          data: { nextRunAt },
        });

        this.logger.debug(
          `Enqueued rule ${rule.id}, next run: ${nextRunAt.toISOString()}`,
        );

        // Add delay for domain rate limiting
        if (i < rules.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayBetweenJobs));
        }
      } catch (error) {
        this.logger.error(
          `Failed to enqueue rule ${rule.id} for domain ${domain}`,
          error,
        );

        // If enqueue failed, reset nextRunAt so rule can be retried
        try {
          const retryAt = new Date(Date.now() + 60 * 1000); // Retry in 1 minute
          await this.prisma.rule.update({
            where: { id: rule.id },
            data: { nextRunAt: retryAt },
          });
        } catch (resetError) {
          this.logger.error(
            `Failed to reset nextRunAt for failed rule ${rule.id}`,
            resetError,
          );
        }
      }
    }
  }

  private calculateNextRunTime(schedule: any): Date {
    const config = schedule as ScheduleConfig;

    if (!config.intervalSeconds) {
      this.logger.warn('Rule has no intervalSeconds in schedule, using default 3600');
      return new Date(Date.now() + 3600 * 1000);
    }

    // Apply jitter if configured
    const jitter = config.jitterSeconds
      ? Math.random() * config.jitterSeconds
      : 0;

    const nextRunMs = (config.intervalSeconds + jitter) * 1000;
    return new Date(Date.now() + nextRunMs);
  }

  private parseEnvInt(key: string, defaultValue: number): number {
    const value = process.env[key];
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      this.logger.warn(
        `Invalid ${key}=${value}, using default ${defaultValue}`,
      );
      return defaultValue;
    }

    return parsed;
  }

  private parseEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;

    return value.toLowerCase() === 'true' || value === '1';
  }

  // Public method for manual triggering (useful for testing)
  async triggerNow(): Promise<number> {
    if (this.isProcessing) {
      throw new Error('Scheduler is already processing');
    }

    this.isProcessing = true;
    try {
      const countBefore = await this.prisma.rule.count({
        where: {
          enabled: true,
          nextRunAt: { lte: new Date() },
        },
      });

      await this.processDueRules();
      return countBefore;
    } finally {
      this.isProcessing = false;
    }
  }
}
