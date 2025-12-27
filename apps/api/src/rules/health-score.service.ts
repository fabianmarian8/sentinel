import { Injectable } from '@nestjs/common';
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
 * Penalty multiplier for headless fallback (not an error, but sub-optimal)
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
    } else {
      // Success - recover health
      delta = RECOVERY_POINTS;

      // Small penalty for using fallback (headless)
      if (update.usedFallback) {
        delta -= HEADLESS_FALLBACK_PENALTY;
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

    return {
      ruleId: update.ruleId,
      previousScore,
      newScore,
      delta,
    };
  }

  /**
   * Batch update health scores for multiple rules
   */
  async batchUpdateHealthScores(updates: HealthScoreUpdate[]): Promise<HealthScoreResult[]> {
    const results: HealthScoreResult[] = [];

    for (const update of updates) {
      const result = await this.updateHealthScore(update);
      results.push(result);
    }

    return results;
  }

  /**
   * Reset health score to 100 (e.g., after fixing a rule)
   */
  async resetHealthScore(ruleId: string): Promise<HealthScoreResult> {
    const rule = await this.prisma.rule.findUnique({
      where: { id: ruleId },
      select: { healthScore: true },
    });

    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const previousScore = rule.healthScore ?? MAX_HEALTH;

    await this.prisma.rule.update({
      where: { id: ruleId },
      data: {
        healthScore: MAX_HEALTH,
        lastErrorCode: null,
        lastErrorAt: null,
      },
    });

    return {
      ruleId,
      previousScore,
      newScore: MAX_HEALTH,
      delta: MAX_HEALTH - previousScore,
    };
  }

  /**
   * Get health score summary for a workspace
   */
  async getWorkspaceHealthSummary(workspaceId: string): Promise<{
    totalRules: number;
    healthyRules: number;
    warningRules: number;
    criticalRules: number;
    averageScore: number;
  }> {
    const rules = await this.prisma.rule.findMany({
      where: {
        source: {
          workspaceId,
        },
      },
      select: {
        healthScore: true,
      },
    });

    const totalRules = rules.length;
    if (totalRules === 0) {
      return {
        totalRules: 0,
        healthyRules: 0,
        warningRules: 0,
        criticalRules: 0,
        averageScore: 100,
      };
    }

    let healthyRules = 0;
    let warningRules = 0;
    let criticalRules = 0;
    let totalScore = 0;

    for (const rule of rules) {
      const score = rule.healthScore ?? MAX_HEALTH;
      totalScore += score;

      if (score >= 80) {
        healthyRules++;
      } else if (score >= 50) {
        warningRules++;
      } else {
        criticalRules++;
      }
    }

    return {
      totalRules,
      healthyRules,
      warningRules,
      criticalRules,
      averageScore: Math.round((totalScore / totalRules) * 100) / 100,
    };
  }

  /**
   * Get rules with low health scores (for alerting/dashboard)
   */
  async getLowHealthRules(workspaceId: string, threshold = 50): Promise<{
    id: string;
    name: string;
    healthScore: number;
    lastErrorCode: string | null;
    lastErrorAt: Date | null;
    sourceUrl: string;
  }[]> {
    const rules = await this.prisma.rule.findMany({
      where: {
        source: {
          workspaceId,
        },
        healthScore: {
          lt: threshold,
        },
      },
      select: {
        id: true,
        name: true,
        healthScore: true,
        lastErrorCode: true,
        lastErrorAt: true,
        source: {
          select: {
            url: true,
          },
        },
      },
      orderBy: {
        healthScore: 'asc',
      },
    });

    return rules.map(rule => ({
      id: rule.id,
      name: rule.name,
      healthScore: rule.healthScore ?? MAX_HEALTH,
      lastErrorCode: rule.lastErrorCode,
      lastErrorAt: rule.lastErrorAt,
      sourceUrl: rule.source.url,
    }));
  }

  /**
   * Calculate what the health score would be after N more errors
   * Useful for showing projections in the UI
   */
  projectHealthScore(
    currentScore: number,
    errorCode: ErrorCode,
    errorCount: number,
  ): number {
    const penalty = this.getPenalty(errorCode);
    return Math.max(MIN_HEALTH, currentScore - (penalty * errorCount));
  }

  /**
   * Calculate how many successful runs needed to reach full health
   */
  runsToFullHealth(currentScore: number): number {
    const deficit = MAX_HEALTH - currentScore;
    return Math.ceil(deficit / RECOVERY_POINTS);
  }
}
