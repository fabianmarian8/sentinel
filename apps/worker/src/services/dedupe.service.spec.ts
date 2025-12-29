import { Test, TestingModule } from '@nestjs/testing';
import { DedupeService } from './dedupe.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerConfigService } from '../config/config.service';
import { createHash } from 'crypto';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    ttl: jest.fn(),
    on: jest.fn(),
    quit: jest.fn(),
  }));
});

describe('DedupeService', () => {
  let service: DedupeService;
  let mockPrisma: any;
  let mockRedis: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockPrisma = {
      alert: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    mockConfigService = {
      redis: {
        host: 'localhost',
        port: 6379,
        password: undefined,
        db: 0,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DedupeService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: WorkerConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<DedupeService>(DedupeService);
    // Get the mocked Redis instance
    mockRedis = (service as any).redis;
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
        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 0);

        expect(result.allowed).toBe(true);
        expect(mockRedis.set).not.toHaveBeenCalled();
      });

      it('should allow alert if cooldown acquired (Redis SETNX success)', async () => {
        // SETNX returns 'OK' when key was set (cooldown acquired)
        mockRedis.set.mockResolvedValue('OK');

        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          3600,
        );

        expect(result.allowed).toBe(true);
        expect(mockRedis.set).toHaveBeenCalledWith(
          `cooldown:${ruleId}`,
          expect.any(String),
          'EX',
          3600,
          'NX',
        );
      });

      it('should block alert if cooldown active (Redis SETNX fails)', async () => {
        // SETNX returns null when key already exists (cooldown active)
        mockRedis.set.mockResolvedValue(null);
        mockRedis.ttl.mockResolvedValue(1800); // 30 minutes remaining

        const cooldownSeconds = 3600; // 1 hour
        const result = await service.shouldCreateAlert(
          ruleId,
          dedupeKey,
          cooldownSeconds,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Cooldown active');
        expect(result.reason).toContain('1800s remaining');
        expect(mockRedis.ttl).toHaveBeenCalledWith(`cooldown:${ruleId}`);
      });

      it('should use correct Redis key format', async () => {
        mockRedis.set.mockResolvedValue('OK');

        await service.shouldCreateAlert(ruleId, dedupeKey, 300);

        expect(mockRedis.set).toHaveBeenCalledWith(
          'cooldown:rule-123',
          expect.any(String),
          'EX',
          300,
          'NX',
        );
      });

      it('should set correct TTL in Redis', async () => {
        mockRedis.set.mockResolvedValue('OK');

        const cooldownSeconds = 1800;
        await service.shouldCreateAlert(ruleId, dedupeKey, cooldownSeconds);

        const call = mockRedis.set.mock.calls[0];
        expect(call[2]).toBe('EX'); // Expiry type
        expect(call[3]).toBe(1800); // TTL in seconds
        expect(call[4]).toBe('NX'); // Set if Not eXists
      });

      it('should fail open on Redis error', async () => {
        // Simulate Redis error
        mockRedis.set.mockRejectedValue(new Error('Redis connection failed'));

        const result = await service.shouldCreateAlert(ruleId, dedupeKey, 3600);

        // Should allow alert on error (fail open)
        expect(result.allowed).toBe(true);
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
        expect(mockRedis.set).not.toHaveBeenCalled(); // Short-circuit
      });

      it('should check cooldown only if dedupe key passes', async () => {
        mockPrisma.alert.findUnique.mockResolvedValue(null);
        mockRedis.set.mockResolvedValue('OK');

        await service.shouldCreateAlert(ruleId, dedupeKey, 3600);

        expect(mockPrisma.alert.findUnique).toHaveBeenCalled();
        expect(mockRedis.set).toHaveBeenCalled();
      });
    });
  });
});
