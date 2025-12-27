import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let prismaService: PrismaService;
  let queueMock: any;

  const mockRule = {
    id: 'rule-1',
    sourceId: 'source-1',
    name: 'Test Rule',
    ruleType: 'price' as const,
    extraction: {},
    schedule: {
      intervalSeconds: 3600,
      jitterSeconds: 60,
    },
    enabled: true,
    nextRunAt: new Date('2024-01-01T10:00:00Z'),
    createdAt: new Date(),
    normalization: null,
    alertPolicy: null,
    healthScore: 100,
    lastErrorCode: null,
    lastErrorAt: null,
    source: {
      domain: 'example.com',
    },
  };

  beforeEach(async () => {
    // Mock Queue
    queueMock = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulerService,
        {
          provide: getQueueToken('rules:run'),
          useValue: queueMock,
        },
        {
          provide: PrismaService,
          useValue: {
            rule: {
              findMany: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<SchedulerService>(SchedulerService);
    prismaService = module.get<PrismaService>(PrismaService);

    // Override env vars for testing
    process.env.SCHEDULER_ENABLED = 'false'; // Disable auto-start in tests
    process.env.SCHEDULER_TICK_INTERVAL = '1000';
    process.env.SCHEDULER_BATCH_SIZE = '100';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should parse environment variables correctly', () => {
      expect(service['TICK_INTERVAL']).toBe(1000);
      expect(service['BATCH_SIZE']).toBe(100);
      expect(service['ENABLED']).toBe(false);
    });
  });

  describe('processDueRules', () => {
    it('should do nothing when no rules are due', async () => {
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([]);

      await service['processDueRules']();

      expect(prismaService.rule.findMany).toHaveBeenCalledWith({
        where: {
          enabled: true,
          nextRunAt: { lte: expect.any(Date) },
        },
        take: 100,
        orderBy: { nextRunAt: 'asc' },
        include: {
          source: {
            select: {
              domain: true,
            },
          },
        },
      });
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('should enqueue due rules and update nextRunAt', async () => {
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([mockRule as any]);
      jest.spyOn(prismaService.rule, 'update').mockResolvedValue(mockRule as any);

      await service['processDueRules']();

      // Should enqueue job
      expect(queueMock.add).toHaveBeenCalledWith(
        'run',
        {
          ruleId: 'rule-1',
          trigger: 'schedule',
          requestedAt: expect.any(String),
        },
        expect.objectContaining({
          jobId: expect.stringContaining('rule:rule-1:'),
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }),
      );

      // Should update nextRunAt
      expect(prismaService.rule.update).toHaveBeenCalledWith({
        where: { id: 'rule-1' },
        data: { nextRunAt: expect.any(Date) },
      });
    });

    it('should group rules by domain', async () => {
      const rule1 = { ...mockRule, id: 'rule-1', source: { domain: 'example.com' } };
      const rule2 = { ...mockRule, id: 'rule-2', source: { domain: 'example.com' } };
      const rule3 = { ...mockRule, id: 'rule-3', source: { domain: 'other.com' } };

      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([rule1, rule2, rule3] as any);
      jest.spyOn(prismaService.rule, 'update').mockResolvedValue(mockRule as any);

      await service['processDueRules']();

      // Should enqueue all 3 rules
      expect(queueMock.add).toHaveBeenCalledTimes(3);

      // Should update all 3 rules
      expect(prismaService.rule.update).toHaveBeenCalledTimes(3);
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([mockRule as any]);
      queueMock.add.mockRejectedValue(new Error('Queue error'));

      // Should not throw
      await expect(service['processDueRules']()).resolves.not.toThrow();

      // Should still attempt to process
      expect(queueMock.add).toHaveBeenCalled();
    });
  });

  describe('calculateNextRunTime', () => {
    it('should calculate next run with interval only', () => {
      const schedule = { intervalSeconds: 3600 };
      const beforeTime = Date.now();
      const nextRunAt = service['calculateNextRunTime'](schedule);
      const afterTime = Date.now();

      const expectedMin = beforeTime + 3600 * 1000;
      const expectedMax = afterTime + 3600 * 1000;

      expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(nextRunAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it('should apply jitter when configured', () => {
      const schedule = { intervalSeconds: 3600, jitterSeconds: 600 };
      const nextRunAt = service['calculateNextRunTime'](schedule);

      const expectedMin = Date.now() + 3600 * 1000;
      const expectedMax = Date.now() + (3600 + 600) * 1000;

      expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(nextRunAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it('should use default interval when missing', () => {
      const schedule = {};
      const nextRunAt = service['calculateNextRunTime'](schedule);

      // Should use default 3600 seconds
      const expectedMin = Date.now() + 3600 * 1000 - 100;
      const expectedMax = Date.now() + 3600 * 1000 + 100;

      expect(nextRunAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(nextRunAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('triggerNow', () => {
    it('should manually trigger processing', async () => {
      jest.spyOn(prismaService.rule, 'count').mockResolvedValue(5);
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([mockRule as any]);
      jest.spyOn(prismaService.rule, 'update').mockResolvedValue(mockRule as any);

      const count = await service.triggerNow();

      expect(count).toBe(5);
      expect(prismaService.rule.findMany).toHaveBeenCalled();
      expect(queueMock.add).toHaveBeenCalled();
    });

    it('should throw when already processing', async () => {
      service['isProcessing'] = true;

      await expect(service.triggerNow()).rejects.toThrow(
        'Scheduler is already processing',
      );
    });

    it('should reset processing flag after completion', async () => {
      jest.spyOn(prismaService.rule, 'count').mockResolvedValue(0);
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([]);

      expect(service['isProcessing']).toBe(false);
      await service.triggerNow();
      expect(service['isProcessing']).toBe(false);
    });

    it('should reset processing flag after error', async () => {
      jest.spyOn(prismaService.rule, 'count').mockResolvedValue(1);
      jest.spyOn(prismaService.rule, 'findMany').mockRejectedValue(new Error('DB error'));

      expect(service['isProcessing']).toBe(false);
      await expect(service.triggerNow()).rejects.toThrow();
      expect(service['isProcessing']).toBe(false);
    });
  });

  describe('groupByDomain', () => {
    it('should group rules by domain', () => {
      const rules = [
        { id: 'rule-1', source: { domain: 'example.com' }, schedule: {} },
        { id: 'rule-2', source: { domain: 'example.com' }, schedule: {} },
        { id: 'rule-3', source: { domain: 'other.com' }, schedule: {} },
      ];

      const grouped = service['groupByDomain'](rules);

      expect(grouped.size).toBe(2);
      expect(grouped.get('example.com')).toHaveLength(2);
      expect(grouped.get('other.com')).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const grouped = service['groupByDomain']([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe('tick', () => {
    it('should prevent overlapping ticks', async () => {
      service['isProcessing'] = true;
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([]);

      await service['tick']();

      // Should not call processDueRules when already processing
      expect(prismaService.rule.findMany).not.toHaveBeenCalled();
    });

    it('should not run when shutting down', async () => {
      service['isShuttingDown'] = true;
      jest.spyOn(prismaService.rule, 'findMany').mockResolvedValue([]);

      await service['tick']();

      expect(prismaService.rule.findMany).not.toHaveBeenCalled();
    });

    it('should reset processing flag after error', async () => {
      jest.spyOn(prismaService.rule, 'findMany').mockRejectedValue(new Error('DB error'));

      await service['tick']();

      expect(service['isProcessing']).toBe(false);
    });
  });
});
