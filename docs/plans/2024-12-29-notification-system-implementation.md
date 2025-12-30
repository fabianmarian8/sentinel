# Notification System Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify notification setup UX - OAuth for Slack, Discord webhooks, OneSignal push, remove Telegram.

**Architecture:** Add new channel types (slack_oauth, discord, push) to DB enum, implement sending logic in worker, update frontend with new channel UIs and OAuth flow.

**Tech Stack:** Prisma, NestJS, Next.js, Slack OAuth 2.0, OneSignal Web SDK, Discord Webhooks

**Design Document:** `docs/plans/2024-12-29-notification-system-redesign.md`

---

## Task 1: Database Migration - Add New Enum Values

**Files:**
- Modify: `packages/shared/prisma/schema.prisma:51-56`
- Create: `packages/shared/prisma/migrations/YYYYMMDD_add_notification_channels/migration.sql`

**Step 1: Update Prisma enum**

Edit `packages/shared/prisma/schema.prisma`, find the `NotificationChannelType` enum and add new values:

```prisma
enum NotificationChannelType {
  email
  telegram      // Keep for backwards compatibility, remove from frontend
  slack         // Keep for backwards compatibility, remove from frontend
  slack_oauth   // NEW: Slack with OAuth
  discord       // NEW: Discord webhook
  push          // NEW: OneSignal push notifications
  webhook
}
```

**Step 2: Generate migration**

Run:
```bash
cd packages/shared && npx prisma migrate dev --name add_notification_channel_types
```

Expected: Migration created successfully

**Step 3: Verify migration**

Run:
```bash
cd packages/shared && npx prisma migrate status
```

Expected: All migrations applied

**Step 4: Commit**

```bash
git add packages/shared/prisma/
git commit -m "feat(db): add slack_oauth, discord, push notification channel types"
```

---

## Task 2: Backend - Update DTOs for New Channel Types

**Files:**
- Modify: `apps/api/src/notification-channels/dto/create-channel.dto.ts`

**Step 1: Add new config classes and update enum**

Replace the entire file with:

```typescript
import { IsString, IsEnum, IsOptional, ValidateNested, IsEmail, IsUrl } from 'class-validator';
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
  @IsString()
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
```

**Step 2: Update service to handle new types**

Edit `apps/api/src/notification-channels/notification-channels.service.ts`, update `getConfigFromDto` method:

```typescript
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
```

**Step 3: Update masked config display in service**

In `findAllByWorkspace` method, update the masking logic:

```typescript
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
```

**Step 4: Commit**

```bash
git add apps/api/src/notification-channels/
git commit -m "feat(api): add DTOs for slack_oauth, discord, push channel types"
```

---

## Task 3: Backend - Discord Webhook Sending

**Files:**
- Modify: `apps/worker/src/processors/alert.processor.ts`

**Step 1: Add Discord sending method**

Add this method to the `AlertProcessor` class:

```typescript
/**
 * Send Discord notification via webhook
 */
private async sendDiscordNotification(
  channel: any,
  alert: any,
): Promise<{ success: boolean; error?: string }> {
  try {
    const decryptedConfig = this.decrypt(channel.configEncrypted);
    const config = JSON.parse(decryptedConfig);
    const webhookUrl = config.webhookUrl;

    if (!webhookUrl) {
      return { success: false, error: 'Discord webhook URL not configured' };
    }

    // Map severity to Discord embed color
    const colorMap: Record<string, number> = {
      low: 0x3b82f6,      // blue
      medium: 0xf59e0b,   // amber
      high: 0xdc2626,     // red
      critical: 0x7c3aed, // purple
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Sentinel',
        avatar_url: 'https://sentinel-app.pages.dev/logo.png',
        embeds: [{
          title: alert.title,
          description: alert.body,
          color: colorMap[alert.severity] || 0x3b82f6,
          url: alert.rule.source.url,
          fields: [
            { name: 'Rule', value: alert.rule.name, inline: true },
            { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
          ],
          timestamp: alert.triggeredAt,
          footer: { text: 'Sentinel Alerts' },
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `Discord API error: ${response.status} - ${errorText}` };
    }

    this.logger.log(`Discord notification sent to webhook`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Step 2: Add case to sendToChannel switch**

In the `sendToChannel` method, add the discord case:

```typescript
case 'discord':
  return await this.sendDiscordNotification(channel, alert);
```

**Step 3: Commit**

```bash
git add apps/worker/src/processors/alert.processor.ts
git commit -m "feat(worker): add Discord webhook notification sending"
```

---

## Task 4: Backend - Slack OAuth Sending

**Files:**
- Modify: `apps/worker/src/processors/alert.processor.ts`

**Step 1: Add Slack OAuth sending method**

Add this method to the `AlertProcessor` class:

```typescript
/**
 * Send Slack notification via OAuth (chat.postMessage API)
 */
private async sendSlackOAuthNotification(
  channel: any,
  alert: any,
): Promise<{ success: boolean; error?: string }> {
  try {
    const decryptedConfig = this.decrypt(channel.configEncrypted);
    const config = JSON.parse(decryptedConfig);

    if (!config.accessToken || !config.channelId) {
      return { success: false, error: 'Slack OAuth config incomplete' };
    }

    // Map severity to Slack color
    const colorMap: Record<string, string> = {
      low: '#3b82f6',
      medium: '#f59e0b',
      high: '#dc2626',
      critical: '#7c3aed',
    };

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: config.channelId,
        text: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        attachments: [{
          color: colorMap[alert.severity] || '#3b82f6',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${alert.title}*\n${alert.body}`,
              },
            },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `*Rule:* ${alert.rule.name}` },
                { type: 'mrkdwn', text: `*Severity:* ${alert.severity}` },
              ],
            },
            {
              type: 'actions',
              elements: [{
                type: 'button',
                text: { type: 'plain_text', text: 'View Source' },
                url: alert.rule.source.url,
              }],
            },
          ],
        }],
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      return { success: false, error: `Slack API error: ${result.error}` };
    }

    this.logger.log(`Slack notification sent to channel ${config.channelName}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Step 2: Add case to sendToChannel switch**

```typescript
case 'slack_oauth':
  return await this.sendSlackOAuthNotification(channel, alert);
```

**Step 3: Commit**

```bash
git add apps/worker/src/processors/alert.processor.ts
git commit -m "feat(worker): add Slack OAuth notification sending"
```

---

## Task 5: Backend - OneSignal Push Sending

**Files:**
- Modify: `apps/worker/src/processors/alert.processor.ts`

**Step 1: Add Push sending method**

```typescript
/**
 * Send push notification via OneSignal
 */
private async sendPushNotification(
  channel: any,
  alert: any,
): Promise<{ success: boolean; error?: string }> {
  try {
    const decryptedConfig = this.decrypt(channel.configEncrypted);
    const config = JSON.parse(decryptedConfig);

    const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
    const oneSignalApiKey = process.env.ONESIGNAL_API_KEY;

    if (!oneSignalAppId || !oneSignalApiKey) {
      return { success: false, error: 'OneSignal not configured on server' };
    }

    if (!config.playerId) {
      return { success: false, error: 'Push player ID not configured' };
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${oneSignalApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        app_id: oneSignalAppId,
        include_player_ids: [config.playerId],
        headings: { en: `[${alert.severity.toUpperCase()}] ${alert.rule.name}` },
        contents: { en: alert.title },
        url: alert.rule.source.url,
        chrome_web_badge: 'https://sentinel-app.pages.dev/logo.png',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `OneSignal API error: ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    this.logger.log(`Push notification sent, id: ${result.id}`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

**Step 2: Add case to sendToChannel switch**

```typescript
case 'push':
  return await this.sendPushNotification(channel, alert);
```

**Step 3: Commit**

```bash
git add apps/worker/src/processors/alert.processor.ts
git commit -m "feat(worker): add OneSignal push notification sending"
```

---

## Task 6: Backend - Slack OAuth Endpoints

**Files:**
- Modify: `apps/api/src/notification-channels/notification-channels.controller.ts`
- Modify: `apps/api/src/notification-channels/notification-channels.service.ts`
- Modify: `apps/api/src/config/config.service.ts`

**Step 1: Add Slack config to ConfigService**

In `apps/api/src/config/config.service.ts`, add:

```typescript
get slackClientId(): string {
  return process.env.SLACK_CLIENT_ID || '';
}

get slackClientSecret(): string {
  return process.env.SLACK_CLIENT_SECRET || '';
}
```

**Step 2: Add OAuth methods to service**

In `notification-channels.service.ts`, add:

```typescript
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

  const data = await response.json();

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

  const data = await response.json();

  if (!data.ok) {
    throw new BadRequestException(`Failed to list Slack channels: ${data.error}`);
  }

  return data.channels.map((ch: any) => ({
    id: ch.id,
    name: ch.name,
  }));
}
```

**Step 3: Add OAuth endpoints to controller**

In `notification-channels.controller.ts`, add:

```typescript
@Post('slack/exchange')
async exchangeSlackCode(
  @GetUser('id') userId: string,
  @Body() body: { code: string; redirectUri: string },
) {
  return this.notificationChannelsService.exchangeSlackCode(body.code, body.redirectUri);
}

@Get('slack/channels')
async listSlackChannels(
  @GetUser('id') userId: string,
  @Query('accessToken') accessToken: string,
) {
  return this.notificationChannelsService.listSlackChannels(accessToken);
}

@Get('slack/auth-url')
getSlackAuthUrl(@Query('redirectUri') redirectUri: string) {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    throw new BadRequestException('Slack OAuth not configured');
  }

  const scopes = 'chat:write,channels:read,groups:read';
  const url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return { url };
}
```

**Step 4: Commit**

```bash
git add apps/api/src/
git commit -m "feat(api): add Slack OAuth endpoints for token exchange and channel listing"
```

---

## Task 7: Frontend - Update API Types

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Update ChannelType and add new types**

Find and update the types in `api.ts`:

```typescript
export type ChannelType = 'email' | 'slack_oauth' | 'discord' | 'push' | 'webhook';

export interface NotificationChannel {
  id: string;
  workspaceId: string;
  type: ChannelType;
  name: string;
  enabled: boolean;
  createdAt: string;
  config?: {
    email?: string;
    channelName?: string;
    teamName?: string;
    webhookUrl?: string;
    deviceType?: string;
    url?: string;
  };
}

export interface CreateNotificationChannelDto {
  name: string;
  type: ChannelType;
  workspaceId: string;
  emailConfig?: { email: string };
  slackOAuthConfig?: { accessToken: string; channelId: string; channelName: string; teamName?: string };
  discordConfig?: { webhookUrl: string };
  pushConfig?: { playerId: string; deviceType?: string };
  webhookConfig?: { url: string; headers?: Record<string, string> };
}
```

**Step 2: Add Slack OAuth API methods**

```typescript
// Slack OAuth
getSlackAuthUrl: async (redirectUri: string): Promise<{ url: string }> => {
  return request(`/notification-channels/slack/auth-url?redirectUri=${encodeURIComponent(redirectUri)}`);
},

exchangeSlackCode: async (code: string, redirectUri: string): Promise<{ accessToken: string; teamName: string }> => {
  return request('/notification-channels/slack/exchange', {
    method: 'POST',
    body: JSON.stringify({ code, redirectUri }),
  });
},

listSlackChannels: async (accessToken: string): Promise<Array<{ id: string; name: string }>> => {
  return request(`/notification-channels/slack/channels?accessToken=${encodeURIComponent(accessToken)}`);
},
```

**Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): update API types for new notification channels"
```

---

## Task 8: Frontend - New Channel Modal UI

**Files:**
- Modify: `apps/web/src/app/dashboard/settings/page.tsx`

**Step 1: Update CHANNEL_TYPES array**

Replace the existing array:

```typescript
const CHANNEL_TYPES: { value: ChannelType; label: string; icon: string; description: string }[] = [
  { value: 'email', label: 'Email', icon: '📧', description: 'Receive alerts via email' },
  { value: 'slack_oauth', label: 'Slack', icon: '💬', description: 'Connect your Slack workspace' },
  { value: 'discord', label: 'Discord', icon: '🎮', description: 'Send to Discord channel' },
  { value: 'push', label: 'Push', icon: '🔔', description: 'Browser notifications' },
  { value: 'webhook', label: 'Webhook', icon: '🔗', description: 'Custom HTTP endpoint' },
];
```

**Step 2: Rewrite AddChannelModal component**

Replace the entire `AddChannelModal` function with:

```typescript
function AddChannelModal({
  workspaceId,
  onAdd,
  onClose,
}: {
  workspaceId: string;
  onAdd: (data: CreateNotificationChannelDto) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<ChannelType>('email');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email state
  const [email, setEmail] = useState('');

  // Discord state
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState('');

  // Slack OAuth state
  const [slackStep, setSlackStep] = useState<'connect' | 'select-channel'>('connect');
  const [slackAccessToken, setSlackAccessToken] = useState('');
  const [slackTeamName, setSlackTeamName] = useState('');
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedChannel, setSelectedChannel] = useState<{ id: string; name: string } | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Handle Slack OAuth callback
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'slack-oauth-callback' && event.data?.code) {
        try {
          setLoadingChannels(true);
          const redirectUri = `${window.location.origin}/oauth/slack/callback`;
          const { accessToken, teamName } = await api.exchangeSlackCode(event.data.code, redirectUri);
          setSlackAccessToken(accessToken);
          setSlackTeamName(teamName);

          const channels = await api.listSlackChannels(accessToken);
          setSlackChannels(channels);
          setSlackStep('select-channel');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Slack connection failed');
        } finally {
          setLoadingChannels(false);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnectSlack = async () => {
    try {
      const redirectUri = `${window.location.origin}/oauth/slack/callback`;
      const { url } = await api.getSlackAuthUrl(redirectUri);

      // Open popup for OAuth
      const popup = window.open(url, 'slack-oauth', 'width=600,height=700');
      if (!popup) {
        setError('Please allow popups for Slack connection');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Slack connection');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const data: CreateNotificationChannelDto = {
      name: name || `${CHANNEL_TYPES.find(t => t.value === type)?.label} Channel`,
      type,
      workspaceId,
    };

    switch (type) {
      case 'email':
        if (!email) { setError('Email is required'); return; }
        data.emailConfig = { email };
        break;
      case 'slack_oauth':
        if (!slackAccessToken || !selectedChannel) { setError('Please connect Slack and select a channel'); return; }
        data.slackOAuthConfig = {
          accessToken: slackAccessToken,
          channelId: selectedChannel.id,
          channelName: selectedChannel.name,
          teamName: slackTeamName,
        };
        break;
      case 'discord':
        if (!discordWebhookUrl) { setError('Discord webhook URL is required'); return; }
        if (!discordWebhookUrl.startsWith('https://discord.com/api/webhooks/')) {
          setError('Invalid Discord webhook URL'); return;
        }
        data.discordConfig = { webhookUrl: discordWebhookUrl };
        break;
      case 'webhook':
        if (!webhookUrl) { setError('Webhook URL is required'); return; }
        data.webhookConfig = { url: webhookUrl };
        break;
      case 'push':
        // Push will be handled separately with OneSignal SDK
        setError('Push notifications setup coming soon');
        return;
    }

    try {
      setSaving(true);
      await onAdd(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add channel');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
          <h3 className="text-lg font-medium text-gray-900">Add Notification Channel</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {/* Channel Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channel Type</label>
            <div className="grid grid-cols-2 gap-2">
              {CHANNEL_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  onClick={() => { setType(ct.value); setError(null); }}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    type === ct.value
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="text-xl">{ct.icon}</span>
                    <span className="font-medium">{ct.label}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{ct.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Name Field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${CHANNEL_TYPES.find(t => t.value === type)?.label} Notifications`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          {/* Email Config */}
          {type === 'email' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alerts@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
          )}

          {/* Slack OAuth Config */}
          {type === 'slack_oauth' && (
            <div className="space-y-4">
              {slackStep === 'connect' && (
                <button
                  type="button"
                  onClick={handleConnectSlack}
                  disabled={loadingChannels}
                  className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-[#4A154B] text-white rounded-lg hover:bg-[#3d1140] disabled:opacity-50"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
                  </svg>
                  <span>{loadingChannels ? 'Connecting...' : 'Connect Slack Workspace'}</span>
                </button>
              )}

              {slackStep === 'select-channel' && (
                <div className="space-y-3">
                  <div className="flex items-center space-x-2 text-green-600">
                    <span>✓</span>
                    <span>Connected to {slackTeamName}</span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Select Channel</label>
                    <select
                      value={selectedChannel?.id || ''}
                      onChange={(e) => {
                        const ch = slackChannels.find(c => c.id === e.target.value);
                        setSelectedChannel(ch || null);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500"
                      required
                    >
                      <option value="">Choose a channel...</option>
                      {slackChannels.map((ch) => (
                        <option key={ch.id} value={ch.id}>#{ch.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Discord Config */}
          {type === 'discord' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discord Webhook URL</label>
              <input
                type="url"
                value={discordWebhookUrl}
                onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="mt-2 text-xs text-gray-500">
                Server Settings → Integrations → Webhooks → New Webhook → Copy URL
              </p>
            </div>
          )}

          {/* Push Config - Placeholder */}
          {type === 'push' && (
            <div className="bg-gray-50 p-4 rounded-lg text-center">
              <p className="text-gray-600">🔔 Push notifications</p>
              <p className="text-sm text-gray-500 mt-1">Coming soon!</p>
            </div>
          )}

          {/* Webhook Config */}
          {type === 'webhook' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                We'll POST JSON data to this URL when alerts trigger
              </p>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-700 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || type === 'push'}
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/dashboard/settings/page.tsx
git commit -m "feat(web): new notification channel modal with Slack OAuth and Discord support"
```

---

## Task 9: Frontend - Slack OAuth Callback Page

**Files:**
- Create: `apps/web/src/app/oauth/slack/callback/page.tsx`

**Step 1: Create the callback page**

```typescript
'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SlackOAuthCallback() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      window.opener?.postMessage({ type: 'slack-oauth-callback', error }, '*');
      window.close();
      return;
    }

    if (code) {
      window.opener?.postMessage({ type: 'slack-oauth-callback', code }, '*');
      window.close();
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Connecting to Slack...</p>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/web/src/app/oauth/
git commit -m "feat(web): add Slack OAuth callback page"
```

---

## Task 10: Deploy and Test

**Step 1: Update environment variables on server**

SSH to server and add:
```bash
# Add to /root/sentinel/.env
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
ONESIGNAL_APP_ID=your_onesignal_app_id
ONESIGNAL_API_KEY=your_onesignal_api_key
```

**Step 2: Run database migration on production**

```bash
ssh root@135.181.99.192 "cd /root/sentinel && docker exec sentinel-api npx prisma migrate deploy"
```

**Step 3: Restart services**

```bash
ssh root@135.181.99.192 "cd /root/sentinel && docker compose restart api worker"
```

**Step 4: Test each channel type**

- [ ] Email: Add email → Test → Check inbox
- [ ] Discord: Add webhook URL → Test → Check Discord
- [ ] Slack OAuth: Connect → Select channel → Test → Check Slack
- [ ] Webhook: Add URL → Test → Check request

**Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete notification system redesign

- Add slack_oauth, discord, push channel types
- Remove telegram from frontend (kept in DB for backwards compat)
- Implement Discord webhook sending
- Implement Slack OAuth flow with channel picker
- Add OneSignal push notification sending (backend ready)
- Simplify frontend UX for all channel types

BREAKING CHANGE: telegram and slack webhook channels deprecated"
```

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | DB Migration | `schema.prisma` |
| 2 | Backend DTOs | `create-channel.dto.ts`, `notification-channels.service.ts` |
| 3 | Discord Sending | `alert.processor.ts` |
| 4 | Slack OAuth Sending | `alert.processor.ts` |
| 5 | Push Sending | `alert.processor.ts` |
| 6 | Slack OAuth API | `notification-channels.controller.ts`, `service.ts`, `config.service.ts` |
| 7 | Frontend API Types | `api.ts` |
| 8 | Channel Modal UI | `settings/page.tsx` |
| 9 | OAuth Callback | `oauth/slack/callback/page.tsx` |
| 10 | Deploy & Test | Environment, migrations |

**Estimated time:** 4-6 hours for full implementation
