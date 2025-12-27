import { Test, TestingModule } from '@nestjs/testing';
import { RateLimiterService } from './rate-limiter.service';
import { WorkerConfigService } from '../config/config.service';

describe('RateLimiterService', () => {
  let service: RateLimiterService;
  let mockRedis: any;
  let mockConfigService: any;

  beforeEach(async () => {
    // Mock Redis instance
    mockRedis = {
      eval: jest.fn(),
      hmget: jest.fn(),
      hmset: jest.fn(),
      hgetall: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    };

    // Mock Redis constructor
    jest.mock('ioredis', () => {
      return jest.fn(() => mockRedis);
    });

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
        RateLimiterService,
        {
          provide: WorkerConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<RateLimiterService>(RateLimiterService);

    // Replace the real Redis instance with our mock
    (service as any).redis = mockRedis;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('consumeToken', () => {
    const domain = 'example.com';

    it('should allow request when tokens available', async () => {
      // Mock Redis eval to return [1, 2] = allowed, 2 tokens remaining
      mockRedis.eval.mockResolvedValue([1, 2]);

      const result = await service.consumeToken(domain, 'http');

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(2);
      expect(result.retryAfterMs).toBeUndefined();
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('local key = KEYS[1]'),
        1,
        'ratelimit:http:example.com',
        expect.any(Number), // now
        0.2, // 12 requests/min = 0.2 tokens/sec
        3, // burstSize
      );
    });

    it('should deny request when tokens exhausted', async () => {
      // Mock Redis eval to return [0, 0.5, 2500] = denied, 0.5 tokens, wait 2500ms
      mockRedis.eval.mockResolvedValue([0, 0.5, 2500]);

      const result = await service.consumeToken(domain, 'http');

      expect(result.allowed).toBe(false);
      expect(result.remainingTokens).toBe(0.5);
      expect(result.retryAfterMs).toBe(2500);
    });

    it('should use correct rate for http mode', async () => {
      mockRedis.eval.mockResolvedValue([1, 2]);

      await service.consumeToken(domain, 'http');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:http:example.com',
        expect.any(Number),
        0.2, // 12 requests/min = 0.2 tokens/sec
        3,
      );
    });

    it('should use correct rate for headless mode', async () => {
      mockRedis.eval.mockResolvedValue([1, 2]);

      await service.consumeToken(domain, 'headless');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:headless:example.com',
        expect.any(Number),
        0.06666666666666667, // 4 requests/min = ~0.067 tokens/sec
        3,
      );
    });

    it('should generate correct Redis key for http mode', async () => {
      mockRedis.eval.mockResolvedValue([1, 2]);

      await service.consumeToken(domain, 'http');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:http:example.com',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should generate correct Redis key for headless mode', async () => {
      mockRedis.eval.mockResolvedValue([1, 2]);

      await service.consumeToken(domain, 'headless');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:headless:example.com',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('should fail open on Redis error', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Redis connection failed'));

      const result = await service.consumeToken(domain, 'http');

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(3); // default burstSize
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('should round up retry time to nearest ms', async () => {
      mockRedis.eval.mockResolvedValue([0, 0, 2500.7]);

      const result = await service.consumeToken(domain, 'http');

      expect(result.retryAfterMs).toBe(2501);
    });

    it('should handle different domains independently', async () => {
      mockRedis.eval.mockResolvedValue([1, 2]);

      await service.consumeToken('domain1.com', 'http');
      await service.consumeToken('domain2.com', 'http');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:http:domain1.com',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        'ratelimit:http:domain2.com',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  describe('checkLimit', () => {
    const domain = 'example.com';

    it('should check limit without consuming token', async () => {
      mockRedis.hmget.mockResolvedValue(['2.5', String(Date.now())]);

      const result = await service.checkLimit(domain, 'http');

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBeGreaterThan(2);
      expect(mockRedis.eval).not.toHaveBeenCalled(); // Should not call eval
    });

    it('should return default tokens if key does not exist', async () => {
      mockRedis.hmget.mockResolvedValue([null, null]);

      const result = await service.checkLimit(domain, 'http');

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(3); // default burstSize
    });

    it('should calculate tokens with elapsed time', async () => {
      const now = Date.now();
      const lastRefill = now - 5000; // 5 seconds ago
      mockRedis.hmget.mockResolvedValue(['0', String(lastRefill)]);

      const result = await service.checkLimit(domain, 'http');

      // 0 tokens + (5s * 0.2 tokens/s) = 1 token
      expect(result.remainingTokens).toBeCloseTo(1, 1);
      expect(result.allowed).toBe(true);
    });

    it('should cap tokens at maxTokens (burstSize)', async () => {
      const now = Date.now();
      const lastRefill = now - 60000; // 1 minute ago
      mockRedis.hmget.mockResolvedValue(['0', String(lastRefill)]);

      const result = await service.checkLimit(domain, 'http');

      // Should be capped at 3, not 12
      expect(result.remainingTokens).toBe(3);
    });

    it('should calculate retryAfterMs when tokens insufficient', async () => {
      const now = Date.now();
      mockRedis.hmget.mockResolvedValue(['0.5', String(now)]);

      const result = await service.checkLimit(domain, 'http');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      // Need 0.5 more tokens, at 0.2 tokens/sec = 2.5s = 2500ms
      expect(result.retryAfterMs).toBeCloseTo(2500, 0);
    });

    it('should fail open on Redis error', async () => {
      mockRedis.hmget.mockRejectedValue(new Error('Redis error'));

      const result = await service.checkLimit(domain, 'http');

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(3);
    });
  });

  describe('getDomainStatus', () => {
    const domain = 'example.com';

    it('should return status for both modes', async () => {
      mockRedis.hmget.mockResolvedValue(['2', String(Date.now())]);

      const status = await service.getDomainStatus(domain);

      expect(status.domain).toBe(domain);
      expect(status.http).toBeDefined();
      expect(status.headless).toBeDefined();
      expect(status.http.allowed).toBe(true);
      expect(status.headless.allowed).toBe(true);
    });

    it('should call checkLimit twice in parallel', async () => {
      mockRedis.hmget.mockResolvedValue(['2', String(Date.now())]);

      await service.getDomainStatus(domain);

      expect(mockRedis.hmget).toHaveBeenCalledTimes(2);
      expect(mockRedis.hmget).toHaveBeenCalledWith(
        'ratelimit:http:example.com',
        'tokens',
        'lastRefill',
      );
      expect(mockRedis.hmget).toHaveBeenCalledWith(
        'ratelimit:headless:example.com',
        'tokens',
        'lastRefill',
      );
    });
  });

  describe('setDomainConfig', () => {
    const domain = 'example.com';

    it('should set custom config in Redis', async () => {
      mockRedis.hmset.mockResolvedValue('OK');

      const customConfig = {
        httpRequestsPerMinute: 24,
        burstSize: 5,
      };

      await service.setDomainConfig(domain, customConfig);

      expect(mockRedis.hmset).toHaveBeenCalledWith(
        'ratelimit:config:example.com',
        customConfig,
      );
    });

    it('should throw error if Redis fails', async () => {
      mockRedis.hmset.mockRejectedValue(new Error('Redis error'));

      await expect(
        service.setDomainConfig(domain, { burstSize: 5 }),
      ).rejects.toThrow('Redis error');
    });
  });

  describe('getDomainConfig', () => {
    const domain = 'example.com';

    it('should return default config if no custom config exists', async () => {
      mockRedis.hgetall.mockResolvedValue({});

      const config = await service.getDomainConfig(domain);

      expect(config).toEqual({
        httpRequestsPerMinute: 12,
        headlessRequestsPerMinute: 4,
        burstSize: 3,
      });
    });

    it('should merge custom config with defaults', async () => {
      mockRedis.hgetall.mockResolvedValue({
        httpRequestsPerMinute: '24',
        burstSize: '5',
      });

      const config = await service.getDomainConfig(domain);

      expect(config).toEqual({
        httpRequestsPerMinute: 24,
        headlessRequestsPerMinute: 4, // default
        burstSize: 5,
      });
    });

    it('should convert string values to numbers', async () => {
      mockRedis.hgetall.mockResolvedValue({
        httpRequestsPerMinute: '100',
        headlessRequestsPerMinute: '20',
        burstSize: '10',
      });

      const config = await service.getDomainConfig(domain);

      expect(typeof config.httpRequestsPerMinute).toBe('number');
      expect(typeof config.headlessRequestsPerMinute).toBe('number');
      expect(typeof config.burstSize).toBe('number');
      expect(config.httpRequestsPerMinute).toBe(100);
    });

    it('should return default config on Redis error', async () => {
      mockRedis.hgetall.mockRejectedValue(new Error('Redis error'));

      const config = await service.getDomainConfig(domain);

      expect(config).toEqual({
        httpRequestsPerMinute: 12,
        headlessRequestsPerMinute: 4,
        burstSize: 3,
      });
    });
  });

  describe('onModuleDestroy', () => {
    it('should close Redis connection gracefully', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
