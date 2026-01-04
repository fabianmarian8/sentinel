import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { WorkerConfigService } from '../config/config.service';
import type { ProviderId } from '../types/fetch-result';

/**
 * Concurrency semaphore for paid providers
 *
 * Problem: BrightData requests take 30-90s. Concurrent requests to same hostname
 * cause increased latency and timeouts due to provider-side queuing.
 *
 * Solution: Redis-based semaphore with TTL-protected leases.
 * - Max 1 in-flight request per (hostname, provider) for paid providers
 * - TTL ensures automatic release on worker crash
 * - Non-blocking check for rate limiter integration
 */
@Injectable()
export class ConcurrencySemaphoreService {
  private readonly logger = new Logger(ConcurrencySemaphoreService.name);
  private readonly redis: Redis;

  /**
   * Paid providers with concurrency limits
   * Key: provider ID, Value: max concurrent requests per hostname
   */
  private readonly paidProviderLimits: Record<string, number> = {
    brightdata: 2, // Increased from 1 - verified account handles 2 concurrent
    scraping_browser: 1,
    twocaptcha_proxy: 2,
    twocaptcha_datadome: 1,
  };

  /**
   * Lease TTL in seconds - auto-release on crash
   * Should be > max expected request duration (60s timeout + 30s buffer)
   */
  private readonly LEASE_TTL_SEC = 90;

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
  }

  /**
   * Generate Redis key for concurrency semaphore
   */
  private getKey(hostname: string, provider: ProviderId): string {
    return `concurrency:${provider}:${hostname}`;
  }

  /**
   * Check if provider has concurrency limit
   */
  hasConcurrencyLimit(provider: ProviderId): boolean {
    return provider in this.paidProviderLimits;
  }

  /**
   * Get max concurrent requests for provider
   */
  getMaxConcurrent(provider: ProviderId): number {
    return this.paidProviderLimits[provider] ?? Infinity;
  }

  /**
   * Try to acquire a lease for executing a request
   *
   * @param hostname - Target hostname
   * @param provider - Provider ID
   * @param leaseId - Unique identifier for this lease (e.g., job ID)
   * @returns Object with acquired flag and optional wait time suggestion
   */
  async tryAcquire(
    hostname: string,
    provider: ProviderId,
    leaseId: string,
  ): Promise<{ acquired: boolean; currentCount: number; waitSuggestionMs?: number }> {
    const maxConcurrent = this.getMaxConcurrent(provider);
    if (maxConcurrent === Infinity) {
      return { acquired: true, currentCount: 0 };
    }

    const key = this.getKey(hostname, provider);

    // Lua script for atomic check-and-increment with TTL refresh
    const script = `
      local key = KEYS[1]
      local leaseId = ARGV[1]
      local maxConcurrent = tonumber(ARGV[2])
      local ttlSec = tonumber(ARGV[3])
      local now = tonumber(ARGV[4])

      -- Clean expired leases first
      redis.call('ZREMRANGEBYSCORE', key, '-inf', now)

      -- Get current count
      local currentCount = redis.call('ZCARD', key)

      if currentCount < maxConcurrent then
        -- Add lease with expiry timestamp
        local expiresAt = now + ttlSec
        redis.call('ZADD', key, expiresAt, leaseId)
        redis.call('EXPIRE', key, ttlSec + 60) -- Key TTL with buffer
        return {1, currentCount + 1}
      else
        -- Get oldest lease expiry to suggest wait time
        local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
        local oldestExpiry = oldest[2] and tonumber(oldest[2]) or (now + 60)
        local waitMs = math.max(0, (oldestExpiry - now) * 1000)
        return {0, currentCount, waitMs}
      end
    `;

    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const result = (await this.redis.eval(
        script,
        1,
        key,
        leaseId,
        maxConcurrent,
        this.LEASE_TTL_SEC,
        nowSec,
      )) as number[];

      const acquired = result[0] === 1;
      const currentCount = result[1];
      const waitSuggestionMs = result[2];

      if (!acquired) {
        this.logger.debug(
          `[Concurrency] ${provider}@${hostname} at capacity (${currentCount}/${maxConcurrent}), suggest wait ${waitSuggestionMs}ms`,
        );
      }

      return {
        acquired,
        currentCount,
        waitSuggestionMs: acquired ? undefined : waitSuggestionMs,
      };
    } catch (error) {
      this.logger.error(
        `[Concurrency] Failed to acquire lease: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Fail-open for availability, but log for monitoring
      return { acquired: true, currentCount: 0 };
    }
  }

  /**
   * Release a lease after request completion
   *
   * @param hostname - Target hostname
   * @param provider - Provider ID
   * @param leaseId - Unique identifier for this lease
   */
  async release(hostname: string, provider: ProviderId, leaseId: string): Promise<void> {
    if (!this.hasConcurrencyLimit(provider)) {
      return;
    }

    const key = this.getKey(hostname, provider);

    try {
      await this.redis.zrem(key, leaseId);
      this.logger.debug(`[Concurrency] Released lease ${leaseId} for ${provider}@${hostname}`);
    } catch (error) {
      this.logger.error(
        `[Concurrency] Failed to release lease: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Get current in-flight count for monitoring
   */
  async getCurrentCount(hostname: string, provider: ProviderId): Promise<number> {
    const key = this.getKey(hostname, provider);
    const nowSec = Math.floor(Date.now() / 1000);

    try {
      // Clean expired and count
      await this.redis.zremrangebyscore(key, '-inf', nowSec);
      return await this.redis.zcard(key);
    } catch (error) {
      this.logger.error(
        `[Concurrency] Failed to get count: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
