import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SLO thresholds (Service Level Objectives)
 * Used to determine health status of metrics
 */
const SLO_THRESHOLDS = {
  extractionSuccessRate: { healthy: 0.95, warning: 0.90 }, // 95% healthy, <90% critical
  costPerSuccess: { healthy: 0.01, warning: 0.02 }, // $0.01 healthy, >$0.02 critical
  providerErrorRate: { healthy: 0.05, warning: 0.10 }, // 5% healthy, >10% critical
  latencyP95Ms: { healthy: 5000, warning: 10000 }, // 5s healthy, >10s critical
};

export interface SloMetrics {
  period: { from: Date; to: Date; hours: number };
  extraction: {
    totalRuns: number;
    successfulRuns: number;
    successRate: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  cost: {
    totalCostUsd: number;
    successfulExtractions: number;
    costPerSuccess: number;
    status: 'healthy' | 'warning' | 'critical';
  };
  providers: {
    totalAttempts: number;
    providerErrors: number;
    errorRate: number;
    status: 'healthy' | 'warning' | 'critical';
    byProvider: Record<string, { attempts: number; errors: number; errorRate: number }>;
  };
  schemaDrift: {
    driftAlerts: number;
    schemaRuns: number;
    driftRate: number;
  };
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    status: 'healthy' | 'warning' | 'critical';
  };
}

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDomainStats(workspaceId: string, days: number = 7) {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);

    return this.prisma.domainStats.findMany({
      where: {
        workspaceId,
        date: { gte: fromDate },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getProviderStats(workspaceId: string, days: number = 7) {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);

    return this.prisma.fetchAttempt.groupBy({
      by: ['provider', 'outcome'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      _count: true,
      _sum: { costUsd: true },
    });
  }

  async getBudgetStatus(workspaceId: string) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const spent = await this.prisma.fetchAttempt.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: todayStart },
      },
      _sum: { costUsd: true },
    });

    return {
      todaySpent: spent._sum.costUsd ?? 0,
      dailyLimit: 10, // TODO: from workspace settings
    };
  }

  /**
   * Get SLO metrics for a workspace
   *
   * Metrics calculated:
   * - Extraction success rate: successful observations / total runs
   * - Cost per success: total cost / successful extractions
   * - Provider error rate: provider errors / total attempts
   * - Schema drift rate: drift alerts / schema-based runs
   * - Latency percentiles: P50, P95, P99
   *
   * @param workspaceId Workspace to calculate metrics for
   * @param hours Time window (default 6 hours per Oponent recommendation)
   */
  async getSloMetrics(workspaceId: string, hours: number = 6): Promise<SloMetrics> {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);
    const toDate = new Date();

    // Get workspace rule IDs for filtering (Rule -> Source -> workspaceId)
    const workspaceRules = await this.prisma.rule.findMany({
      where: { source: { workspaceId } },
      select: { id: true },
    });
    const ruleIds = workspaceRules.map((r) => r.id);

    // 1. Extraction success rate
    const [totalRuns, successfulRuns] = await Promise.all([
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
        },
      }),
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
          errorCode: null, // No error
          observations: { some: {} }, // Has at least one observation
        },
      }),
    ]);

    const successRate = totalRuns > 0 ? successfulRuns / totalRuns : 1;
    const extractionStatus = this.getStatus(
      successRate,
      SLO_THRESHOLDS.extractionSuccessRate.healthy,
      SLO_THRESHOLDS.extractionSuccessRate.warning,
      true, // higher is better
    );

    // 2. Cost metrics from FetchAttempt
    const costAgg = await this.prisma.fetchAttempt.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      _sum: { costUsd: true },
    });
    const totalCostUsd = costAgg._sum.costUsd ?? 0;
    const costPerSuccess = successfulRuns > 0 ? totalCostUsd / successfulRuns : 0;
    const costStatus = this.getStatus(
      costPerSuccess,
      SLO_THRESHOLDS.costPerSuccess.healthy,
      SLO_THRESHOLDS.costPerSuccess.warning,
      false, // lower is better
    );

    // 3. Provider error rate
    const providerStats = await this.prisma.fetchAttempt.groupBy({
      by: ['provider', 'outcome'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      _count: true,
    });

    const byProvider: Record<string, { attempts: number; errors: number; errorRate: number }> = {};
    let totalAttempts = 0;
    let providerErrors = 0;

    for (const stat of providerStats) {
      const provider = stat.provider || 'http';
      if (!byProvider[provider]) {
        byProvider[provider] = { attempts: 0, errors: 0, errorRate: 0 };
      }
      byProvider[provider].attempts += stat._count;
      totalAttempts += stat._count;

      if (stat.outcome === 'provider_error') {
        byProvider[provider].errors += stat._count;
        providerErrors += stat._count;
      }
    }

    // Calculate error rates per provider
    for (const provider of Object.keys(byProvider)) {
      const p = byProvider[provider]!;
      p.errorRate = p.attempts > 0 ? p.errors / p.attempts : 0;
    }

    const providerErrorRate = totalAttempts > 0 ? providerErrors / totalAttempts : 0;
    const providerStatus = this.getStatus(
      providerErrorRate,
      SLO_THRESHOLDS.providerErrorRate.healthy,
      SLO_THRESHOLDS.providerErrorRate.warning,
      false, // lower is better
    );

    // 4. Schema drift rate (count schema_drift alerts vs schema-method runs)
    const [driftAlerts, schemaRuns] = await Promise.all([
      this.prisma.alert.count({
        where: {
          ruleId: { in: ruleIds },
          triggeredAt: { gte: fromDate },
          alertType: 'schema_drift',
        },
      }),
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
          rule: {
            extraction: {
              path: ['method'],
              equals: 'schema',
            },
          },
        },
      }),
    ]);

    const driftRate = schemaRuns > 0 ? driftAlerts / schemaRuns : 0;

    // 5. Latency percentiles from FetchAttempt
    const latencies = await this.prisma.fetchAttempt.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
        latencyMs: { not: null },
      },
      select: { latencyMs: true },
      orderBy: { latencyMs: 'asc' },
    });

    const latencyValues = latencies.map((l) => l.latencyMs!).filter((v) => v > 0);
    const p50Ms = this.percentile(latencyValues, 50);
    const p95Ms = this.percentile(latencyValues, 95);
    const p99Ms = this.percentile(latencyValues, 99);

    const latencyStatus = this.getStatus(
      p95Ms,
      SLO_THRESHOLDS.latencyP95Ms.healthy,
      SLO_THRESHOLDS.latencyP95Ms.warning,
      false, // lower is better
    );

    return {
      period: { from: fromDate, to: toDate, hours },
      extraction: {
        totalRuns,
        successfulRuns,
        successRate,
        status: extractionStatus,
      },
      cost: {
        totalCostUsd,
        successfulExtractions: successfulRuns,
        costPerSuccess,
        status: costStatus,
      },
      providers: {
        totalAttempts,
        providerErrors,
        errorRate: providerErrorRate,
        status: providerStatus,
        byProvider,
      },
      schemaDrift: {
        driftAlerts,
        schemaRuns,
        driftRate,
      },
      latency: {
        p50Ms,
        p95Ms,
        p99Ms,
        status: latencyStatus,
      },
    };
  }

  /**
   * Get SLO metrics per hostname for a workspace
   * Useful for identifying problematic domains
   */
  async getSloMetricsByHostname(
    workspaceId: string,
    hours: number = 6,
  ): Promise<
    Array<{
      hostname: string;
      successRate: number;
      costUsd: number;
      attempts: number;
      status: 'healthy' | 'warning' | 'critical';
    }>
  > {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);

    const stats = await this.prisma.fetchAttempt.groupBy({
      by: ['hostname'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      _count: true,
      _sum: { costUsd: true },
    });

    // Get success counts per hostname
    const successStats = await this.prisma.fetchAttempt.groupBy({
      by: ['hostname'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
        outcome: 'ok',
      },
      _count: true,
    });

    const successByHostname = new Map(successStats.map((s) => [s.hostname, s._count]));

    return stats
      .map((stat) => {
        const successCount = successByHostname.get(stat.hostname) ?? 0;
        const successRate = stat._count > 0 ? successCount / stat._count : 1;
        return {
          hostname: stat.hostname ?? 'unknown',
          successRate,
          costUsd: stat._sum.costUsd ?? 0,
          attempts: stat._count,
          status: this.getStatus(
            successRate,
            SLO_THRESHOLDS.extractionSuccessRate.healthy,
            SLO_THRESHOLDS.extractionSuccessRate.warning,
            true,
          ),
        };
      })
      .sort((a, b) => a.successRate - b.successRate); // Worst first
  }

  /**
   * Get global SLO metrics (admin only, no workspace filter)
   * For internal monitoring dashboard
   */
  async getGlobalSloMetricsByHostname(hours: number = 24): Promise<
    Array<{
      hostname: string;
      successRate: number;
      costUsd: number;
      attempts: number;
      status: 'healthy' | 'warning' | 'critical';
    }>
  > {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);

    const stats = await this.prisma.fetchAttempt.groupBy({
      by: ['hostname'],
      where: {
        createdAt: { gte: fromDate },
      },
      _count: true,
      _sum: { costUsd: true },
    });

    // Get success counts per hostname
    const successStats = await this.prisma.fetchAttempt.groupBy({
      by: ['hostname'],
      where: {
        createdAt: { gte: fromDate },
        outcome: 'ok',
      },
      _count: true,
    });

    const successByHostname = new Map(successStats.map((s) => [s.hostname, s._count]));

    return stats
      .map((stat) => {
        const successCount = successByHostname.get(stat.hostname) ?? 0;
        const successRate = stat._count > 0 ? successCount / stat._count : 1;
        return {
          hostname: stat.hostname ?? 'unknown',
          successRate,
          costUsd: stat._sum.costUsd ?? 0,
          attempts: stat._count,
          status: this.getStatus(
            successRate,
            SLO_THRESHOLDS.extractionSuccessRate.healthy,
            SLO_THRESHOLDS.extractionSuccessRate.warning,
            true,
          ),
        };
      })
      .sort((a, b) => a.successRate - b.successRate); // Worst first
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))] ?? 0;
  }

  /**
   * Determine status based on value and thresholds
   */
  private getStatus(
    value: number,
    healthyThreshold: number,
    warningThreshold: number,
    higherIsBetter: boolean,
  ): 'healthy' | 'warning' | 'critical' {
    if (higherIsBetter) {
      if (value >= healthyThreshold) return 'healthy';
      if (value >= warningThreshold) return 'warning';
      return 'critical';
    } else {
      if (value <= healthyThreshold) return 'healthy';
      if (value <= warningThreshold) return 'warning';
      return 'critical';
    }
  }

  /**
   * Get observation-level split metrics for dashboards
   *
   * Separates success into 3 lines:
   * 1. Observation Success Rate - observations created / runs (extraction worked)
   * 2. Price Present Rate - valueLowCents != null / price-type observations (product has price)
   * 3. Missing Price Rate - missingPrice=true / price-type observations (product unavailable)
   *
   * Also includes per-domain CAPTCHA rate for hostile domain monitoring
   *
   * This separation prevents "Amazon is broken" when reality is "Amazon product is out of stock"
   */
  async getObservationSplitMetrics(
    workspaceId: string,
    hours: number = 24,
  ): Promise<{
    period: { from: Date; to: Date; hours: number };
    overall: {
      totalRuns: number;
      observationsCreated: number;
      observationSuccessRate: number;
    };
    priceRules: {
      totalObservations: number;
      withPrice: number;
      pricePresentRate: number;
      missingPrice: number;
      missingPriceRate: number;
      extractionFailed: number;
    };
    byDomain: Array<{
      hostname: string;
      tier: string | null;
      attempts: number;
      okCount: number;
      fetchOkRate: number;
      captchaCount: number;
      captchaRate: number;
      blockedCount: number;
    }>;
  }> {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);
    const toDate = new Date();

    // Get workspace rules
    const rules = await this.prisma.rule.findMany({
      where: { source: { workspaceId } },
      select: {
        id: true,
        ruleType: true,
        source: {
          select: {
            domain: true,
            fetchProfile: { select: { domainTier: true } },
          },
        },
      },
    });

    const ruleIds = rules.map((r) => r.id);
    const priceRuleIds = rules.filter((r) => r.ruleType === 'price').map((r) => r.id);
    const ruleToTier = new Map(rules.map((r) => [r.id, r.source.fetchProfile?.domainTier ?? null]));

    // Overall runs and observations
    const [totalRuns, runsWithObs] = await Promise.all([
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
        },
      }),
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
          observations: { some: {} },
        },
      }),
    ]);

    // Price rule observations with split metrics
    const priceObservations = await this.prisma.observation.findMany({
      where: {
        ruleId: { in: priceRuleIds },
        createdAt: { gte: fromDate },
      },
      select: {
        extractedNormalized: true,
      },
    });

    let withPrice = 0;
    let missingPrice = 0;
    let extractionFailed = 0;

    for (const obs of priceObservations) {
      const normalized = obs.extractedNormalized as Record<string, unknown> | null;
      if (!normalized) {
        extractionFailed++;
      } else if (normalized.missingPrice === true) {
        missingPrice++;
      } else if (normalized.valueLowCents != null || normalized.valueLow != null || normalized.value != null) {
        withPrice++;
      } else {
        extractionFailed++;
      }
    }

    const totalPriceObs = priceObservations.length;

    // Per-domain fetch stats with CAPTCHA breakdown
    const fetchAttempts = await this.prisma.fetchAttempt.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
        ruleId: { not: null },
      },
      select: {
        ruleId: true,
        hostname: true,
        outcome: true,
      },
    });

    const domainStats = new Map<
      string,
      { tier: string | null; ok: number; captcha: number; blocked: number; total: number }
    >();

    for (const attempt of fetchAttempts) {
      const hostname = attempt.hostname;
      const tier = attempt.ruleId ? ruleToTier.get(attempt.ruleId) ?? null : null;

      if (!domainStats.has(hostname)) {
        domainStats.set(hostname, { tier, ok: 0, captcha: 0, blocked: 0, total: 0 });
      }

      const stats = domainStats.get(hostname)!;
      stats.total++;

      if (attempt.outcome === 'ok') {
        stats.ok++;
      } else if (attempt.outcome === 'captcha_required') {
        stats.captcha++;
      } else if (attempt.outcome === 'blocked') {
        stats.blocked++;
      }
    }

    const byDomain = Array.from(domainStats.entries())
      .map(([hostname, stats]) => ({
        hostname,
        tier: stats.tier,
        attempts: stats.total,
        okCount: stats.ok,
        fetchOkRate: stats.total > 0 ? stats.ok / stats.total : 1,
        captchaCount: stats.captcha,
        captchaRate: stats.total > 0 ? stats.captcha / stats.total : 0,
        blockedCount: stats.blocked,
      }))
      .sort((a, b) => b.captchaRate - a.captchaRate); // Worst CAPTCHA rate first

    return {
      period: { from: fromDate, to: toDate, hours },
      overall: {
        totalRuns,
        observationsCreated: runsWithObs,
        observationSuccessRate: totalRuns > 0 ? runsWithObs / totalRuns : 1,
      },
      priceRules: {
        totalObservations: totalPriceObs,
        withPrice,
        pricePresentRate: totalPriceObs > 0 ? withPrice / totalPriceObs : 1,
        missingPrice,
        missingPriceRate: totalPriceObs > 0 ? missingPrice / totalPriceObs : 0,
        extractionFailed,
      },
      byDomain,
    };
  }

  /**
   * Get global observation split metrics (admin, no workspace filter)
   */
  async getGlobalObservationSplitMetrics(hours: number = 24): Promise<{
    period: { from: Date; to: Date; hours: number };
    overall: {
      totalRuns: number;
      observationsCreated: number;
      observationSuccessRate: number;
    };
    priceRules: {
      totalObservations: number;
      withPrice: number;
      pricePresentRate: number;
      missingPrice: number;
      missingPriceRate: number;
      extractionFailed: number;
    };
    byDomain: Array<{
      hostname: string;
      tier: string | null;
      attempts: number;
      okCount: number;
      fetchOkRate: number;
      captchaCount: number;
      captchaRate: number;
      blockedCount: number;
    }>;
  }> {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);
    const toDate = new Date();

    // Get all rules
    const rules = await this.prisma.rule.findMany({
      select: {
        id: true,
        ruleType: true,
        source: {
          select: {
            domain: true,
            fetchProfile: { select: { domainTier: true } },
          },
        },
      },
    });

    const ruleIds = rules.map((r) => r.id);
    const priceRuleIds = rules.filter((r) => r.ruleType === 'price').map((r) => r.id);
    const ruleToTier = new Map(rules.map((r) => [r.id, r.source.fetchProfile?.domainTier ?? null]));

    // Overall runs and observations
    const [totalRuns, runsWithObs] = await Promise.all([
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
        },
      }),
      this.prisma.run.count({
        where: {
          ruleId: { in: ruleIds },
          startedAt: { gte: fromDate },
          observations: { some: {} },
        },
      }),
    ]);

    // Price rule observations
    const priceObservations = await this.prisma.observation.findMany({
      where: {
        ruleId: { in: priceRuleIds },
        createdAt: { gte: fromDate },
      },
      select: { extractedNormalized: true },
    });

    let withPrice = 0;
    let missingPrice = 0;
    let extractionFailed = 0;

    for (const obs of priceObservations) {
      const normalized = obs.extractedNormalized as Record<string, unknown> | null;
      if (!normalized) {
        extractionFailed++;
      } else if (normalized.missingPrice === true) {
        missingPrice++;
      } else if (normalized.valueLowCents != null || normalized.valueLow != null || normalized.value != null) {
        withPrice++;
      } else {
        extractionFailed++;
      }
    }

    // Per-domain fetch stats (global)
    const fetchAttempts = await this.prisma.fetchAttempt.findMany({
      where: {
        createdAt: { gte: fromDate },
        ruleId: { not: null },
      },
      select: {
        ruleId: true,
        hostname: true,
        outcome: true,
      },
    });

    const domainStats = new Map<
      string,
      { tier: string | null; ok: number; captcha: number; blocked: number; total: number }
    >();

    for (const attempt of fetchAttempts) {
      const hostname = attempt.hostname;
      const tier = attempt.ruleId ? ruleToTier.get(attempt.ruleId) ?? null : null;

      if (!domainStats.has(hostname)) {
        domainStats.set(hostname, { tier, ok: 0, captcha: 0, blocked: 0, total: 0 });
      }

      const stats = domainStats.get(hostname)!;
      stats.total++;

      if (attempt.outcome === 'ok') {
        stats.ok++;
      } else if (attempt.outcome === 'captcha_required') {
        stats.captcha++;
      } else if (attempt.outcome === 'blocked') {
        stats.blocked++;
      }
    }

    const byDomain = Array.from(domainStats.entries())
      .map(([hostname, stats]) => ({
        hostname,
        tier: stats.tier,
        attempts: stats.total,
        okCount: stats.ok,
        fetchOkRate: stats.total > 0 ? stats.ok / stats.total : 1,
        captchaCount: stats.captcha,
        captchaRate: stats.total > 0 ? stats.captcha / stats.total : 0,
        blockedCount: stats.blocked,
      }))
      .sort((a, b) => b.captchaRate - a.captchaRate);

    return {
      period: { from: fromDate, to: toDate, hours },
      overall: {
        totalRuns,
        observationsCreated: runsWithObs,
        observationSuccessRate: totalRuns > 0 ? runsWithObs / totalRuns : 1,
      },
      priceRules: {
        totalObservations: priceObservations.length,
        withPrice,
        pricePresentRate: priceObservations.length > 0 ? withPrice / priceObservations.length : 1,
        missingPrice,
        missingPriceRate: priceObservations.length > 0 ? missingPrice / priceObservations.length : 0,
        extractionFailed,
      },
      byDomain,
    };
  }

  /**
   * Get canary SLO metrics with tier breakdown
   *
   * Designed for 24h canary eval protocol:
   * - Dual success rates: observationSuccessRate (SLO) + fetchOkRate (network)
   * - Cost per success per tier
   * - rate_limited % (BrightData/paid provider capacity issues)
   * - Worst hostnames with primary error reason
   *
   * GO criteria (from Oponent):
   * - Tier A/B: ≥95% observationSuccessRate
   * - Tier C: ≥80% observationSuccessRate
   * - Cost/success: not >20% worse than baseline
   * - rate_limited: <5% of runs
   * - Min sample size: 30 runs per tier (otherwise INSUFFICIENT_SAMPLE)
   */
  async getCanarySloMetrics(
    workspaceId: string,
    hours: number = 24,
  ): Promise<{
    period: { from: Date; to: Date; hours: number };
    byTier: Record<
      string,
      {
        totalRuns: number;
        successfulRuns: number;
        observationSuccessRate: number; // Runs with valid observation (SLO metric)
        fetchAttempts: number;
        fetchOkCount: number;
        fetchOkRate: number; // Fetch attempts with outcome=ok (network metric)
        totalCostUsd: number;
        costPerSuccess: number;
        status: 'healthy' | 'warning' | 'critical' | 'insufficient_sample';
        sloTarget: number;
      }
    >;
    rateLimited: {
      count: number;
      percentage: number;
      byProvider: Record<string, number>;
    };
    worstHostnames: Array<{
      hostname: string;
      tier: string;
      fetchOkRate: number;
      attempts: number;
      costUsd: number;
      primaryError: string | null;
      errorCount: number;
    }>;
    goNoGo: {
      canProceed: boolean;
      blockers: string[];
    };
  }> {
    const fromDate = new Date();
    fromDate.setTime(fromDate.getTime() - hours * 60 * 60 * 1000);
    const toDate = new Date();

    // SLO targets by tier
    const sloTargets: Record<string, number> = {
      tier_a: 0.95,
      tier_b: 0.95,
      tier_c: 0.80,
      unknown: 0.95,
    };

    // Get rules with their tier info for this workspace
    const rulesWithTier = await this.prisma.rule.findMany({
      where: { source: { workspaceId } },
      select: {
        id: true,
        source: {
          select: {
            fetchProfile: {
              select: { domainTier: true },
            },
          },
        },
      },
    });

    const ruleToTier = new Map<string, string>();
    for (const rule of rulesWithTier) {
      const tier = rule.source?.fetchProfile?.domainTier ?? 'tier_a';
      ruleToTier.set(rule.id, tier);
    }
    const ruleIds = rulesWithTier.map((r) => r.id);

    // Get runs with their outcomes
    const runs = await this.prisma.run.findMany({
      where: {
        ruleId: { in: ruleIds },
        startedAt: { gte: fromDate },
      },
      select: {
        id: true,
        ruleId: true,
        errorCode: true,
        observations: { select: { id: true }, take: 1 },
      },
    });

    // Aggregate by tier - observation-based (SLO metric)
    const byTier: Record<
      string,
      {
        totalRuns: number;
        successRuns: number;
        fetchAttempts: number;
        fetchOkCount: number;
        costUsd: number;
      }
    > = {
      tier_a: { totalRuns: 0, successRuns: 0, fetchAttempts: 0, fetchOkCount: 0, costUsd: 0 },
      tier_b: { totalRuns: 0, successRuns: 0, fetchAttempts: 0, fetchOkCount: 0, costUsd: 0 },
      tier_c: { totalRuns: 0, successRuns: 0, fetchAttempts: 0, fetchOkCount: 0, costUsd: 0 },
      unknown: { totalRuns: 0, successRuns: 0, fetchAttempts: 0, fetchOkCount: 0, costUsd: 0 },
    };

    for (const run of runs) {
      const tier = ruleToTier.get(run.ruleId!) ?? 'tier_a';
      byTier[tier]!.totalRuns++;
      if (!run.errorCode && run.observations.length > 0) {
        byTier[tier]!.successRuns++;
      }
    }

    // Get fetch attempts for network-level metrics
    const fetchAttempts = await this.prisma.fetchAttempt.findMany({
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
        ruleId: { not: null },
      },
      select: {
        ruleId: true,
        costUsd: true,
        outcome: true,
        provider: true,
        hostname: true,
      },
    });

    // Aggregate fetch-level stats by tier
    for (const attempt of fetchAttempts) {
      if (attempt.ruleId) {
        const tier = ruleToTier.get(attempt.ruleId) ?? 'tier_a';
        byTier[tier]!.fetchAttempts++;
        byTier[tier]!.costUsd += attempt.costUsd;
        if (attempt.outcome === 'ok') {
          byTier[tier]!.fetchOkCount++;
        }
      }
    }

    // Min sample size threshold
    const MIN_SAMPLE_SIZE = 30;

    // Format tier results with dual success rates
    const tierResults: Record<
      string,
      {
        totalRuns: number;
        successfulRuns: number;
        observationSuccessRate: number;
        fetchAttempts: number;
        fetchOkCount: number;
        fetchOkRate: number;
        totalCostUsd: number;
        costPerSuccess: number;
        status: 'healthy' | 'warning' | 'critical' | 'insufficient_sample';
        sloTarget: number;
      }
    > = {};

    for (const [tier, data] of Object.entries(byTier)) {
      const observationSuccessRate = data.totalRuns > 0
        ? data.successRuns / data.totalRuns
        : 1;
      const fetchOkRate = data.fetchAttempts > 0
        ? data.fetchOkCount / data.fetchAttempts
        : 1;
      const sloTarget = sloTargets[tier] ?? 0.95;

      // Status logic with min sample size
      let status: 'healthy' | 'warning' | 'critical' | 'insufficient_sample';
      if (data.totalRuns < MIN_SAMPLE_SIZE) {
        status = 'insufficient_sample';
      } else {
        status = this.getStatus(
          observationSuccessRate,
          sloTarget,
          sloTarget - 0.05,
          true,
        );
      }

      tierResults[tier] = {
        totalRuns: data.totalRuns,
        successfulRuns: data.successRuns,
        observationSuccessRate,
        fetchAttempts: data.fetchAttempts,
        fetchOkCount: data.fetchOkCount,
        fetchOkRate,
        totalCostUsd: data.costUsd,
        costPerSuccess: data.successRuns > 0 ? data.costUsd / data.successRuns : 0,
        status,
        sloTarget,
      };
    }

    // Rate limited stats
    const rateLimitedAttempts = fetchAttempts.filter(
      (a) => a.outcome === 'rate_limited',
    );
    const rateLimitedByProvider: Record<string, number> = {};
    for (const attempt of rateLimitedAttempts) {
      const provider = attempt.provider ?? 'unknown';
      rateLimitedByProvider[provider] =
        (rateLimitedByProvider[provider] ?? 0) + 1;
    }

    const totalAttempts = fetchAttempts.length;
    const rateLimitedCount = rateLimitedAttempts.length;
    const rateLimitedPercentage =
      totalAttempts > 0 ? rateLimitedCount / totalAttempts : 0;

    // Worst hostnames with primary error
    const hostnameStats = new Map<
      string,
      {
        tier: string;
        attempts: number;
        successes: number;
        costUsd: number;
        errors: Record<string, number>;
      }
    >();

    for (const attempt of fetchAttempts) {
      const hostname = attempt.hostname;
      const tier = attempt.ruleId
        ? (ruleToTier.get(attempt.ruleId) ?? 'tier_a')
        : 'tier_a';

      if (!hostnameStats.has(hostname)) {
        hostnameStats.set(hostname, {
          tier,
          attempts: 0,
          successes: 0,
          costUsd: 0,
          errors: {},
        });
      }

      const stats = hostnameStats.get(hostname)!;
      stats.attempts++;
      stats.costUsd += attempt.costUsd;

      if (attempt.outcome === 'ok') {
        stats.successes++;
      } else {
        stats.errors[attempt.outcome] = (stats.errors[attempt.outcome] ?? 0) + 1;
      }
    }

    const worstHostnames = Array.from(hostnameStats.entries())
      .map(([hostname, stats]) => {
        const fetchOkRate =
          stats.attempts > 0 ? stats.successes / stats.attempts : 1;

        // Find primary error (most common)
        let primaryError: string | null = null;
        let maxErrorCount = 0;
        for (const [error, count] of Object.entries(stats.errors)) {
          if (count > maxErrorCount) {
            maxErrorCount = count;
            primaryError = error;
          }
        }

        return {
          hostname,
          tier: stats.tier,
          fetchOkRate,
          attempts: stats.attempts,
          costUsd: stats.costUsd,
          primaryError,
          errorCount: maxErrorCount,
        };
      })
      .sort((a, b) => a.fetchOkRate - b.fetchOkRate) // Worst first
      .slice(0, 10);

    // GO/NO-GO decision based on observationSuccessRate (SLO metric)
    const blockers: string[] = [];

    // Only evaluate tiers with sufficient sample size
    if (tierResults.tier_a && tierResults.tier_a.status !== 'insufficient_sample') {
      if (tierResults.tier_a.observationSuccessRate < 0.95) {
        blockers.push(
          `Tier A observationSuccessRate ${(tierResults.tier_a.observationSuccessRate * 100).toFixed(1)}% < 95%`,
        );
      }
    }
    if (tierResults.tier_b && tierResults.tier_b.status !== 'insufficient_sample') {
      if (tierResults.tier_b.observationSuccessRate < 0.95) {
        blockers.push(
          `Tier B observationSuccessRate ${(tierResults.tier_b.observationSuccessRate * 100).toFixed(1)}% < 95%`,
        );
      }
    }
    if (tierResults.tier_c && tierResults.tier_c.status !== 'insufficient_sample') {
      if (tierResults.tier_c.observationSuccessRate < 0.80) {
        blockers.push(
          `Tier C observationSuccessRate ${(tierResults.tier_c.observationSuccessRate * 100).toFixed(1)}% < 80%`,
        );
      }
    }

    // Check rate limited
    if (rateLimitedPercentage > 0.05) {
      blockers.push(
        `Rate limited ${(rateLimitedPercentage * 100).toFixed(1)}% > 5%`,
      );
    }

    return {
      period: { from: fromDate, to: toDate, hours },
      byTier: tierResults,
      rateLimited: {
        count: rateLimitedCount,
        percentage: rateLimitedPercentage,
        byProvider: rateLimitedByProvider,
      },
      worstHostnames,
      goNoGo: {
        canProceed: blockers.length === 0,
        blockers,
      },
    };
  }
}
