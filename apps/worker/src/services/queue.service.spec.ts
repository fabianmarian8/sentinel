import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { WorkerConfigService } from '../config/config.service';
import { QUEUE_NAMES } from '../types/jobs';

describe('QueueService', () => {
  let service: QueueService;
  let rulesRunQueue: any;
  let alertsDispatchQueue: any;

  beforeEach(async () => {
    // Mock queues
    rulesRunQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-1' }),
      isPaused: jest.fn().mockResolvedValue(false),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      }),
      pause: jest.fn(),
      resume: jest.fn(),
    };

    alertsDispatchQueue = {
      add: jest.fn().mockResolvedValue({ id: 'test-job-2' }),
      isPaused: jest.fn().mockResolvedValue(false),
      getJobCounts: jest.fn().mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
      }),
      pause: jest.fn(),
      resume: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getQueueToken(QUEUE_NAMES.RULES_RUN),
          useValue: rulesRunQueue,
        },
        {
          provide: getQueueToken(QUEUE_NAMES.ALERTS_DISPATCH),
          useValue: alertsDispatchQueue,
        },
        {
          provide: WorkerConfigService,
          useValue: {
            retryPolicies: {
              rulesRun: {
                maxAttempts: 2,
                backoffDelays: [30000, 120000],
              },
              alertsDispatch: {
                maxAttempts: 5,
                backoffDelays: [10000, 30000, 60000, 120000, 300000],
              },
            },
          },
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should enqueue rule run job', async () => {
    const payload = {
      ruleId: 'rule-123',
      trigger: 'schedule' as const,
      requestedAt: new Date().toISOString(),
    };

    const job = await service.enqueueRuleRun(payload);
    expect(job.id).toBe('test-job-1');
    expect(rulesRunQueue.add).toHaveBeenCalledWith('run', payload, expect.any(Object));
  });

  it('should enqueue alert dispatch job', async () => {
    const payload = {
      alertId: 'alert-456',
      workspaceId: 'workspace-789',
      ruleId: 'rule-123',
      channels: ['slack', 'email'],
      dedupeKey: 'dedupe-key',
    };

    const job = await service.enqueueAlertDispatch(payload);
    expect(job.id).toBe('test-job-2');
    expect(alertsDispatchQueue.add).toHaveBeenCalledWith('dispatch', payload, expect.any(Object));
  });

  it('should get queue statistics', async () => {
    const stats = await service.getStats();
    expect(stats).toHaveProperty('rulesRun');
    expect(stats).toHaveProperty('alertsDispatch');
  });
});
