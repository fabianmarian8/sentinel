import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
