# Worker Usage Examples

## Basic Job Enqueuing

### From API Controller

```typescript
import { Controller, Post, Body } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';

@Controller('rules')
export class RulesController {
  constructor(private queueService: QueueService) {}

  @Post(':id/execute')
  async executeRule(@Param('id') ruleId: string, @Body() body: any) {
    const job = await this.queueService.enqueueRuleRun({
      ruleId,
      trigger: 'manual_test',
      requestedAt: new Date().toISOString(),
      forceMode: body.forceMode || null,
      debug: body.debug || false,
    });

    return {
      success: true,
      jobId: job.id,
      message: 'Rule execution queued',
    };
  }
}
```

### From Service with Scheduling

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueService } from '@sentinel/worker';
import { PrismaService } from '@sentinel/storage';

@Injectable()
export class RuleSchedulerService {
  private readonly logger = new Logger(RuleSchedulerService.name);

  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduleActiveRules() {
    this.logger.log('Checking for rules to schedule...');

    // Get rules that should run now
    const rules = await this.prisma.rule.findMany({
      where: {
        enabled: true,
        nextRunAt: {
          lte: new Date(),
        },
      },
    });

    this.logger.log(`Found ${rules.length} rules to execute`);

    // Enqueue each rule
    const jobs = await Promise.all(
      rules.map((rule) =>
        this.queueService.enqueueRuleRun({
          ruleId: rule.id,
          trigger: 'schedule',
          requestedAt: new Date().toISOString(),
        }),
      ),
    );

    // Update nextRunAt for each rule
    await Promise.all(
      rules.map((rule, index) =>
        this.prisma.rule.update({
          where: { id: rule.id },
          data: {
            nextRunAt: this.calculateNextRunTime(rule.schedule),
            lastRunAt: new Date(),
          },
        }),
      ),
    );

    this.logger.log(`Enqueued ${jobs.length} rule executions`);
  }

  private calculateNextRunTime(schedule: string): Date {
    // Parse cron expression and calculate next run
    // Implementation depends on scheduling library
    return new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  }
}
```

## Alert Dispatching

### After Rule Execution Detects Changes

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';
import { PrismaService } from '@sentinel/storage';

@Injectable()
export class AlertService {
  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  async createAndDispatchAlert(
    ruleId: string,
    workspaceId: string,
    changeData: any,
  ) {
    // Create alert in database
    const alert = await this.prisma.alert.create({
      data: {
        ruleId,
        workspaceId,
        type: 'CHANGE_DETECTED',
        severity: 'INFO',
        data: changeData,
        status: 'PENDING',
      },
    });

    // Get workspace notification settings
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { notificationChannels: true },
    });

    const channels = workspace.notificationChannels
      .filter((ch) => ch.enabled)
      .map((ch) => ch.type.toLowerCase());

    // Enqueue alert dispatch
    const job = await this.queueService.enqueueAlertDispatch({
      alertId: alert.id,
      workspaceId,
      ruleId,
      channels,
      dedupeKey: `${ruleId}:${new Date().toISOString().split('T')[0]}`,
    });

    return { alert, job };
  }
}
```

## Delayed Job Execution

### Schedule Rule for Specific Time

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';

@Injectable()
export class ScheduledExecutionService {
  constructor(private queueService: QueueService) {}

  async scheduleRuleAt(ruleId: string, executeAt: Date) {
    const now = new Date();
    const delay = executeAt.getTime() - now.getTime();

    if (delay <= 0) {
      throw new Error('Execute time must be in the future');
    }

    const job = await this.queueService.enqueueRuleRun(
      {
        ruleId,
        trigger: 'schedule',
        requestedAt: new Date().toISOString(),
      },
      { delay }, // Delay in milliseconds
    );

    return {
      jobId: job.id,
      willExecuteAt: executeAt.toISOString(),
    };
  }
}
```

## Queue Management

### Pause/Resume for Maintenance

```typescript
import { Controller, Post } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';

@Controller('admin/queues')
export class QueueAdminController {
  constructor(private queueService: QueueService) {}

  @Post('pause')
  async pauseQueues() {
    await this.queueService.pauseAll();
    return { message: 'All queues paused' };
  }

  @Post('resume')
  async resumeQueues() {
    await this.queueService.resumeAll();
    return { message: 'All queues resumed' };
  }

  @Get('stats')
  async getStats() {
    return await this.queueService.getStats();
  }
}
```

## Retry Failed Jobs

### Manual Retry Endpoint

```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, RunJobPayload } from '@sentinel/worker';

@Injectable()
export class JobRetryService {
  constructor(
    @InjectQueue(QUEUE_NAMES.RULES_RUN)
    private rulesRunQueue: Queue<RunJobPayload>,
  ) {}

  async retryFailedJob(jobId: string) {
    const job = await this.rulesRunQueue.getJob(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (await job.isFailed()) {
      await job.retry();
      return { message: `Job ${jobId} retried` };
    }

    throw new Error(`Job ${jobId} is not in failed state`);
  }

  async retryAllFailed() {
    const failedJobs = await this.rulesRunQueue.getFailed();

    await Promise.all(failedJobs.map((job) => job.retry()));

    return { message: `Retried ${failedJobs.length} failed jobs` };
  }
}
```

## Environment-Specific Configuration

### Development vs Production

```typescript
// apps/api/src/config/worker.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('worker', () => ({
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.NODE_ENV === 'test' ? 1 : 0, // Separate DB for tests
  },
  concurrency: {
    // Lower concurrency in development
    rulesRun: process.env.NODE_ENV === 'production' ? 10 : 2,
    alertsDispatch: process.env.NODE_ENV === 'production' ? 20 : 5,
  },
}));
```

## Testing with Worker

### Mock Queue Service in Tests

```typescript
import { Test } from '@nestjs/testing';
import { QueueService } from '@sentinel/worker';
import { RulesService } from './rules.service';

describe('RulesService', () => {
  let service: RulesService;
  let queueService: jest.Mocked<QueueService>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: QueueService,
          useValue: {
            enqueueRuleRun: jest.fn().mockResolvedValue({ id: 'test-job' }),
            enqueueAlertDispatch: jest.fn().mockResolvedValue({ id: 'test-alert-job' }),
            getStats: jest.fn().mockResolvedValue({
              rulesRun: { waiting: 0, active: 0 },
              alertsDispatch: { waiting: 0, active: 0 },
            }),
          },
        },
      ],
    }).compile();

    service = module.get(RulesService);
    queueService = module.get(QueueService);
  });

  it('should enqueue rule execution', async () => {
    await service.executeRule('rule-123');

    expect(queueService.enqueueRuleRun).toHaveBeenCalledWith({
      ruleId: 'rule-123',
      trigger: 'manual_test',
      requestedAt: expect.any(String),
    });
  });
});
```

## Monitoring and Observability

### Log Job Progress

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnQueueEvent, QueueEventsHost, QueueEventsListener } from '@nestjs/bullmq';

@Injectable()
@QueueEventsListener('rules:run')
export class RuleQueueEvents extends QueueEventsHost {
  private readonly logger = new Logger(RuleQueueEvents.name);

  @OnQueueEvent('active')
  onActive(job: { jobId: string }) {
    this.logger.log(`Job ${job.jobId} is now active`);
  }

  @OnQueueEvent('completed')
  onCompleted(job: { jobId: string; returnvalue: any }) {
    this.logger.log(`Job ${job.jobId} completed successfully`);
  }

  @OnQueueEvent('failed')
  onFailed(job: { jobId: string; failedReason: string }) {
    this.logger.error(`Job ${job.jobId} failed: ${job.failedReason}`);
  }
}
```
