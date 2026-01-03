/**
 * Budget Guard Service
 *
 * Enforces cost limits per workspace/domain/rule.
 * Queries FetchAttempt ledger for current spend.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderId, PROVIDER_COSTS } from '../types/fetch-result';

export interface BudgetPolicy {
  enabled: boolean;
  workspaceDailyUsd: number;
  perDomainDailyUsd: number;
  perRuleDailyUsd: number;
  hardStopOnExceed: boolean;
  degradeToFreeOnly: boolean;
}

export interface BudgetStatus {
  workspaceSpent: number;
  domainSpent: number;
  ruleSpent: number;
  canSpendPaid: boolean;
  reason?: string;
}

const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  enabled: true,
  workspaceDailyUsd: 10,
  perDomainDailyUsd: 2,
  perRuleDailyUsd: 0.5,
  hardStopOnExceed: false,
  degradeToFreeOnly: true,
};

@Injectable()
export class BudgetGuardService {
  private readonly logger = new Logger(BudgetGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get today's start timestamp in UTC
   */
  private getTodayStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Get current spend for workspace/domain/rule
   */
  async getSpend(
    workspaceId: string,
    hostname: string,
    ruleId?: string,
  ): Promise<{ workspaceSpent: number; domainSpent: number; ruleSpent: number }> {
    const todayStart = this.getTodayStart();

    // Aggregate spend from FetchAttempt ledger
    const [workspaceAgg, domainAgg, ruleAgg] = await Promise.all([
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, hostname, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      ruleId
        ? this.prisma.fetchAttempt.aggregate({
            where: { ruleId, createdAt: { gte: todayStart } },
            _sum: { costUsd: true },
          })
        : Promise.resolve({ _sum: { costUsd: 0 } }),
    ]);

    return {
      workspaceSpent: workspaceAgg._sum.costUsd ?? 0,
      domainSpent: domainAgg._sum.costUsd ?? 0,
      ruleSpent: ruleAgg._sum.costUsd ?? 0,
    };
  }

  /**
   * Check if paid provider can be used given budget limits
   */
  async canSpend(
    workspaceId: string,
    hostname: string,
    providerId: ProviderId,
    ruleId?: string,
    policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
  ): Promise<BudgetStatus> {
    if (!policy.enabled) {
      return { workspaceSpent: 0, domainSpent: 0, ruleSpent: 0, canSpendPaid: true };
    }

    const providerCost = PROVIDER_COSTS[providerId];
    if (providerCost.perRequest === 0) {
      // Free provider, always allowed
      return { workspaceSpent: 0, domainSpent: 0, ruleSpent: 0, canSpendPaid: true };
    }

    const spend = await this.getSpend(workspaceId, hostname, ruleId);
    const estimatedCost = providerCost.perRequest;

    // Check workspace limit
    if (spend.workspaceSpent + estimatedCost > policy.workspaceDailyUsd) {
      this.logger.warn(
        `[${workspaceId}] Workspace budget exceeded: $${spend.workspaceSpent.toFixed(4)} / $${policy.workspaceDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Workspace daily budget exceeded ($${spend.workspaceSpent.toFixed(2)} / $${policy.workspaceDailyUsd})`,
      };
    }

    // Check domain limit
    if (spend.domainSpent + estimatedCost > policy.perDomainDailyUsd) {
      this.logger.warn(
        `[${hostname}] Domain budget exceeded: $${spend.domainSpent.toFixed(4)} / $${policy.perDomainDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Domain daily budget exceeded ($${spend.domainSpent.toFixed(2)} / $${policy.perDomainDailyUsd})`,
      };
    }

    // Check rule limit
    if (ruleId && spend.ruleSpent + estimatedCost > policy.perRuleDailyUsd) {
      this.logger.warn(
        `[Rule ${ruleId}] Rule budget exceeded: $${spend.ruleSpent.toFixed(4)} / $${policy.perRuleDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Rule daily budget exceeded ($${spend.ruleSpent.toFixed(2)} / $${policy.perRuleDailyUsd})`,
      };
    }

    return { ...spend, canSpendPaid: true };
  }

  /**
   * Get budget status summary for API/UI
   */
  async getBudgetStatus(workspaceId: string, policy: BudgetPolicy = DEFAULT_BUDGET_POLICY): Promise<{
    todaySpent: number;
    dailyLimit: number;
    remaining: number;
    topDomains: Array<{ hostname: string; spent: number }>;
  }> {
    const todayStart = this.getTodayStart();

    const [totalAgg, domainAgg] = await Promise.all([
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.fetchAttempt.groupBy({
        by: ['hostname'],
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
        orderBy: { _sum: { costUsd: 'desc' } },
        take: 5,
      }),
    ]);

    const todaySpent = totalAgg._sum.costUsd ?? 0;

    return {
      todaySpent,
      dailyLimit: policy.workspaceDailyUsd,
      remaining: Math.max(0, policy.workspaceDailyUsd - todaySpent),
      topDomains: domainAgg.map((d) => ({
        hostname: d.hostname,
        spent: d._sum.costUsd ?? 0,
      })),
    };
  }
}
