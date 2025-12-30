# Notification System Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify notification setup UX - replace manual token/webhook entry with OAuth and one-click connections.

**Architecture:** Remove Telegram (too complex), add Slack OAuth, Discord webhook, OneSignal push. Keep email (Resend) and custom webhook.

**Tech Stack:** Slack OAuth 2.0, OneSignal SDK, Discord Webhooks, Resend API

---

## Current State

### Notification Channels (BEFORE)
| Channel | Config Required | UX Complexity |
|---------|----------------|---------------|
| email | email address | Easy |
| telegram | Chat ID + Bot Token | Hard |
| slack | Webhook URL | Medium |
| webhook | URL + headers | Technical |

### Problems
1. Telegram requires finding @userinfobot, copying Chat ID
2. Slack webhook requires creating Slack App, copying webhook URL
3. No push notifications support
4. No Discord support

---

## New Design

### Notification Channels (AFTER)
| Channel | Config | UX | Free Limit |
|---------|--------|-----|------------|
| **email** | `{ email }` | Enter email → done | 3k/month (Resend) |
| **slack_oauth** | `{ accessToken, channelId, channelName, teamName }` | "Connect Slack" → OAuth → select channel | Unlimited |
| **discord** | `{ webhookUrl }` | Paste Discord webhook URL | Unlimited |
| **push** | `{ playerId, deviceType }` | "Enable notifications" → browser popup | 10k/month (OneSignal) |
| **webhook** | `{ url, headers? }` | For power users | N/A |

### Removed
- **telegram** - Too complex for regular users

---

## Implementation Details

### 1. Slack OAuth Flow

**Slack App Configuration:**
- App Name: "Sentinel Alerts"
- Scopes: `chat:write`, `channels:read`, `groups:read`
- Redirect URL: `https://sentinel-app.pages.dev/api/oauth/slack/callback`

**OAuth Flow:**
1. User clicks "Connect Slack"
2. Redirect to Slack OAuth: `https://slack.com/oauth/v2/authorize?client_id=XXX&scope=chat:write,channels:read&redirect_uri=XXX`
3. User authorizes app, selects workspace
4. Slack redirects back with `code`
5. Backend exchanges `code` for `access_token`
6. Frontend shows channel picker (fetched via `conversations.list`)
7. User selects channel
8. Save: `{ accessToken, channelId, channelName, teamName }`

**Sending Notifications:**
```typescript
await fetch('https://slack.com/api/chat.postMessage', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    channel: channelId,
    text: alertTitle,
    blocks: [...] // Rich formatting
  })
});
```

### 2. Discord Webhook

**User Setup (10 seconds):**
1. Open Discord server → Server Settings → Integrations → Webhooks
2. Create webhook, copy URL
3. Paste URL in Sentinel

**Config:** `{ webhookUrl: "https://discord.com/api/webhooks/XXX/YYY" }`

**Sending Notifications:**
```typescript
await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'Sentinel',
    embeds: [{
      title: alertTitle,
      description: alertBody,
      color: severity === 'high' ? 0xdc2626 : 0x3b82f6,
      url: sourceUrl,
      timestamp: triggeredAt,
    }]
  })
});
```

### 3. OneSignal Push Notifications

**Setup Required:**
1. Create OneSignal App (free)
2. Get App ID and REST API Key
3. Add to environment: `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`

**Frontend Integration:**
```typescript
// Initialize OneSignal
OneSignal.init({ appId: ONESIGNAL_APP_ID });

// Subscribe user
const playerId = await OneSignal.getUserId();
// Save playerId to notification channel config
```

**Sending Notifications:**
```typescript
await fetch('https://onesignal.com/api/v1/notifications', {
  method: 'POST',
  headers: {
    'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    app_id: ONESIGNAL_APP_ID,
    include_player_ids: [playerId],
    headings: { en: alertTitle },
    contents: { en: alertBody },
    url: sourceUrl,
  })
});
```

### 4. Email (Resend) - Already Implemented

**No changes needed in backend.** Just simplify frontend - user enters email address only.

---

## Database Migration

### Step 1: Add new enum values
```sql
ALTER TYPE "NotificationChannelType" ADD VALUE 'slack_oauth';
ALTER TYPE "NotificationChannelType" ADD VALUE 'discord';
ALTER TYPE "NotificationChannelType" ADD VALUE 'push';
```

### Step 2: Migrate existing data
```sql
-- Delete telegram channels (no longer supported)
DELETE FROM notification_channels WHERE type = 'telegram';

-- Optionally: Delete old slack webhook channels
-- Users will need to reconnect via OAuth
DELETE FROM notification_channels WHERE type = 'slack';
```

### Step 3: Update enum (remove telegram)
PostgreSQL doesn't support DROP VALUE from enum. Options:
1. Leave 'telegram' in enum but don't use it (simplest)
2. Recreate enum without telegram (complex migration)

**Recommendation:** Option 1 - leave in enum, remove from frontend/API validation.

---

## Environment Variables

### New Required
```env
# Slack OAuth
SLACK_CLIENT_ID=xxx
SLACK_CLIENT_SECRET=xxx

# OneSignal
ONESIGNAL_APP_ID=xxx
ONESIGNAL_API_KEY=xxx
```

### Already Configured
```env
RESEND_API_KEY=xxx  # Already working for email
```

---

## Files to Modify

### Prisma Schema
- `packages/shared/prisma/schema.prisma` - Add new enum values

### API (NestJS)
- `apps/api/src/notification-channels/dto/create-channel.dto.ts` - New DTOs
- `apps/api/src/notification-channels/notification-channels.service.ts` - Handle new types
- `apps/api/src/notification-channels/notification-channels.controller.ts` - OAuth endpoints
- NEW: `apps/api/src/oauth/oauth.controller.ts` - Slack OAuth callback

### Worker
- `apps/worker/src/processors/alert.processor.ts` - Send to Discord, Push

### Frontend (Next.js)
- `apps/web/src/app/dashboard/settings/page.tsx` - New UI for each channel type
- NEW: `apps/web/src/app/api/oauth/slack/callback/route.ts` - OAuth callback handler
- `apps/web/src/lib/api.ts` - New API types

---

## Testing Checklist

- [ ] Email: Enter email → receive test notification
- [ ] Slack OAuth: Connect → select channel → receive test notification
- [ ] Discord: Paste webhook URL → receive test notification
- [ ] Push: Enable notifications → receive test notification
- [ ] Webhook: Enter URL → receive test notification
- [ ] Verify telegram option is removed from UI
- [ ] Verify existing email channels still work after migration
