import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { WorkspaceRole } from '@prisma/client';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Find all workspaces where user is a member
   */
  async findAllByUser(userId: string) {
    // Find owned workspaces
    const ownedWorkspaces = await this.prisma.workspace.findMany({
      where: { ownerId: userId },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    // Find workspaces where user is a member (not owner)
    const memberWorkspaces = await this.prisma.workspace.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
        ownerId: {
          not: userId,
        },
      },
      include: {
        members: {
          where: { userId },
          select: { role: true },
        },
        _count: {
          select: { members: true },
        },
      },
    });

    // Format owned workspaces
    const formattedOwnedWorkspaces = ownedWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      timezone: workspace.timezone,
      createdAt: workspace.createdAt,
      role: WorkspaceRole.owner,
      memberCount: workspace._count.members,
    }));

    // Format member workspaces
    const formattedMemberWorkspaces = memberWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      timezone: workspace.timezone,
      createdAt: workspace.createdAt,
      role: workspace.members[0]?.role || WorkspaceRole.viewer,
      memberCount: workspace._count.members,
    }));

    return [...formattedOwnedWorkspaces, ...formattedMemberWorkspaces];
  }

  /**
   * Create new workspace with creator as owner
   */
  async create(userId: string, dto: CreateWorkspaceDto) {
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        type: dto.type,
        timezone: dto.timezone || 'Europe/Bratislava',
        ownerId: userId,
        members: {
          create: {
            userId,
            role: WorkspaceRole.owner,
          },
        },
      },
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    return {
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      timezone: workspace.timezone,
      createdAt: workspace.createdAt,
      role: WorkspaceRole.owner,
      memberCount: workspace._count.members,
    };
  }

  /**
   * Find one workspace with membership check
   */
  async findOne(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
        _count: {
          select: { members: true, sources: true },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if user is owner or member
    const isOwner = workspace.ownerId === userId;
    const membership = workspace.members.find((m) => m.userId === userId);

    if (!isOwner && !membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    return {
      id: workspace.id,
      name: workspace.name,
      type: workspace.type,
      timezone: workspace.timezone,
      createdAt: workspace.createdAt,
      ownerId: workspace.ownerId,
      role: isOwner ? WorkspaceRole.owner : membership!.role,
      memberCount: workspace._count.members,
      sourceCount: workspace._count.sources,
      members: workspace.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    };
  }

  /**
   * Update workspace (owner or admin only)
   */
  async update(id: string, userId: string, dto: UpdateWorkspaceDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        members: {
          where: { userId },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if user is owner or admin
    const isOwner = workspace.ownerId === userId;
    const membership = workspace.members[0];
    const isAdmin =
      membership && membership.role === WorkspaceRole.admin;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only workspace owner or admin can update workspace',
      );
    }

    const updated = await this.prisma.workspace.update({
      where: { id },
      data: dto,
      include: {
        _count: {
          select: { members: true },
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      type: updated.type,
      timezone: updated.timezone,
      createdAt: updated.createdAt,
      memberCount: updated._count.members,
    };
  }

  /**
   * Delete workspace (owner only)
   */
  async remove(id: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (workspace.ownerId !== userId) {
      throw new ForbiddenException('Only workspace owner can delete workspace');
    }

    await this.prisma.workspace.delete({
      where: { id },
    });

    return { message: 'Workspace deleted successfully' };
  }

  /**
   * Add member to workspace (owner or admin only)
   */
  async addMember(workspaceId: string, requesterId: string, dto: AddMemberDto) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: { userId: requesterId },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if requester is owner or admin
    const isOwner = workspace.ownerId === requesterId;
    const membership = workspace.members[0];
    const isAdmin =
      membership && membership.role === WorkspaceRole.admin;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only workspace owner or admin can add members',
      );
    }

    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user is already a member
    const existingMember = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: dto.userId,
        },
      },
    });

    if (existingMember) {
      throw new ConflictException('User is already a member of this workspace');
    }

    const member = await this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: dto.userId,
        role: dto.role,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    return {
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }

  /**
   * Remove member from workspace (owner or admin only)
   */
  async removeMember(
    workspaceId: string,
    requesterId: string,
    memberId: string,
  ) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: { userId: requesterId },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // Check if requester is owner or admin
    const isOwner = workspace.ownerId === requesterId;
    const membership = workspace.members[0];
    const isAdmin =
      membership && membership.role === WorkspaceRole.admin;

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException(
        'Only workspace owner or admin can remove members',
      );
    }

    // Find the member to remove
    const memberToRemove = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: memberId,
        },
      },
    });

    if (!memberToRemove) {
      throw new NotFoundException('Member not found in this workspace');
    }

    // Prevent owner from being removed
    if (memberToRemove.userId === workspace.ownerId) {
      throw new ForbiddenException('Cannot remove workspace owner');
    }

    await this.prisma.workspaceMember.delete({
      where: {
        id: memberToRemove.id,
      },
    });

    return { message: 'Member removed successfully' };
  }
}
