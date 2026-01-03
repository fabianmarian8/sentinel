import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { WorkerConfigService } from '../config/config.service';
import type { ProviderId } from '../types/fetch-result';

/**
 * Rate limiting configuration per domain
 */
export interface RateLimitConfig {
  httpRequestsPerMinute: number; // default 12 (1 per 5s)
  headlessRequestsPerMinute: number; // default 4 (1 per 15s)
  paidRequestsPerMinute: number; // default 2 (1 per 30s) - for paid providers
  burstSize: number; // default 3
  paidBurstSize: number; // default 1 - conservative for paid providers
}

/**
 * Result of rate limit check/consumption
 */
export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
  remainingTokens: number;
}

/**
 * Domain rate limit status for both modes
 */
export interface DomainRateLimitStatus {
  domain: string;
  http: RateLimitResult;
  headless: RateLimitResult;
}

/**
 * Rate limiter service using Redis-based token bucket algorithm
 *
 * Implements per-domain rate limiting for fetch operations:
 * - HTTP mode: 12 requests/min (1 per 5s) with burst of 3
 * - Headless mode: 4 requests/min (1 per 15s) with burst of 3
 *
 * Token bucket algorithm ensures smooth rate limiting with burst allowance
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: Redis;
  private readonly defaultConfig: RateLimitConfig = {
    httpRequestsPerMinute: 12, // 1 per 5 seconds
    headlessRequestsPerMinute: 4, // 1 per 15 seconds
    paidRequestsPerMinute: 2, // 1 per 30 seconds - conservative for paid providers
    burstSize: 3,
    paidBurstSize: 1, // No burst for paid providers - cost control
  };

  /**
   * Paid providers that incur costs per request
   */
  private readonly paidProviders: ProviderId[] = [
    'brightdata',
    'scraping_browser',
    'twocaptcha_proxy',
    'twocaptcha_datadome',
  ];

  constructor(private configService: WorkerConfigService) {
    const redisConfig = this.configService.redis;
    this.redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      db: redisConfig.db,
      maxRetriesPerRequest: null,
    });

    this.redis.on('error', (error) => {
      this.logger.error(`Redis connection error: ${error.message}`, error.stack);
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis connected for rate limiter');
    });
  }

  /**
   * Generate Redis key for rate limit bucket
   */
  private getKey(domain: string, provider: ProviderId): string {
    return `ratelimit:${provider}:${domain}`;
  }

  /**
   * Check if provider is a paid provider
   */
  private isPaidProvider(provider: ProviderId): boolean {
    return this.paidProviders.includes(provider);
  }

  /**
   * Get token refill rate (tokens per second)
   */
  private getRefillRate(provider: ProviderId): number {
    if (this.isPaidProvider(provider)) {
      return this.defaultConfig.paidRequestsPerMinute / 60;
    }
    if (provider === 'http' || provider === 'mobile_ua') {
      return this.defaultConfig.httpRequestsPerMinute / 60;
    }
    // headless, flaresolverr
    return this.defaultConfig.headlessRequestsPerMinute / 60;
  }

  /**
   * Get max tokens (burst size) for provider
   */
  private getMaxTokens(provider: ProviderId): number {
    if (this.isPaidProvider(provider)) {
      return this.defaultConfig.paidBurstSize;
    }
    return this.defaultConfig.burstSize;
  }

  /**
   * Consume a token from the rate limit bucket
   *
   * Uses atomic Lua script to:
   * 1. Calculate tokens to add based on elapsed time
   * 2. Try to consume 1 token
   * 3. Return success/failure with retry time
   *
   * @param domain - The domain to rate limit
   * @param provider - Provider ID (determines rate limits)
   * @returns Result with allowed flag, remaining tokens, and optional retry time
   */
  async consumeToken(
    domain: string,
    provider: ProviderId,
  ): Promise<RateLimitResult> {
    const key = this.getKey(domain, provider);
    const now = Date.now();
    const refillRate = this.getRefillRate(provider);
    const maxTokens = this.getMaxTokens(provider);

    // Lua script for atomic token bucket implementation
    const script = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local refillRate = tonumber(ARGV[2])
      local maxTokens = tonumber(ARGV[3])

      -- Get current state
      local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(data[1]) or maxTokens
      local lastRefill = tonumber(data[2]) or now

      -- Calculate tokens to add
      local elapsed = (now - lastRefill) / 1000
      local tokensToAdd = elapsed * refillRate
      tokens = math.min(maxTokens, tokens + tokensToAdd)

      -- Try to consume
      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        redis.call('EXPIRE', key, 3600)  -- 1 hour TTL
        return {1, tokens}  -- allowed, remaining
      else
        -- Calculate wait time
        local waitTime = (1 - tokens) / refillRate * 1000
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
        redis.call('EXPIRE', key, 3600)
        return {0, tokens, waitTime}  -- denied, remaining, wait
      end
    `;

    try {
      const result = (await this.redis.eval(
        script,
        1,
        key,
        now,
        refillRate,
        maxTokens,
      )) as number[];

      const allowed = result[0] === 1;
      const remainingTokens = result[1];
      const retryAfterMs = result[2] ? Math.ceil(result[2]) : undefined;

      if (!allowed) {
        this.logger.debug(
          `Rate limit exceeded for ${domain} (${provider}), retry after ${retryAfterMs}ms`,
        );
      }

      return {
        allowed,
        remainingTokens,
        retryAfterMs,
      };
    } catch (error) {
      this.logger.error(
        `Failed to consume token for ${domain} (${provider}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Fail-closed for paid providers (cost protection)
      // Fail-open for free providers (availability)
      if (this.isPaidProvider(provider)) {
        this.logger.warn(
          `[RATE_LIMITER_DEGRADED_PAID] Redis error for paid provider ${provider}@${domain} - BLOCKING request`,
        );
        return {
          allowed: false,
          remainingTokens: 0,
          retryAfterMs: 60000, // Wait 1 minute before retry
        };
      }

      // Fail open for free providers
      return {
        allowed: true,
        remainingTokens: maxTokens,
      };
    }
  }

  /**
   * Check rate limit without consuming token
   *
   * Useful for pre-flight checks or status monitoring
   *
   * @param domain - The domain to check
   * @param provider - Provider ID (determines rate limits)
   * @returns Result with allowed flag, remaining tokens, and optional retry time
   */
  async checkLimit(
    domain: string,
    provider: ProviderId,
  ): Promise<RateLimitResult> {
    const key = this.getKey(domain, provider);
    const maxTokens = this.getMaxTokens(provider);

    try {
      const data = await this.redis.hmget(key, 'tokens', 'lastRefill');

      const now = Date.now();
      const refillRate = this.getRefillRate(provider);

      let tokens = data[0] ? parseFloat(data[0]) : maxTokens;
      const lastRefill = data[1] ? parseInt(data[1], 10) : now;

      const elapsed = (now - lastRefill) / 1000;
      tokens = Math.min(maxTokens, tokens + elapsed * refillRate);

      const allowed = tokens >= 1;
      const retryAfterMs = allowed
        ? undefined
        : Math.ceil(((1 - tokens) / refillRate) * 1000);

      return {
        allowed,
        remainingTokens: tokens,
        retryAfterMs,
      };
    } catch (error) {
      this.logger.error(
        `Failed to check limit for ${domain} (${provider}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Fail-closed for paid providers, fail-open for free
      if (this.isPaidProvider(provider)) {
        return {
          allowed: false,
          remainingTokens: 0,
          retryAfterMs: 60000,
        };
      }
      return {
        allowed: true,
        remainingTokens: maxTokens,
      };
    }
  }

  /**
   * Get rate limit status for both HTTP and headless modes
   *
   * @param domain - The domain to check
   * @returns Status for both modes
   */
  async getDomainStatus(domain: string): Promise<DomainRateLimitStatus> {
    const [httpStatus, headlessStatus] = await Promise.all([
      this.checkLimit(domain, 'http'),
      this.checkLimit(domain, 'headless'),
    ]);

    return {
      domain,
      http: httpStatus,
      headless: headlessStatus,
    };
  }

  /**
   * Set custom rate limit configuration for a domain
   *
   * @param domain - The domain to configure
   * @param config - Partial config to override defaults
   */
  async setDomainConfig(
    domain: string,
    config: Partial<RateLimitConfig>,
  ): Promise<void> {
    const key = `ratelimit:config:${domain}`;

    try {
      await this.redis.hmset(key, config as any);
      this.logger.log(`Custom rate limit config set for ${domain}`);
    } catch (error) {
      this.logger.error(
        `Failed to set domain config for ${domain}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  /**
   * Get rate limit configuration for a domain
   *
   * Merges default config with any custom overrides
   *
   * @param domain - The domain to get config for
   * @returns Merged configuration
   */
  async getDomainConfig(domain: string): Promise<RateLimitConfig> {
    const key = `ratelimit:config:${domain}`;

    try {
      const custom = await this.redis.hgetall(key);

      // Convert string values to numbers
      const customConfig: Partial<RateLimitConfig> = {};
      if (custom.httpRequestsPerMinute) {
        customConfig.httpRequestsPerMinute = parseInt(
          custom.httpRequestsPerMinute,
          10,
        );
      }
      if (custom.headlessRequestsPerMinute) {
        customConfig.headlessRequestsPerMinute = parseInt(
          custom.headlessRequestsPerMinute,
          10,
        );
      }
      if (custom.burstSize) {
        customConfig.burstSize = parseInt(custom.burstSize, 10);
      }

      return { ...this.defaultConfig, ...customConfig };
    } catch (error) {
      this.logger.error(
        `Failed to get domain config for ${domain}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return this.defaultConfig;
    }
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async onModuleDestroy() {
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}
