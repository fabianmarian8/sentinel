import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Deduplication service for alert spam prevention
 *
 * Implements two-level deduplication:
 * 1. Dedupe key: Prevents exact same alert (same rule + conditions + value + day)
 * 2. Cooldown: Rate limits alerts for same rule
 */
@Injectable()
export class DedupeService {
  private readonly logger = new Logger(DedupeService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Generate deduplication key
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
   * @param timezone - Workspace timezone (e.g., "Europe/Bratislava")
   * @returns SHA256 hash dedupe key
   */
  generateDedupeKey(
    ruleId: string,
    conditionIds: string[],
    normalizedValue: any,
    timezone: string,
  ): string {
    // Get day bucket in workspace timezone
    const dayBucket = this.getDayBucket(timezone);

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
   * Get day bucket in workspace timezone
   *
   * Returns YYYY-MM-DD format in the workspace's timezone.
   * Falls back to UTC if timezone is invalid.
   *
   * @param timezone - IANA timezone string (e.g., "Europe/Bratislava")
   * @returns Date string in YYYY-MM-DD format
   */
  private getDayBucket(timezone: string): string {
    try {
      // Use en-CA locale for YYYY-MM-DD format
      return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    } catch (error) {
      this.logger.warn(
        `Invalid timezone "${timezone}", falling back to UTC for day bucket`,
      );
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Check if alert should be created
   *
   * Applies two checks:
   * 1. Dedupe key uniqueness - prevent exact duplicate alerts
   * 2. Cooldown period - rate limit alerts for same rule
   *
   * @param ruleId - The rule ID
   * @param dedupeKey - Generated dedupe key
   * @param cooldownSeconds - Cooldown period in seconds (0 = disabled)
   * @returns Object with allowed flag and optional reason
   */
  async shouldCreateAlert(
    ruleId: string,
    dedupeKey: string,
    cooldownSeconds: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check 1: Dedupe key uniqueness
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

    // Check 2: Cooldown period
    if (cooldownSeconds > 0) {
      const cooldownStart = new Date(Date.now() - cooldownSeconds * 1000);
      const recentAlert = await this.prisma.alert.findFirst({
        where: {
          ruleId,
          triggeredAt: { gte: cooldownStart },
        },
        orderBy: { triggeredAt: 'desc' },
        select: { id: true, triggeredAt: true },
      });

      if (recentAlert) {
        const remainingCooldown = Math.ceil(
          (cooldownSeconds * 1000 -
            (Date.now() - recentAlert.triggeredAt.getTime())) /
            1000,
        );
        return {
          allowed: false,
          reason: `Cooldown active (${remainingCooldown}s remaining, last: ${recentAlert.id})`,
        };
      }
    }

    return { allowed: true };
  }
}
