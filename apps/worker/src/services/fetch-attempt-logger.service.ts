/**
 * FetchAttempt Logger Service
 *
 * Records every fetch attempt to the FetchAttempt ledger.
 * Updates DomainStats rolling aggregations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FetchResult, ProviderId, FetchOutcome, BlockKind } from '../types/fetch-result';
import { FetchProvider, FetchOutcome as PrismaFetchOutcome, BlockKind as PrismaBlockKind } from '@prisma/client';

export interface LogAttemptParams {
  workspaceId: string;
  ruleId?: string;
  url: string;
  hostname: string;
  result: FetchResult;
}

@Injectable()
export class FetchAttemptLoggerService {
  private readonly logger = new Logger(FetchAttemptLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log a fetch attempt to the ledger
   */
  async logAttempt(params: LogAttemptParams): Promise<void> {
    const { workspaceId, ruleId, url, hostname, result } = params;

    try {
      await this.prisma.fetchAttempt.create({
        data: {
          workspaceId,
          ruleId,
          url,
          hostname,
          provider: result.provider as FetchProvider,
          outcome: result.outcome as PrismaFetchOutcome,
          blockKind: result.blockKind as PrismaBlockKind | null,
          httpStatus: result.httpStatus,
          finalUrl: result.finalUrl,
          bodyBytes: result.bodyBytes,
          contentType: result.contentType,
          latencyMs: result.latencyMs,
          signalsJson: result.signals.length > 0 ? result.signals : undefined,
          errorDetail: result.errorDetail,
          costUsd: result.costUsd,
          costUnits: result.costUnits,
        },
      });

      // Update daily domain stats (fire and forget)
      this.updateDomainStats(workspaceId, hostname, result).catch((err) => {
        this.logger.warn(`Failed to update domain stats: ${err.message}`);
      });
    } catch (error) {
      this.logger.error(`Failed to log fetch attempt: ${error}`);
      // Don't throw - logging shouldn't break the fetch flow
    }
  }

  /**
   * Update daily domain statistics (upsert)
   */
  private async updateDomainStats(
    workspaceId: string,
    hostname: string,
    result: FetchResult,
  ): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const incrementField = this.getOutcomeField(result.outcome);

    await this.prisma.domainStats.upsert({
      where: {
        workspaceId_hostname_date: {
          workspaceId,
          hostname,
          date: today,
        },
      },
      create: {
        workspaceId,
        hostname,
        date: today,
        attempts: 1,
        okCount: result.outcome === 'ok' ? 1 : 0,
        blockedCount: result.outcome === 'blocked' ? 1 : 0,
        emptyCount: result.outcome === 'empty' ? 1 : 0,
        timeoutCount: result.outcome === 'timeout' ? 1 : 0,
        costUsd: result.costUsd,
        avgLatencyMs: result.latencyMs,
      },
      update: {
        attempts: { increment: 1 },
        [incrementField]: { increment: 1 },
        costUsd: { increment: result.costUsd },
        // avgLatencyMs would need proper averaging logic, skip for now
      },
    });
  }

  private getOutcomeField(outcome: FetchOutcome): string {
    switch (outcome) {
      case 'ok':
        return 'okCount';
      case 'blocked':
        return 'blockedCount';
      case 'empty':
        return 'emptyCount';
      case 'timeout':
        return 'timeoutCount';
      default:
        return 'blockedCount'; // Count other failures as blocked
    }
  }

  /**
   * Get domain reliability stats for UI
   */
  async getDomainReliability(
    workspaceId: string,
    hostname: string,
    days: number = 7,
  ): Promise<{
    successRate: number;
    emptyRate: number;
    blockedRate: number;
    totalAttempts: number;
    totalCost: number;
  }> {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);
    fromDate.setUTCHours(0, 0, 0, 0);

    const stats = await this.prisma.domainStats.aggregate({
      where: {
        workspaceId,
        hostname,
        date: { gte: fromDate },
      },
      _sum: {
        attempts: true,
        okCount: true,
        blockedCount: true,
        emptyCount: true,
        costUsd: true,
      },
    });

    const total = stats._sum.attempts ?? 0;
    const ok = stats._sum.okCount ?? 0;
    const blocked = stats._sum.blockedCount ?? 0;
    const empty = stats._sum.emptyCount ?? 0;

    return {
      successRate: total > 0 ? ok / total : 0,
      emptyRate: total > 0 ? empty / total : 0,
      blockedRate: total > 0 ? blocked / total : 0,
      totalAttempts: total,
      totalCost: stats._sum.costUsd ?? 0,
    };
  }
}
