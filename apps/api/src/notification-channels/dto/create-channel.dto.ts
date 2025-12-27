import { IsString, IsEnum, IsOptional, ValidateNested, IsEmail, IsUrl } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ChannelType {
  EMAIL = 'email',
  TELEGRAM = 'telegram',
  SLACK = 'slack',
  WEBHOOK = 'webhook',
}

class EmailConfig {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email!: string;
}

class TelegramConfig {
  @ApiProperty({ example: '123456789' })
  @IsString()
  chatId!: string;

  @ApiPropertyOptional({ description: 'Bot token (use default if not provided)' })
  @IsOptional()
  @IsString()
  botToken?: string;
}

class SlackConfig {
  @ApiProperty({ example: 'https://hooks.slack.com/services/...' })
  @IsUrl()
  webhookUrl!: string;

  @ApiPropertyOptional({ example: '#monitoring' })
  @IsOptional()
  @IsString()
  channel?: string;
}

class WebhookConfig {
  @ApiProperty({ example: 'https://example.com/webhook' })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({ example: { 'X-API-Key': 'secret' } })
  @IsOptional()
  headers?: Record<string, string>;
}

export class CreateChannelDto {
  @ApiProperty({ example: 'My Email Notifications' })
  @IsString()
  name!: string;

  @ApiProperty({ enum: ChannelType })
  @IsEnum(ChannelType)
  type!: ChannelType;

  @ApiProperty({ example: 'workspace-id' })
  @IsString()
  workspaceId!: string;

  @ApiPropertyOptional({ type: EmailConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmailConfig)
  emailConfig?: EmailConfig;

  @ApiPropertyOptional({ type: TelegramConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => TelegramConfig)
  telegramConfig?: TelegramConfig;

  @ApiPropertyOptional({ type: SlackConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => SlackConfig)
  slackConfig?: SlackConfig;

  @ApiPropertyOptional({ type: WebhookConfig })
  @IsOptional()
  @ValidateNested()
  @Type(() => WebhookConfig)
  webhookConfig?: WebhookConfig;
}
