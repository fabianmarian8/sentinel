import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ErrorCode } from '@sentinel/shared';

/**
 * Penalty values for different error types
 * Higher values = more severe impact on health
 */
const ERROR_PENALTIES: Partial<Record<ErrorCode, number>> = {
  // Fetch errors
  FETCH_TIMEOUT: 5,
  FETCH_DNS: 10,
  FETCH_CONNECTION: 8,
  FETCH_TLS: 10,
  FETCH_HTTP_4XX: 15,
  FETCH_HTTP_5XX: 8,

  // Block detection
  CAPTCHA_BLOCK: 20,
  CLOUDFLARE_BLOCK: 20,
  RATELIMIT_BLOCK: 15,
  GEO_BLOCK: 15,
  BOT_DETECTION: 20,

  // Content errors
  SELECTOR_BROKEN: 25,
  JSON_PATH_BROKEN: 25,
  PARSE_ERROR: 15,

  // Unknown
  UNKNOWN: 10,
};

/**
 * Points recovered per successful run
 */
const RECOVERY_POINTS = 5;

/**
 * Minimum and maximum health scores
 */
const MIN_HEALTH = 0;
const MAX_HEALTH = 100;

/**
 * Penalty for using headless fallback (not an error, but sub-optimal)
 */
const HEADLESS_FALLBACK_PENALTY = 2;

export interface HealthScoreUpdate {
  ruleId: string;
  errorCode: ErrorCode | null;
  usedFallback: boolean;
}

export interface HealthScoreResult {
  ruleId: string;
  previousScore: number;
  newScore: number;
  delta: number;
}

@Injectable()
export class HealthScoreService {
  private readonly logger = new Logger(HealthScoreService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Calculate penalty for an error code
   */
  getPenalty(errorCode: ErrorCode | null): number {
    if (!errorCode) return 0;
    return ERROR_PENALTIES[errorCode] ?? ERROR_PENALTIES.UNKNOWN ?? 10;
  }

  /**
   * Update health score after a run
   * - On success: +5 points (capped at 100)
   * - On error: penalty based on error type
   * - On fallback: small penalty
   */
  async updateHealthScore(update: HealthScoreUpdate): Promise<HealthScoreResult> {
    // Get current rule
    const rule = await this.prisma.rule.findUnique({
      where: { id: update.ruleId },
      select: {
        id: true,
        healthScore: true,
        name: true,
      },
    });

    if (!rule) {
      throw new Error(`Rule not found: ${update.ruleId}`);
    }

    const previousScore = rule.healthScore ?? MAX_HEALTH;
    let delta = 0;

    if (update.errorCode) {
      // Error occurred - apply penalty
      delta = -this.getPenalty(update.errorCode);
      this.logger.debug(
        `[Rule ${update.ruleId}] Error ${update.errorCode}, penalty: ${-delta}`,
      );
    } else {
      // Success - recover health
      delta = RECOVERY_POINTS;

      // Small penalty for using fallback (headless)
      if (update.usedFallback) {
        delta -= HEADLESS_FALLBACK_PENALTY;
        this.logger.debug(
          `[Rule ${update.ruleId}] Used fallback, reduced recovery to ${delta}`,
        );
      }
    }

    // Calculate new score with bounds
    const newScore = Math.min(MAX_HEALTH, Math.max(MIN_HEALTH, previousScore + delta));

    // Update in database
    await this.prisma.rule.update({
      where: { id: update.ruleId },
      data: {
        healthScore: newScore,
        lastErrorCode: update.errorCode,
        lastErrorAt: update.errorCode ? new Date() : undefined,
      },
    });

    // Log significant health changes
    if (Math.abs(delta) >= 10 || newScore <= 50) {
      this.logger.log(
        `[Rule ${update.ruleId}] "${rule.name}" health: ${previousScore} → ${newScore} (${delta > 0 ? '+' : ''}${delta})`,
      );
    }

    return {
      ruleId: update.ruleId,
      previousScore,
      newScore,
      delta,
    };
  }
}
