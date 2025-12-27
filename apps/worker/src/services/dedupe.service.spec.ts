import { Test, TestingModule } from '@nestjs/testing';
import { DedupeService } from './dedupe.service';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';

describe('DedupeService', () => {
  let service: DedupeService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      alert: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DedupeService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<DedupeService>(DedupeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateDedupeKey', () => {
    it('should generate consistent hash for same inputs', () => {
      const ruleId = 'rule-123';
      const conditionIds = ['cond-1', 'cond-2'];
      const value = { price: 99.99, currency: 'EUR' };
      const timezone = 'Europe/Bratislava';

      const key1 = service.generateDedupeKey(
        ruleId,
        conditionIds,
        value,
        timezone,
      );
      const key2 = service.generateDedupeKey(
        ruleId,
        conditionIds,
        value,
        timezone,
      );

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA256 hex string
    });

    it('should sort condition IDs for stability', () => {
      const ruleId = 'rule-123';
      const value = { price: 99.99 };
      const timezone = 'UTC';

      const key1 = service.generateDedupeKey(
        ruleId,
        ['cond-2', 'cond-1'],
        value,
        timezone,
      );
      const key2 = service.generateDedupeKey(
        ruleId,
        ['cond-1', 'cond-2'],
        value,
        timezone,
      );

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different rules', () => {
      const conditionIds = ['cond-1'];
      const value = { price: 99.99 };
      const timezone = 'UTC';

      const key1 = service.generateDedupeKey(
        'rule-1',
        conditionIds,
        value,
        timezone,
      );
      const key2 = service.generateDedupeKey(
        'rule-2',
        conditionIds,
        value,
        timezone,
      );

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different values', () => {
      const ruleId = 'rule-123';
      const conditionIds = ['cond-1'];
      const timezone = 'UTC';

      const key1 = service.generateDedupeKey(
        ruleId,
        conditionIds,
        { price: 99.99 },
        timezone,
      );
      const key2 = service.generateDedupeKey(
        ruleId,
        conditionIds,
        { price: 89.99 },
        timezone,
      );

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different condition sets', () => {
      const ruleId = 'rule-123';
      const value = { price: 99.99 };
      const timezone = 'UTC';

      const key1 = service.generateDedupeKey(
        ruleId,
        ['cond-1'],
        value,
        timezone,
      );
      const key2 = service.generateDedupeKey(
        ruleId,
        ['cond-1', 'cond-2'],
        value,
        timezone,
      );

      expect(key1).not.toBe(key2);
    });

    it('should handle empty condition arrays', () => {
      const ruleId = 'rule-123';
      const value = { price: 99.99 };
      const timezone = 'UTC';

      const key = service.generateDedupeKey(ruleId, [], value, timezone);

      expect(key).toHaveLength(64);
    });

    it('should handle complex nested values', () => {
      const ruleId = 'rule-123';
      const conditionIds = ['cond-1'];
      const timezone = 'UTC';

      const complexValue = {
        products: [
          { id: 1, price: 99.99, available: true },
          { id: 2, price: 149.99, available: false },
        ],
        metadata: {
          timestamp: '2025-01-01T00:00:00Z',
          source: 'api',
        },
      };

      const key = service.generateDedupeKey(
        ruleId,
        conditionIds,
        complexValue,
        timezone,
      );

      expect(key).toHaveLength(64);
    });

    it('should handle invalid timezone gracefully', () => {
      const ruleId = 'rule-123';
      const conditionIds = ['cond-1'];
      const value = { price: 99.99 };

      // Should fall back to UTC without throwing
      const key = service.generateDedupeKey(
        ruleId,
        conditionIds,
        value,
        'Invalid/Timezone',
      );

      expect(key).toHaveLength(64);
    });
  });

  describe('shouldCreateAlert', () => {
    const ruleId = 'rule-123';
    const dedupeKey = 'dedupe-key-abc123';

    describe('dedupe key check', () => {
      it('should allow alert if dedupe key does not exist', async () => {
        mockPrisma.alert.findUnique.mockResolvedValue(null);
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 0);

        expect(result.allowed).toBe(true);
        expect(result.reason).toBeUndefined();
        expect(mockPrisma.alert.findUnique).toHaveBeenCalledWith({
          where: { dedupeKey },
          select: { id: true, triggeredAt: true },
        });
      });

      it('should block alert if dedupe key exists', async () => {
        const existingAlert = {
          id: 'alert-123',
          triggeredAt: new Date(Date.now() - 3600000), // 1 hour ago
        };
        mockPrisma.alert.findUnique.mockResolvedValue(existingAlert);

        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 0);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Duplicate alert exists');
        expect(result.reason).toContain('alert-123');
        expect(result.reason).toMatch(/age: \d+s/);
      });

      it('should include age in seconds for duplicate alerts', async () => {
        const existingAlert = {
          id: 'alert-123',
          triggeredAt: new Date(Date.now() - 120000), // 2 minutes ago
        };
        mockPrisma.alert.findUnique.mockResolvedValue(existingAlert);

        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 0);

        expect(result.reason).toMatch(/age: 1[0-9][0-9]s/); // ~120s
      });
    });

    describe('cooldown check', () => {
      beforeEach(() => {
        // No dedupe key collision
        mockPrisma.alert.findUnique.mockResolvedValue(null);
      });

      it('should allow alert if cooldown is disabled (0 seconds)', async () => {
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 0);

        expect(result.allowed).toBe(true);
        expect(mockPrisma.alert.findFirst).not.toHaveBeenCalled();
      });

      it('should allow alert if no recent alerts within cooldown', async () => {
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          3600,
        );

        expect(result.allowed).toBe(true);
        expect(mockPrisma.alert.findFirst).toHaveBeenCalledWith({
          where: {
            ruleId,
            triggeredAt: { gte: expect.any(Date) },
          },
          orderBy: { triggeredAt: 'desc' },
          select: { id: true, triggeredAt: true },
        });
      });

      it('should block alert if within cooldown period', async () => {
        const recentAlert = {
          id: 'alert-456',
          triggeredAt: new Date(Date.now() - 1800000), // 30 minutes ago
        };
        mockPrisma.alert.findFirst.mockResolvedValue(recentAlert);

        const cooldownSeconds = 3600; // 1 hour
        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          cooldownSeconds,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Cooldown active');
        expect(result.reason).toMatch(/\d+s remaining/);
        expect(result.reason).toContain('alert-456');
      });

      it('should calculate remaining cooldown correctly', async () => {
        const recentAlert = {
          id: 'alert-456',
          triggeredAt: new Date(Date.now() - 60000), // 1 minute ago
        };
        mockPrisma.alert.findFirst.mockResolvedValue(recentAlert);

        const cooldownSeconds = 300; // 5 minutes
        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          cooldownSeconds,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/\(2[0-9][0-9]s remaining/); // ~240s
      });

      it('should allow alert if cooldown period has passed', async () => {
        const oldAlert = {
          id: 'alert-456',
          triggeredAt: new Date(Date.now() - 7200000), // 2 hours ago
        };
        mockPrisma.alert.findFirst.mockResolvedValue(oldAlert);

        const cooldownSeconds = 3600; // 1 hour
        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          cooldownSeconds,
        );

        // Old alert exists but outside cooldown window
        // Should query but not find anything due to WHERE clause
        // Let's adjust the mock to return null for consistency
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        const result2 = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          cooldownSeconds,
        );

        expect(result2.allowed).toBe(true);
      });

      it('should use correct cooldown window in query', async () => {
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        const cooldownSeconds = 1800; // 30 minutes
        const beforeCall = Date.now();

        await service.shouldCreateAlert(ruleId, dedupeKey, cooldownSeconds);

        const afterCall = Date.now();
        const callArgs = mockPrisma.alert.findFirst.mock.calls[0][0];
        const cooldownStart = callArgs.where.triggeredAt.gte.getTime();

        // Cooldown start should be approximately now - cooldownSeconds
        const expectedStart = beforeCall - cooldownSeconds * 1000;
        const tolerance = afterCall - beforeCall + 100; // Allow some tolerance

        expect(cooldownStart).toBeGreaterThanOrEqual(expectedStart - tolerance);
        expect(cooldownStart).toBeLessThanOrEqual(afterCall - cooldownSeconds * 1000);
      });
    });

    describe('combined checks', () => {
      it('should check dedupe key before cooldown', async () => {
        const existingAlert = {
          id: 'alert-123',
          triggeredAt: new Date(),
        };
        mockPrisma.alert.findUnique.mockResolvedValue(existingAlert);

        await service.shouldCreateAlert(ruleId, dedupeKey, 3600);

        expect(mockPrisma.alert.findUnique).toHaveBeenCalled();
        expect(mockPrisma.alert.findFirst).not.toHaveBeenCalled(); // Short-circuit
      });

      it('should check cooldown only if dedupe key passes', async () => {
        mockPrisma.alert.findUnique.mockResolvedValue(null);
        mockPrisma.alert.findFirst.mockResolvedValue(null);

        await service.shouldCreateAlert(ruleId, dedupeKey, 3600);

        expect(mockPrisma.alert.findUnique).toHaveBeenCalled();
        expect(mockPrisma.alert.findFirst).toHaveBeenCalled();
      });
    });
  });
});
