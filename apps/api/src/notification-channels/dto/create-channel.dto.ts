import { IsString, IsEnum, IsOptional, ValidateNested, IsEmail, IsUrl, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ChannelType {
  EMAIL = 'email',
  SLACK_OAUTH = 'slack_oauth',
  DISCORD = 'discord',
  PUSH = 'push',
  WEBHOOK = 'webhook',
  // Legacy - kept for backwards compatibility, not shown in frontend
  TELEGRAM = 'telegram',
  SLACK = 'slack',
}

class EmailConfig {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;
}

class SlackOAuthConfig {
  @ApiProperty({ description: 'OAuth access token from Slack' })
  @IsString()
  accessToken!: string;

  @ApiProperty({ description: 'Selected channel ID' })
  @IsString()
  channelId!: string;

  @ApiProperty({ description: 'Channel name for display' })
  @IsString()
  channelName!: string;

  @ApiPropertyOptional({ description: 'Team/workspace name' })
  @IsOptional()
  @IsString()
  teamName?: string;
}

class DiscordConfig {
  @ApiProperty({ example: 'https://discord.com/api/webhooks/...' })
  @IsUrl()
  webhookUrl!: string;
}

class PushConfig {
  @ApiProperty({ description: 'OneSignal player ID' })
  @IsString()
  playerId!: string;

  @ApiPropertyOptional({ description: 'Device type (web, ios, android)' })
  @IsOptional()
  @IsString()
  deviceType?: string;
}

class WebhookConfig {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({ example: { 'X-API-Key': 'secret' } })
  @IsOptional()
  headers?: Record<string, string>;
}

// Legacy configs - kept for backwards compatibility
class TelegramConfig {
  @ApiProperty({ example: '123456789' })
  @IsString()
  chatId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  botToken?: string;
}

class SlackWebhookConfig {
  @ApiProperty({ example: 'https://hooks.slack.com/services/...' })
  @IsUrl()
  webhookUrl!: string;

  @ApiPropertyOptional({ example: '#monitoring' })
  @IsOptional()
  @IsString()
  channel?: string;
}

export class CreateChannelDto {
  @ApiProperty({ example: 'My Notifications' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: ChannelType })
  @IsEnum(ChannelType)
  type!: ChannelType;

  @ApiProperty({ example: 'workspace-id' })
  @IsUUID()
  workspaceId!: string;

  // New channel configs
  @ApiPropertyOptional({ type: EmailConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailConfig)
  emailConfig?: EmailConfig;

  @ApiPropertyOptional({ type: SlackOAuthConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => SlackOAuthConfig)
  slackOAuthConfig?: SlackOAuthConfig;

  @ApiPropertyOptional({ type: DiscordConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscordConfig)
  discordConfig?: DiscordConfig;

  @ApiPropertyOptional({ type: PushConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => PushConfig)
  pushConfig?: PushConfig;

  @ApiPropertyOptional({ type: WebhookConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookConfig)
  webhookConfig?: WebhookConfig;

  // Legacy configs - kept for backwards compatibility
  @ApiPropertyOptional({ type: TelegramConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramConfig)
  telegramConfig?: TelegramConfig;

  @ApiPropertyOptional({ type: SlackWebhookConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => SlackWebhookConfig)
  slackConfig?: SlackWebhookConfig;
}
