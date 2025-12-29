import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { CreateChannelDto, ChannelType } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class NotificationChannelsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private encrypt(text: string): string {
    const encryptionKey = this.config.encryptionKey;
    const key = Buffer.from(encryptionKey.slice(0, 32));
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const encryptionKey = this.config.encryptionKey;
    const key = Buffer.from(encryptionKey.slice(0, 32));
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
      case ChannelType.SLACK_OAUTH:
        if (!dto.slackOAuthConfig) throw new BadRequestException('slackOAuthConfig is required for slack_oauth channel');
        return dto.slackOAuthConfig;
      case ChannelType.DISCORD:
        if (!dto.discordConfig) throw new BadRequestException('discordConfig is required for discord channel');
        return dto.discordConfig;
      case ChannelType.PUSH:
        if (!dto.pushConfig) throw new BadRequestException('pushConfig is required for push channel');
        return dto.pushConfig;
      case ChannelType.WEBHOOK:
        if (!dto.webhookConfig) throw new BadRequestException('webhookConfig is required for webhook channel');
        return dto.webhookConfig;
      // Legacy types
      case ChannelType.TELEGRAM:
        if (!dto.telegramConfig) throw new BadRequestException('telegramConfig is required for telegram channel');
        return dto.telegramConfig;
      case ChannelType.SLACK:
        if (!dto.slackConfig) throw new BadRequestException('slackConfig is required for slack channel');
        return dto.slackConfig;
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
        } else if (ch.type === 'slack_oauth') {
          maskedConfig = { channelName: config.channelName, teamName: config.teamName };
        } else if (ch.type === 'discord') {
          maskedConfig = { webhookUrl: config.webhookUrl?.replace(/\/webhooks\/\d+\/.*$/, '/webhooks/***') };
        } else if (ch.type === 'push') {
          maskedConfig = { deviceType: config.deviceType || 'web' };
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

    // Decrypt config and send test notification
    let config: Record<string, any>;
    try {
      config = JSON.parse(this.decrypt(channel.configEncrypted));
    } catch {
      throw new BadRequestException('Failed to decrypt channel configuration');
    }

    const testMessage = `🧪 Test notification from Sentinel\n\nThis is a test message to verify your notification channel is working correctly.\n\nWorkspace: ${channel.workspace.name}\nChannel: ${channel.name}\nTime: ${new Date().toISOString()}`;

    try {
      switch (channel.type) {
        case 'slack_oauth': {
          const response = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              channel: config.channelId,
              text: testMessage,
            }),
          });
          const data = await response.json() as any;
          if (!data.ok) {
            throw new BadRequestException(`Slack API error: ${data.error}`);
          }
          return { success: true, message: 'Test notification sent to Slack' };
        }

        case 'discord': {
          const response = await fetch(config.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: testMessage }),
          });
          if (!response.ok) {
            throw new BadRequestException(`Discord webhook error: ${response.status}`);
          }
          return { success: true, message: 'Test notification sent to Discord' };
        }

        case 'email': {
          // TODO: Implement email sending via Resend
          return { success: true, message: 'Email test notification (not yet implemented)' };
        }

        case 'webhook': {
          const response = await fetch(config.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...config.headers,
            },
            body: JSON.stringify({
              type: 'test',
              message: testMessage,
              timestamp: new Date().toISOString(),
            }),
          });
          if (!response.ok) {
            throw new BadRequestException(`Webhook error: ${response.status}`);
          }
          return { success: true, message: 'Test notification sent to webhook' };
        }

        default:
          return { success: false, message: `Channel type ${channel.type} not supported for testing` };
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Failed to send test notification: ${error.message}`);
    }
  }

  /**
   * Exchange Slack OAuth code for access token
   */
  async exchangeSlackCode(code: string, redirectUri: string): Promise<{
    accessToken: string;
    teamName: string;
    teamId: string;
  }> {
    const clientId = this.config.slackClientId;
    const clientSecret = this.config.slackClientSecret;

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Slack OAuth not configured');
    }

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    const data = await response.json() as any;

    if (!data.ok) {
      throw new BadRequestException(`Slack OAuth failed: ${data.error}`);
    }

    return {
      accessToken: data.access_token,
      teamName: data.team?.name || '',
      teamId: data.team?.id || '',
    };
  }

  /**
   * List Slack channels for user to select
   */
  async listSlackChannels(accessToken: string): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const data = await response.json() as any;

    if (!data.ok) {
      throw new BadRequestException(`Failed to list Slack channels: ${data.error}`);
    }

    return data.channels.map((ch: any) => ({
      id: ch.id,
      name: ch.name,
    }));
  }

  /**
   * Get Slack OAuth authorization URL
   */
  getSlackAuthUrl(redirectUri: string): string {
    const clientId = this.config.slackClientId;
    if (!clientId) {
      throw new BadRequestException('Slack OAuth not configured');
    }

    const scopes = 'chat:write,chat:write.public,channels:read,groups:read';
    return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
}
