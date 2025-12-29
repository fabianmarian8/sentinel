import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerConfigService } from '../config/config.service';

/**
 * Deduplication service for alert spam prevention
 *
 * Implements two-level deduplication:
 * 1. Dedupe key: Prevents exact same alert (same rule + conditions + value + day)
 * 2. Cooldown: Rate limits alerts for same rule (using Redis SETNX for atomicity)
 */
@Injectable()
export class DedupeService implements OnModuleDestroy {
  private readonly logger = new Logger(DedupeService.name);
  private readonly redis: Redis;

  constructor(
    private prisma: PrismaService,
    private configService: WorkerConfigService,
  ) {
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
      this.logger.log('Redis connected for deduplication');
    });
  }

  /**
   * Generate deduplication key for a specific day bucket
   *
   * Key components:
   * - ruleId: Which rule triggered
   * - conditionIds: Which specific conditions were met (sorted for stability)
   * - normalizedValue: What value triggered (hashed for privacy/size)
   * - dayBucket: What day in workspace timezone (to allow re-alerting next day)
   *
   * @param ruleId - The rule ID
   * @param conditionIds - Array of triggered condition IDs (sorted internally)
   * @param normalizedValue - The normalized value that triggered the alert
   * @param dayBucket - Day bucket string (YYYY-MM-DD)
   * @returns SHA256 hash dedupe key
   */
  private generateDedupeKeyForBucket(
    ruleId: string,
    conditionIds: string[],
    normalizedValue: any,
    dayBucket: string,
  ): string {
    // Hash the normalized value (stable representation)
    const valueHash = createHash('sha256')
      .update(JSON.stringify(normalizedValue))
      .digest('hex')
      .substring(0, 16); // First 16 chars is sufficient

    // Build composite key
    const data = `${ruleId}:${conditionIds.sort().join(',')}:${valueHash}:${dayBucket}`;

    // Return final hash
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Generate deduplication key (primary, for storing new alerts)
   *
   * @param ruleId - The rule ID
   * @param conditionIds - Array of triggered condition IDs
   * @param normalizedValue - The normalized value that triggered the alert
   * @param timezone - Workspace timezone (e.g., "Europe/Bratislava")
   * @returns SHA256 hash dedupe key
   */
  generateDedupeKey(
    ruleId: string,
    conditionIds: string[],
    normalizedValue: any,
    timezone: string,
  ): string {
    const dayBucket = this.getDayBucket(timezone);
    return this.generateDedupeKeyForBucket(ruleId, conditionIds, normalizedValue, dayBucket);
  }

  /**
   * Generate all deduplication keys for checking (includes overlap window)
   *
   * Returns keys for current day and previous day (if in overlap window).
   * Use this for duplicate checking to prevent alerts at day boundaries.
   *
   * @param ruleId - The rule ID
   * @param conditionIds - Array of triggered condition IDs
   * @param normalizedValue - The normalized value that triggered the alert
   * @param timezone - Workspace timezone (e.g., "Europe/Bratislava")
   * @returns Array of SHA256 hash dedupe keys
   */
  generateDedupeKeysForCheck(
    ruleId: string,
    conditionIds: string[],
    normalizedValue: any,
    timezone: string,
  ): string[] {
    const dayBuckets = this.getDayBuckets(timezone);
    return dayBuckets.map((bucket) =>
      this.generateDedupeKeyForBucket(ruleId, conditionIds, normalizedValue, bucket),
    );
  }

  /**
   * Overlap window in hours around midnight
   * If we're in the first OVERLAP_HOURS of the day, also check previous day
   */
  private readonly OVERLAP_HOURS = 4;

  /**
   * Get day buckets for deduplication with midnight overlap
   *
   * Returns current day bucket, plus previous day bucket if within
   * OVERLAP_HOURS of midnight (to prevent duplicate alerts at day boundary).
   *
   * @param timezone - IANA timezone string (e.g., "Europe/Bratislava")
   * @returns Array of date strings in YYYY-MM-DD format (1-2 buckets)
   */
  getDayBuckets(timezone: string): string[] {
    const validTimezone = this.validateTimezone(timezone);
    const now = new Date();

    try {
      // Get current day in workspace timezone
      const currentDay = now.toLocaleDateString('en-CA', { timeZone: validTimezone });

      // Get current hour in workspace timezone
      const hourStr = now.toLocaleTimeString('en-US', {
        timeZone: validTimezone,
        hour: 'numeric',
        hour12: false,
      });
      const currentHour = parseInt(hourStr, 10);

      // If we're in the overlap window (first N hours of day), include previous day
      if (currentHour < this.OVERLAP_HOURS) {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const previousDay = yesterday.toLocaleDateString('en-CA', { timeZone: validTimezone });
        return [currentDay, previousDay];
      }

      return [currentDay];
    } catch (error) {
      this.logger.warn(
        `Error getting day buckets for timezone "${validTimezone}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return [now.toISOString().split('T')[0]];
    }
  }

  /**
   * Get primary day bucket (for new alert creation)
   *
   * @param timezone - IANA timezone string
   * @returns Date string in YYYY-MM-DD format
   */
  private getDayBucket(timezone: string): string {
    return this.getDayBuckets(timezone)[0];
  }

  /**
   * Validate timezone string
   *
   * @param timezone - IANA timezone string to validate
   * @returns Valid timezone string (input or UTC fallback)
   */
  private validateTimezone(timezone: string): string {
    try {
      // Test if timezone is valid by attempting to use it
      new Date().toLocaleDateString('en-CA', { timeZone: timezone });
      return timezone;
    } catch {
      this.logger.warn(
        `Invalid timezone "${timezone}", falling back to UTC`,
      );
      return 'UTC';
    }
  }

  /**
   * Check if alert should be created
   *
   * Applies two checks:
   * 1. Dedupe key uniqueness - prevent exact duplicate alerts (checks all keys for overlap)
   * 2. Cooldown period - rate limit alerts for same rule (atomic Redis SETNX)
   *
   * @param ruleId - The rule ID
   * @param dedupeKeys - Generated dedupe keys (array for overlap window support)
   * @param cooldownSeconds - Cooldown period in seconds (0 = disabled)
   * @returns Object with allowed flag and optional reason
   */
  async shouldCreateAlert(
    ruleId: string,
    dedupeKeys: string | string[],
    cooldownSeconds: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Normalize to array for uniform handling
    const keysToCheck = Array.isArray(dedupeKeys) ? dedupeKeys : [dedupeKeys];

    // Check 1: Dedupe key uniqueness - check all keys (for overlap window)
    for (const dedupeKey of keysToCheck) {
      const existingByKey = await this.prisma.alert.findUnique({
        where: { dedupeKey },
        select: { id: true, triggeredAt: true },
      });

      if (existingByKey) {
        const age = Math.floor(
          (Date.now() - existingByKey.triggeredAt.getTime()) / 1000,
        );
        return {
          allowed: false,
          reason: `Duplicate alert exists (id: ${existingByKey.id}, age: ${age}s)`,
        };
      }
    }

    // Check 2: Cooldown period - atomic Redis SETNX
    if (cooldownSeconds > 0) {
      const cooldownKey = `cooldown:${ruleId}`;

      try {
        // Atomically: SET if Not eXists with TTL
        // Returns 'OK' if key was set (cooldown acquired)
        // Returns null if key already exists (cooldown active)
        const result = await this.redis.set(
          cooldownKey,
          Date.now().toString(),
          'EX',
          cooldownSeconds,
          'NX',
        );

        if (result !== 'OK') {
          // Cooldown active - another alert already acquired it
          const ttl = await this.redis.ttl(cooldownKey);
          return {
            allowed: false,
            reason: `Cooldown active (${ttl}s remaining)`,
          };
        }

        // Cooldown acquired for this alert
        this.logger.debug(`Cooldown acquired for rule ${ruleId} (${cooldownSeconds}s)`);
      } catch (error) {
        // Fail open - allow alert on Redis error
        this.logger.error(
          `Redis cooldown check failed for rule ${ruleId}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        // Continue to allow alert creation
      }
    }

    return { allowed: true };
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async onModuleDestroy() {
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}
