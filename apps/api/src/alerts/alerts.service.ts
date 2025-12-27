import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlertFilterDto, AlertStatusFilter } from './dto/alert-filter.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Verify that user has access to the workspace
   */
  private async verifyWorkspaceAccess(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: { userId },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
  }

  /**
   * List alerts with filters
   */
  async findMany(filters: AlertFilterDto, userId: string) {
    // Verify workspace access
    await this.verifyWorkspaceAccess(filters.workspaceId, userId);

    const where: Prisma.AlertWhereInput = {
      rule: { source: { workspaceId: filters.workspaceId } },
    };

    // Status filtering
    // TODO: Remove 'as any' after Prisma client regeneration
    if (filters.status && filters.status !== AlertStatusFilter.ALL) {
      if (filters.status === AlertStatusFilter.OPEN) {
        (where as any).resolvedAt = null;
        (where as any).acknowledgedAt = null;
      } else if (filters.status === AlertStatusFilter.ACKNOWLEDGED) {
        (where as any).acknowledgedAt = { not: null };
        (where as any).resolvedAt = null;
      } else if (filters.status === AlertStatusFilter.RESOLVED) {
        (where as any).resolvedAt = { not: null };
      }
    }

    // Severity filtering
    if (filters.severity) {
      where.severity = filters.severity;
    }

    // Rule filtering
    if (filters.ruleId) {
      where.ruleId = filters.ruleId;
    }

    // Time filtering
    if (filters.since) {
      where.triggeredAt = { gte: new Date(filters.since) };
    }

    const alerts = await this.prisma.alert.findMany({
      where,
      include: {
        rule: {
          select: {
            id: true,
            name: true,
            source: { select: { url: true, domain: true } },
          },
        },
      },
      orderBy: { triggeredAt: 'desc' },
      take: filters.limit || 50,
    });

    return {
      alerts,
      count: alerts.length,
    };
  }

  /**
   * Get single alert with access check
   */
  async findOne(id: string, userId: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: {
        rule: {
          include: { source: { include: { workspace: true } } },
        },
      },
    });

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    await this.verifyWorkspaceAccess(alert.rule.source.workspaceId, userId);

    return alert;
  }

  /**
   * Acknowledge alert
   */
  async acknowledge(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.alert.update({
      where: { id },
      data: {
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      } as any, // TODO: Regenerate Prisma client after migration
    });
  }

  /**
   * Resolve alert
   */
  async resolve(id: string, userId: string) {
    await this.findOne(id, userId);

    return this.prisma.alert.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  /**
   * Find recent alerts for SSE streaming (internal use)
   */
  async findRecent(workspaceId: string, userId: string, limit: number = 5) {
    await this.verifyWorkspaceAccess(workspaceId, userId);

    const alerts = await this.prisma.alert.findMany({
      where: {
        rule: { source: { workspaceId } },
        resolvedAt: null,
      },
      include: {
        rule: {
          select: {
            id: true,
            name: true,
            source: { select: { url: true, domain: true } },
          },
        },
      },
      orderBy: { triggeredAt: 'desc' },
      take: limit,
    });

    return alerts;
  }
}
