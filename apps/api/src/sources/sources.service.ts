import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { normalizeUrl } from './utils/url-normalizer';

@Injectable()
export class SourcesService {
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
   * Find all sources in a workspace
   */
  async findByWorkspace(workspaceId: string, userId: string) {
    // Verify workspace access
    await this.verifyWorkspaceAccess(workspaceId, userId);

    // Get sources with related data
    const sources = await this.prisma.source.findMany({
      where: {
        workspaceId,
      },
      include: {
        fetchProfile: {
          select: {
            id: true,
            name: true,
            mode: true,
          },
        },
        _count: {
          select: {
            rules: true,
          },
        },
        rules: {
          where: {
            enabled: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            runs: {
              where: {
                finishedAt: {
                  not: null,
                },
                errorCode: null,
              },
              orderBy: {
                finishedAt: 'desc',
              },
              take: 1,
              select: {
                finishedAt: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Transform response to include last successful run
    return sources.map((source) => {
      const lastSuccessfulRun =
        source.rules[0]?.runs[0]?.finishedAt || null;

      const { rules, ...sourceData } = source;

      return {
        ...sourceData,
        lastSuccessfulRunAt: lastSuccessfulRun,
      };
    });
  }

  /**
   * Create a new source
   */
  async create(userId: string, dto: CreateSourceDto) {
    // Verify workspace access
    await this.verifyWorkspaceAccess(dto.workspaceId, userId);

    // Verify fetch profile exists and belongs to workspace (if provided)
    if (dto.fetchProfileId) {
      const fetchProfile = await this.prisma.fetchProfile.findFirst({
        where: {
          id: dto.fetchProfileId,
          workspaceId: dto.workspaceId,
        },
      });

      if (!fetchProfile) {
        throw new BadRequestException(
          'Fetch profile not found or does not belong to this workspace',
        );
      }
    }

    // Normalize URL
    const { canonical, domain } = normalizeUrl(dto.url);

    // Check for duplicate URL in workspace (optional warning)
    const existingSource = await this.prisma.source.findFirst({
      where: {
        workspaceId: dto.workspaceId,
        OR: [
          { url: dto.url },
          { canonicalUrl: canonical },
        ],
      },
    });

    if (existingSource) {
      throw new BadRequestException(
        'A source with this URL already exists in the workspace',
      );
    }

    // Create source
    const source = await this.prisma.source.create({
      data: {
        workspaceId: dto.workspaceId,
        url: dto.url,
        canonicalUrl: canonical,
        domain,
        fetchProfileId: dto.fetchProfileId,
        tags: dto.tags || [],
      },
      include: {
        fetchProfile: {
          select: {
            id: true,
            name: true,
            mode: true,
          },
        },
        _count: {
          select: {
            rules: true,
          },
        },
      },
    });

    return {
      ...source,
      lastSuccessfulRunAt: null,
    };
  }

  /**
   * Find one source by ID
   */
  async findOne(id: string, userId: string) {
    // Verify source access
    await this.verifySourceAccess(id, userId);

    const source = await this.prisma.source.findUnique({
      where: { id },
      include: {
        fetchProfile: {
          select: {
            id: true,
            name: true,
            mode: true,
          },
        },
        _count: {
          select: {
            rules: true,
          },
        },
        rules: {
          where: {
            enabled: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            runs: {
              where: {
                finishedAt: {
                  not: null,
                },
                errorCode: null,
              },
              orderBy: {
                finishedAt: 'desc',
              },
              take: 1,
              select: {
                finishedAt: true,
              },
            },
          },
        },
      },
    });

    if (!source) {
      throw new NotFoundException('Source not found');
    }

    const lastSuccessfulRun =
      source.rules[0]?.runs[0]?.finishedAt || null;

    const { rules, ...sourceData } = source;

    return {
      ...sourceData,
      lastSuccessfulRunAt: lastSuccessfulRun,
    };
  }

  /**
   * Update a source
   */
  async update(id: string, userId: string, dto: UpdateSourceDto) {
    // Verify source access
    await this.verifySourceAccess(id, userId);

    // Get current source
    const currentSource = await this.prisma.source.findUnique({
      where: { id },
    });

    if (!currentSource) {
      throw new NotFoundException('Source not found');
    }

    // If updating fetch profile, verify it exists and belongs to workspace
    if (dto.fetchProfileId) {
      const fetchProfile = await this.prisma.fetchProfile.findFirst({
        where: {
          id: dto.fetchProfileId,
          workspaceId: currentSource.workspaceId,
        },
      });

      if (!fetchProfile) {
        throw new BadRequestException(
          'Fetch profile not found or does not belong to this workspace',
        );
      }
    }

    // Prepare update data
    const updateData: any = {
      fetchProfileId: dto.fetchProfileId,
      tags: dto.tags,
    };

    // If URL is being updated, normalize it
    if (dto.url && dto.url !== currentSource.url) {
      const { canonical, domain } = normalizeUrl(dto.url);

      // Check for duplicate URL in workspace
      const existingSource = await this.prisma.source.findFirst({
        where: {
          workspaceId: currentSource.workspaceId,
          id: { not: id },
          OR: [
            { url: dto.url },
            { canonicalUrl: canonical },
          ],
        },
      });

      if (existingSource) {
        throw new BadRequestException(
          'A source with this URL already exists in the workspace',
        );
      }

      updateData.url = dto.url;
      updateData.canonicalUrl = canonical;
      updateData.domain = domain;
    }

    // Update source
    const source = await this.prisma.source.update({
      where: { id },
      data: updateData,
      include: {
        fetchProfile: {
          select: {
            id: true,
            name: true,
            mode: true,
          },
        },
        _count: {
          select: {
            rules: true,
          },
        },
        rules: {
          where: {
            enabled: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            runs: {
              where: {
                finishedAt: {
                  not: null,
                },
                errorCode: null,
              },
              orderBy: {
                finishedAt: 'desc',
              },
              take: 1,
              select: {
                finishedAt: true,
              },
            },
          },
        },
      },
    });

    const lastSuccessfulRun =
      source.rules[0]?.runs[0]?.finishedAt || null;

    const { rules, ...sourceData } = source;

    return {
      ...sourceData,
      lastSuccessfulRunAt: lastSuccessfulRun,
    };
  }

  /**
   * Delete a source
   */
  async remove(id: string, userId: string) {
    // Verify source access
    await this.verifySourceAccess(id, userId);

    // Delete source (cascade will handle related rules)
    await this.prisma.source.delete({
      where: { id },
    });

    return {
      message: 'Source deleted successfully',
    };
  }
}
