import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChannelDto, ChannelType } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'sentinel-default-encryption-key-32';
const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class NotificationChannelsService {
  constructor(private prisma: PrismaService) {}

  private encrypt(text: string): string {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32));
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new BadRequestException('Invalid encrypted data format');
    }
    const [ivHex, authTagHex, encrypted] = parts as [string, string, string];

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted: string = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private getConfigFromDto(dto: CreateChannelDto): Record<string, any> {
    switch (dto.type) {
      case ChannelType.EMAIL:
        if (!dto.emailConfig) throw new BadRequestException('emailConfig is required for email channel');
        return dto.emailConfig;
      case ChannelType.TELEGRAM:
        if (!dto.telegramConfig) throw new BadRequestException('telegramConfig is required for telegram channel');
        return dto.telegramConfig;
      case ChannelType.SLACK:
        if (!dto.slackConfig) throw new BadRequestException('slackConfig is required for slack channel');
        return dto.slackConfig;
      case ChannelType.WEBHOOK:
        if (!dto.webhookConfig) throw new BadRequestException('webhookConfig is required for webhook channel');
        return dto.webhookConfig;
      default:
        throw new BadRequestException('Invalid channel type');
    }
  }

  async create(userId: string, dto: CreateChannelDto) {
    // Check workspace membership
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId: dto.workspaceId,
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    const config = this.getConfigFromDto(dto);
    const encryptedConfig = this.encrypt(JSON.stringify(config));

    return this.prisma.notificationChannel.create({
      data: {
        workspaceId: dto.workspaceId,
        type: dto.type,
        name: dto.name,
        configEncrypted: encryptedConfig,
        enabled: true,
      },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        enabled: true,
        createdAt: true,
      },
    });
  }

  async findAllByWorkspace(userId: string, workspaceId: string) {
    // Check workspace membership
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    const channels = await this.prisma.notificationChannel.findMany({
      where: { workspaceId },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        enabled: true,
        createdAt: true,
        configEncrypted: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Decrypt and mask config for display
    return channels.map(ch => {
      let maskedConfig: Record<string, any> = {};
      try {
        const config = JSON.parse(this.decrypt(ch.configEncrypted));
        // Mask sensitive data
        if (ch.type === 'email') {
          maskedConfig = { email: config.email };
        } else if (ch.type === 'telegram') {
          maskedConfig = { chatId: config.chatId };
        } else if (ch.type === 'slack') {
          maskedConfig = { channel: config.channel || '#general' };
        } else if (ch.type === 'webhook') {
          maskedConfig = { url: config.url?.replace(/^(https?:\/\/[^/]+).*$/, '$1/...') };
        }
      } catch {
        maskedConfig = {};
      }

      return {
        id: ch.id,
        workspaceId: ch.workspaceId,
        type: ch.type,
        name: ch.name,
        enabled: ch.enabled,
        createdAt: ch.createdAt,
        config: maskedConfig,
      };
    });
  }

  async findOne(userId: string, id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    const isMember = channel.workspace.members.some(m => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    return {
      id: channel.id,
      workspaceId: channel.workspaceId,
      type: channel.type,
      name: channel.name,
      enabled: channel.enabled,
      createdAt: channel.createdAt,
    };
  }

  async update(userId: string, id: string, dto: UpdateChannelDto) {
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    const membership = channel.workspace.members.find(m => m.userId === userId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    // Build update data
    const updateData: any = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name;
    }

    if (dto.enabled !== undefined) {
      updateData.enabled = dto.enabled;
    }

    // Update config if provided
    const configUpdate = dto.emailConfig || dto.telegramConfig || dto.slackConfig || dto.webhookConfig;
    if (configUpdate) {
      updateData.configEncrypted = this.encrypt(JSON.stringify(configUpdate));
    }

    return this.prisma.notificationChannel.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        workspaceId: true,
        type: true,
        name: true,
        enabled: true,
        createdAt: true,
      },
    });
  }

  async remove(userId: string, id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    const membership = channel.workspace.members.find(m => m.userId === userId);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ForbiddenException('Only workspace owner or admin can delete notification channels');
    }

    await this.prisma.notificationChannel.delete({
      where: { id },
    });

    return { deleted: true };
  }

  async test(userId: string, id: string) {
    const channel = await this.prisma.notificationChannel.findUnique({
      where: { id },
      include: {
        workspace: {
          include: {
            members: true,
          },
        },
      },
    });

    if (!channel) {
      throw new NotFoundException('Notification channel not found');
    }

    const isMember = channel.workspace.members.some(m => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this workspace');
    }

    // TODO: Actually send a test notification
    // For now, just return success
    return {
      success: true,
      message: 'Test notification sent (simulation)',
    };
  }
}
