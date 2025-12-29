import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

interface ScheduleConfig {
  intervalSeconds: number;
  jitterSeconds?: number;
  cron?: string;
}

@Injectable()
export class RulesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check if user has access to workspace
   */
  private async verifyWorkspaceAccess(
    workspaceId: string,
    userId: string,
  ): Promise<void> {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: userId },
          {
            members: {
              some: {
                userId,
              },
            },
          },
        ],
      },
    });

    if (!workspace) {
      throw new ForbiddenException(
        'You do not have access to this workspace',
      );
    }
  }

  /**
   * Check if user has access to source
   */
  private async verifySourceAccess(
    sourceId: string,
    userId: string,
  ): Promise<void> {
    const source = await this.prisma.source.findFirst({
      where: {
        id: sourceId,
        workspace: {
          OR: [
            { ownerId: userId },
            {
              members: {
                some: {
                  userId,
                },
              },
            },
          ],
        },
      },
    });

    if (!source) {
      throw new NotFoundException('Source not found or access denied');
    }
  }

  /**
   * Check if user has access to rule
   */
  private async verifyRuleAccess(
    ruleId: string,
    userId: string,
  ): Promise<void> {
    const rule = await this.prisma.rule.findFirst({
      where: {
        id: ruleId,
        source: {
          workspace: {
            OR: [
              { ownerId: userId },
              {
                members: {
                  some: {
                    userId,
                  },
                },
              },
            ],
          },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException('Rule not found or access denied');
    }
  }

  /**
   * Calculate next run time based on schedule config
   */
  private calculateNextRunAt(schedule: ScheduleConfig | Prisma.JsonValue): Date {
    const config = schedule as ScheduleConfig;
    const intervalMs = (config.intervalSeconds ?? 300) * 1000;
    const jitterMs = config.jitterSeconds
      ? Math.random() * config.jitterSeconds * 1000
      : 0;
    return new Date(Date.now() + intervalMs + jitterMs);
  }

  /**
   * Find all rules in a workspace
   */
  async findByWorkspace(workspaceId: string, userId: string) {
    // Verify workspace access
    await this.verifyWorkspaceAccess(workspaceId, userId);

    // Get all rules via sources in workspace
    const rules = await this.prisma.rule.findMany({
      where: {
        source: {
          workspaceId,
        },
      },
      include: {
        source: {
          select: {
            id: true,
            url: true,
            domain: true,
          },
        },
        state: true,
        _count: {
          select: {
            observations: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return rules.map((rule) => ({
      id: rule.id,
      sourceId: rule.sourceId,
      source: rule.source,
      name: rule.name,
      ruleType: rule.ruleType,
      enabled: rule.enabled,
      healthScore: rule.healthScore,
      lastErrorCode: rule.lastErrorCode,
      lastErrorAt: rule.lastErrorAt,
      nextRunAt: rule.nextRunAt,
      createdAt: rule.createdAt,
      observationCount: rule._count.observations,
      alertPolicy: rule.alertPolicy,
      captchaIntervalEnforced: rule.captchaIntervalEnforced,
      originalSchedule: rule.originalSchedule,
      currentState: rule.state
        ? {
            lastStable: rule.state.lastStable,
            candidate: rule.state.candidate,
            candidateCount: rule.state.candidateCount,
            updatedAt: rule.state.updatedAt,
          }
        : null,
    }));
  }

  /**
   * Find all rules for a specific source
   */
  async findBySource(sourceId: string, userId: string) {
    // Verify source access
    await this.verifySourceAccess(sourceId, userId);

    const rules = await this.prisma.rule.findMany({
      where: {
        sourceId,
      },
      include: {
        state: true,
        _count: {
          select: {
            observations: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return rules.map((rule) => ({
      id: rule.id,
      sourceId: rule.sourceId,
      name: rule.name,
      ruleType: rule.ruleType,
      enabled: rule.enabled,
      healthScore: rule.healthScore,
      lastErrorCode: rule.lastErrorCode,
      lastErrorAt: rule.lastErrorAt,
      nextRunAt: rule.nextRunAt,
      createdAt: rule.createdAt,
      observationCount: rule._count.observations,
      alertPolicy: rule.alertPolicy,
      currentState: rule.state
        ? {
            lastStable: rule.state.lastStable,
            candidate: rule.state.candidate,
            candidateCount: rule.state.candidateCount,
            updatedAt: rule.state.updatedAt,
          }
        : null,
    }));
  }

  /**
   * Create a new rule
   */
  async create(userId: string, dto: CreateRuleDto) {
    // Verify source access
    await this.verifySourceAccess(dto.sourceId, userId);

    // Calculate initial nextRunAt
    const nextRunAt = this.calculateNextRunAt(dto.schedule);

    // Create rule and initial state in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const rule = await tx.rule.create({
        data: {
          sourceId: dto.sourceId,
          name: dto.name,
          ruleType: dto.ruleType,
          extraction: dto.extraction as any,
          normalization: dto.normalization as any,
          schedule: dto.schedule as any,
          alertPolicy: dto.alertPolicy as any,
          enabled: dto.enabled ?? true,
          nextRunAt,
        },
        include: {
          source: {
            select: {
              id: true,
              url: true,
              domain: true,
              workspace: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      // Create initial rule state
      const state = await tx.ruleState.create({
        data: {
          ruleId: rule.id,
          candidateCount: 0,
        },
      });

      return { rule, state };
    });

    return {
      id: result.rule.id,
      sourceId: result.rule.sourceId,
      source: result.rule.source,
      name: result.rule.name,
      ruleType: result.rule.ruleType,
      extraction: result.rule.extraction,
      normalization: result.rule.normalization,
      schedule: result.rule.schedule,
      alertPolicy: result.rule.alertPolicy,
      enabled: result.rule.enabled,
      healthScore: result.rule.healthScore,
      lastErrorCode: result.rule.lastErrorCode,
      lastErrorAt: result.rule.lastErrorAt,
      nextRunAt: result.rule.nextRunAt,
      createdAt: result.rule.createdAt,
      currentState: {
        lastStable: result.state.lastStable,
        candidate: result.state.candidate,
        candidateCount: result.state.candidateCount,
      },
      latestObservations: [],
    };
  }

  /**
   * Find one rule by ID with latest observations
   */
  async findOne(id: string, userId: string) {
    // Verify rule access
    await this.verifyRuleAccess(id, userId);

    const rule = await this.prisma.rule.findUnique({
      where: { id },
      include: {
        source: {
          select: {
            id: true,
            url: true,
            domain: true,
            workspace: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        state: true,
        observations: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
          include: {
            run: {
              select: {
                startedAt: true,
                finishedAt: true,
                httpStatus: true,
                errorCode: true,
                screenshotPath: true,
              },
            },
          },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException('Rule not found');
    }

    return {
      id: rule.id,
      sourceId: rule.sourceId,
      source: rule.source,
      name: rule.name,
      ruleType: rule.ruleType,
      extraction: rule.extraction,
      normalization: rule.normalization,
      schedule: rule.schedule,
      alertPolicy: rule.alertPolicy,
      enabled: rule.enabled,
      screenshotOnChange: rule.screenshotOnChange,
      healthScore: rule.healthScore,
      lastErrorCode: rule.lastErrorCode,
      lastErrorAt: rule.lastErrorAt,
      nextRunAt: rule.nextRunAt,
      createdAt: rule.createdAt,
      captchaIntervalEnforced: rule.captchaIntervalEnforced,
      originalSchedule: rule.originalSchedule,
      currentState: rule.state
        ? {
            lastStable: rule.state.lastStable,
            candidate: rule.state.candidate,
            candidateCount: rule.state.candidateCount,
            updatedAt: rule.state.updatedAt,
          }
        : null,
      latestObservations: rule.observations.map((obs) => ({
        id: obs.id,
        extractedRaw: obs.extractedRaw,
        extractedNormalized: obs.extractedNormalized,
        changeDetected: obs.changeDetected,
        changeKind: obs.changeKind,
        diffSummary: obs.diffSummary,
        createdAt: obs.createdAt,
        run: obs.run,
      })),
    };
  }

  /**
   * Update a rule (with transaction for consistency)
   */
  async update(id: string, userId: string, dto: UpdateRuleDto) {
    return await this.prisma.$transaction(async (tx) => {
      // Verify rule access inside transaction
      const currentRule = await tx.rule.findFirst({
        where: {
          id,
          source: {
            workspace: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
              ],
            },
          },
        },
      });

      if (!currentRule) {
        throw new NotFoundException('Rule not found or access denied');
      }

      // Prepare update data with proper typing
      const updateData: Prisma.RuleUpdateInput = {};

      if (dto.name !== undefined) updateData.name = dto.name;
      if (dto.ruleType !== undefined) updateData.ruleType = dto.ruleType;
      if (dto.extraction !== undefined) updateData.extraction = dto.extraction;
      if (dto.normalization !== undefined)
        updateData.normalization = dto.normalization;
      if (dto.alertPolicy !== undefined)
        updateData.alertPolicy = dto.alertPolicy;
      if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
      if (dto.screenshotOnChange !== undefined)
        updateData.screenshotOnChange = dto.screenshotOnChange;

      // If schedule is being updated, recalculate nextRunAt
      if (dto.schedule !== undefined) {
        updateData.schedule = dto.schedule;
        updateData.nextRunAt = this.calculateNextRunAt(dto.schedule);
      }

      // Update rule
      const rule = await tx.rule.update({
        where: { id },
        data: updateData,
        include: {
          source: {
            select: {
              id: true,
              url: true,
              domain: true,
              workspace: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          state: true,
          observations: {
            orderBy: {
              createdAt: 'desc',
            },
            take: 5,
          },
        },
      });

      return {
        id: rule.id,
        sourceId: rule.sourceId,
        source: rule.source,
        name: rule.name,
        ruleType: rule.ruleType,
        extraction: rule.extraction,
        normalization: rule.normalization,
        schedule: rule.schedule,
        alertPolicy: rule.alertPolicy,
        enabled: rule.enabled,
        screenshotOnChange: rule.screenshotOnChange,
        healthScore: rule.healthScore,
        lastErrorCode: rule.lastErrorCode,
        lastErrorAt: rule.lastErrorAt,
        nextRunAt: rule.nextRunAt,
        createdAt: rule.createdAt,
        currentState: rule.state
          ? {
              lastStable: rule.state.lastStable,
              candidate: rule.state.candidate,
              candidateCount: rule.state.candidateCount,
              updatedAt: rule.state.updatedAt,
            }
          : null,
        latestObservations: rule.observations,
      };
    });
  }

  /**
   * Delete a rule (with transaction for consistency)
   */
  async remove(id: string, userId: string) {
    return await this.prisma.$transaction(async (tx) => {
      // Verify rule access inside transaction
      const rule = await tx.rule.findFirst({
        where: {
          id,
          source: {
            workspace: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId } } },
              ],
            },
          },
        },
      });

      if (!rule) {
        throw new NotFoundException('Rule not found or access denied');
      }

      // Delete rule (cascade will handle state, runs, observations, alerts)
      await tx.rule.delete({
        where: { id },
      });

      return {
        deleted: true,
        message: 'Rule deleted successfully',
      };
    });
  }

  /**
   * Pause a rule (set enabled=false)
   */
  async pause(id: string, userId: string) {
    // Verify rule access
    await this.verifyRuleAccess(id, userId);

    const rule = await this.prisma.rule.update({
      where: { id },
      data: {
        enabled: false,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
      },
    });

    return {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      message: 'Rule paused successfully',
    };
  }

  /**
   * Resume a rule (set enabled=true, recalculate nextRunAt)
   */
  async resume(id: string, userId: string) {
    // Verify rule access
    await this.verifyRuleAccess(id, userId);

    // Get current rule to access schedule
    const currentRule = await this.prisma.rule.findUnique({
      where: { id },
    });

    if (!currentRule) {
      throw new NotFoundException('Rule not found');
    }

    // Calculate new nextRunAt
    const nextRunAt = this.calculateNextRunAt(currentRule.schedule);

    const rule = await this.prisma.rule.update({
      where: { id },
      data: {
        enabled: true,
        nextRunAt,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        nextRunAt: true,
      },
    });

    return {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      nextRunAt: rule.nextRunAt,
      message: 'Rule resumed successfully',
    };
  }
}
