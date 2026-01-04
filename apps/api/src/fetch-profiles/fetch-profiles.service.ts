import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFetchProfileDto } from './dto/create-fetch-profile.dto';
import { UpdateFetchProfileDto } from './dto/update-fetch-profile.dto';
import { FetchProvider, WorkspaceRole } from '@prisma/client';

@Injectable()
export class FetchProfilesService {
  private readonly logger = new Logger(FetchProfilesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check if user has access to workspace (member or owner)
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
   * Check if user has admin access to workspace (owner or admin role)
   */
  private async verifyWorkspaceAdminAccess(
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
                role: { in: [WorkspaceRole.admin, WorkspaceRole.owner] },
              },
            },
          },
        ],
      },
    });

    if (!workspace) {
      throw new ForbiddenException(
        'You need admin access to modify fetch profiles',
      );
    }
  }

  /**
   * Check if user has access to fetch profile
   */
  private async verifyProfileAccess(
    profileId: string,
    userId: string,
  ): Promise<{ workspaceId: string }> {
    const profile = await this.prisma.fetchProfile.findFirst({
      where: {
        id: profileId,
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
      select: {
        workspaceId: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Fetch profile not found or access denied');
    }

    return profile;
  }

  /**
   * Validate cross-field constraints for domain policy
   */
  private validateDomainPolicy(
    preferredProvider?: FetchProvider | null,
    disabledProviders?: FetchProvider[],
    stopAfterPreferredFailure?: boolean,
  ): void {
    // If stopAfterPreferredFailure is true, preferredProvider must be set
    if (stopAfterPreferredFailure && !preferredProvider) {
      throw new BadRequestException(
        'stopAfterPreferredFailure requires preferredProvider to be set',
      );
    }

    // If preferredProvider is in disabledProviders, that's a conflict
    if (
      preferredProvider &&
      disabledProviders?.includes(preferredProvider)
    ) {
      throw new BadRequestException(
        'preferredProvider cannot be in disabledProviders list',
      );
    }
  }

  /**
   * Sanitize disabledProviders - remove unknown values
   */
  private sanitizeDisabledProviders(
    providers?: FetchProvider[],
  ): FetchProvider[] {
    if (!providers || providers.length === 0) {
      return [];
    }

    const validProviders = Object.values(FetchProvider);
    const sanitized = providers.filter((p) => {
      const isValid = validProviders.includes(p);
      if (!isValid) {
        this.logger.warn(`[FetchProfile] Unknown provider in disabledProviders: ${p} - dropping`);
      }
      return isValid;
    });

    return sanitized;
  }

  /**
   * Find all fetch profiles in a workspace
   */
  async findByWorkspace(workspaceId: string, userId: string) {
    await this.verifyWorkspaceAccess(workspaceId, userId);

    const profiles = await this.prisma.fetchProfile.findMany({
      where: {
        workspaceId,
      },
      include: {
        _count: {
          select: {
            sources: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return profiles;
  }

  /**
   * Create a new fetch profile
   */
  async create(userId: string, dto: CreateFetchProfileDto) {
    await this.verifyWorkspaceAdminAccess(dto.workspaceId, userId);

    // Validate domain policy cross-field constraints
    this.validateDomainPolicy(
      dto.preferredProvider,
      dto.disabledProviders,
      dto.stopAfterPreferredFailure,
    );

    // Sanitize disabledProviders
    const sanitizedDisabled = this.sanitizeDisabledProviders(dto.disabledProviders);

    // Check for duplicate name in workspace
    const existing = await this.prisma.fetchProfile.findFirst({
      where: {
        workspaceId: dto.workspaceId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new BadRequestException(
        'A fetch profile with this name already exists in the workspace',
      );
    }

    const profile = await this.prisma.fetchProfile.create({
      data: {
        workspaceId: dto.workspaceId,
        name: dto.name,
        mode: dto.mode,
        userAgent: dto.userAgent,
        preferredProvider: dto.preferredProvider,
        disabledProviders: sanitizedDisabled,
        stopAfterPreferredFailure: dto.stopAfterPreferredFailure ?? false,
        flareSolverrWaitSeconds: dto.flareSolverrWaitSeconds,
        renderWaitMs: dto.renderWaitMs,
        screenshotOnChange: dto.screenshotOnChange ?? false,
        geoCountry: dto.geoCountry,
      },
      include: {
        _count: {
          select: {
            sources: true,
          },
        },
      },
    });

    this.logger.log(
      `[FetchProfile] Created profile "${dto.name}" in workspace ${dto.workspaceId}`,
    );

    return profile;
  }

  /**
   * Find one fetch profile by ID
   */
  async findOne(id: string, userId: string) {
    await this.verifyProfileAccess(id, userId);

    const profile = await this.prisma.fetchProfile.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            sources: true,
          },
        },
        sources: {
          select: {
            id: true,
            url: true,
            domain: true,
          },
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!profile) {
      throw new NotFoundException('Fetch profile not found');
    }

    return profile;
  }

  /**
   * Update a fetch profile
   */
  async update(id: string, userId: string, dto: UpdateFetchProfileDto) {
    const { workspaceId } = await this.verifyProfileAccess(id, userId);
    await this.verifyWorkspaceAdminAccess(workspaceId, userId);

    // Get current profile for merge
    const current = await this.prisma.fetchProfile.findUnique({
      where: { id },
    });

    if (!current) {
      throw new NotFoundException('Fetch profile not found');
    }

    // Merge with current values for validation
    const mergedPreferred = dto.preferredProvider !== undefined
      ? dto.preferredProvider
      : current.preferredProvider;
    const mergedDisabled = dto.disabledProviders !== undefined
      ? dto.disabledProviders
      : (current.disabledProviders as FetchProvider[]);
    const mergedStop = dto.stopAfterPreferredFailure !== undefined
      ? dto.stopAfterPreferredFailure
      : current.stopAfterPreferredFailure;

    // Validate domain policy cross-field constraints
    this.validateDomainPolicy(mergedPreferred, mergedDisabled, mergedStop);

    // Sanitize disabledProviders if provided
    const sanitizedDisabled = dto.disabledProviders !== undefined
      ? this.sanitizeDisabledProviders(dto.disabledProviders)
      : undefined;

    // Check for duplicate name if changing
    if (dto.name && dto.name !== current.name) {
      const existing = await this.prisma.fetchProfile.findFirst({
        where: {
          workspaceId,
          name: dto.name,
          id: { not: id },
        },
      });

      if (existing) {
        throw new BadRequestException(
          'A fetch profile with this name already exists in the workspace',
        );
      }
    }

    const profile = await this.prisma.fetchProfile.update({
      where: { id },
      data: {
        name: dto.name,
        mode: dto.mode,
        userAgent: dto.userAgent,
        preferredProvider: dto.preferredProvider,
        disabledProviders: sanitizedDisabled,
        stopAfterPreferredFailure: dto.stopAfterPreferredFailure,
        flareSolverrWaitSeconds: dto.flareSolverrWaitSeconds,
        renderWaitMs: dto.renderWaitMs,
        screenshotOnChange: dto.screenshotOnChange,
        geoCountry: dto.geoCountry,
      },
      include: {
        _count: {
          select: {
            sources: true,
          },
        },
      },
    });

    this.logger.log(`[FetchProfile] Updated profile ${id}`);

    return profile;
  }

  /**
   * Delete a fetch profile
   */
  async remove(id: string, userId: string) {
    const { workspaceId } = await this.verifyProfileAccess(id, userId);
    await this.verifyWorkspaceAdminAccess(workspaceId, userId);

    // Check if profile is in use
    const sourcesCount = await this.prisma.source.count({
      where: {
        fetchProfileId: id,
      },
    });

    if (sourcesCount > 0) {
      throw new BadRequestException(
        `Cannot delete profile: ${sourcesCount} source(s) are using it. Reassign them first.`,
      );
    }

    await this.prisma.fetchProfile.delete({
      where: { id },
    });

    this.logger.log(`[FetchProfile] Deleted profile ${id}`);

    return {
      message: 'Fetch profile deleted successfully',
    };
  }
}
