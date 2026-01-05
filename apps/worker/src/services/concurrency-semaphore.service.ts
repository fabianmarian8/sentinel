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
   * Paid providers with per-hostname concurrency limits
   * Key: provider ID, Value: max concurrent requests per hostname
   */
  private readonly paidProviderLimits: Record<string, number> = {
    brightdata: 2, // Per-hostname limit
    scraping_browser: 1,
    twocaptcha_proxy: 2,
    twocaptcha_datadome: 1,
  };

  /**
   * Global concurrency limits (across all hostnames)
   * For trial accounts with global rate limits
   * Key: provider ID, Value: max total concurrent requests
   */
  private readonly globalProviderLimits: Record<string, number> = {
    brightdata: 2, // Trial account has ~2 concurrent global limit
  };

  /**
   * Per-provider lease TTL in seconds - auto-release on crash
   *
   * Formula: ceil(timeoutMs/1000) + max(90, ceil(timeoutMs/1000 * 0.25))
   * This ensures TTL > max expected request duration with safety buffer
   *
   * Based on DEFAULT_PROVIDER_TIMEOUTS from tier-policy.ts:
   * - brightdata: 90s timeout → 90 + max(90, 23) = 180s TTL
   * - scraping_browser: 120s timeout → 120 + max(90, 30) = 210s TTL
   * - twocaptcha_proxy/datadome: 180s timeout → 180 + max(90, 45) = 270s TTL
   */
  private readonly providerTtlSec: Record<string, number> = {
    brightdata: 180,          // 90s timeout + 90s buffer
    scraping_browser: 210,    // 120s timeout + 90s buffer
    twocaptcha_proxy: 270,    // 180s timeout + 90s buffer
    twocaptcha_datadome: 270, // 180s timeout + 90s buffer
  };

  /**
   * Default lease TTL for unknown providers
   */
  private readonly DEFAULT_LEASE_TTL_SEC = 150; // Conservative default

  /**
   * Get lease TTL for a specific provider
   */
  private getLeaseTtl(provider: ProviderId): number {
    return this.providerTtlSec[provider] ?? this.DEFAULT_LEASE_TTL_SEC;
  }

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
   * Generate Redis key for per-hostname concurrency semaphore
   */
  private getKey(hostname: string, provider: ProviderId): string {
    return `concurrency:${provider}:${hostname}`;
  }

  /**
   * Generate Redis key for global provider concurrency
   */
  private getGlobalKey(provider: ProviderId): string {
    return `concurrency:${provider}:__global__`;
  }

  /**
   * Check if provider has global concurrency limit
   */
  hasGlobalLimit(provider: ProviderId): boolean {
    return provider in this.globalProviderLimits;
  }

  /**
   * Get max global concurrent requests for provider
   */
  getMaxGlobalConcurrent(provider: ProviderId): number {
    return this.globalProviderLimits[provider] ?? Infinity;
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
   * Checks BOTH global limit and per-hostname limit
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
    // Get provider-specific TTL
    const ttlSec = this.getLeaseTtl(provider);

    // First check global limit (for trial accounts)
    const maxGlobal = this.getMaxGlobalConcurrent(provider);
    if (maxGlobal !== Infinity) {
      const globalResult = await this.tryAcquireInternal(
        this.getGlobalKey(provider),
        `${leaseId}:global`,
        maxGlobal,
        ttlSec,
      );
      if (!globalResult.acquired) {
        this.logger.debug(
          `[Concurrency] ${provider} global limit reached (${globalResult.currentCount}/${maxGlobal}), suggest wait ${globalResult.waitSuggestionMs}ms`,
        );
        return globalResult;
      }
    }

    // Then check per-hostname limit
    const maxConcurrent = this.getMaxConcurrent(provider);
    if (maxConcurrent === Infinity) {
      return { acquired: true, currentCount: 0 };
    }

    const key = this.getKey(hostname, provider);
    const result = await this.tryAcquireInternal(key, leaseId, maxConcurrent, ttlSec);

    // If per-hostname failed but we acquired global, release global
    if (!result.acquired && maxGlobal !== Infinity) {
      await this.redis.zrem(this.getGlobalKey(provider), `${leaseId}:global`);
    }

    return result;
  }

  /**
   * Internal method for atomic lease acquisition
   *
   * @param key - Redis key for this semaphore
   * @param leaseId - Unique lease identifier
   * @param maxConcurrent - Max concurrent leases allowed
   * @param ttlSec - Lease TTL in seconds (provider-specific)
   */
  private async tryAcquireInternal(
    key: string,
    leaseId: string,
    maxConcurrent: number,
    ttlSec: number,
  ): Promise<{ acquired: boolean; currentCount: number; waitSuggestionMs?: number }> {

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
        ttlSec,
        nowSec,
      )) as number[];

      const acquired = result[0] === 1;
      const currentCount = result[1];
      const waitSuggestionMs = result[2];

      if (!acquired) {
        this.logger.debug(
          `[Concurrency] ${key} at capacity (${currentCount}/${maxConcurrent}), suggest wait ${waitSuggestionMs}ms`,
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
   * Releases BOTH global and per-hostname leases
   *
   * @param hostname - Target hostname
   * @param provider - Provider ID
   * @param leaseId - Unique identifier for this lease
   */
  async release(hostname: string, provider: ProviderId, leaseId: string): Promise<void> {
    if (!this.hasConcurrencyLimit(provider) && !this.hasGlobalLimit(provider)) {
      return;
    }

    try {
      // Release per-hostname lease
      if (this.hasConcurrencyLimit(provider)) {
        const key = this.getKey(hostname, provider);
        await this.redis.zrem(key, leaseId);
      }

      // Release global lease
      if (this.hasGlobalLimit(provider)) {
        const globalKey = this.getGlobalKey(provider);
        await this.redis.zrem(globalKey, `${leaseId}:global`);
      }

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
