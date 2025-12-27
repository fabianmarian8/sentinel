# Alerts Module

In-app notification system for Sentinel platform.

## Overview

The Alerts module provides endpoints for managing and viewing alerts triggered by monitoring rules. It includes filtering, acknowledgement, resolution, and real-time streaming via Server-Sent Events (SSE).

## Features

- List alerts with comprehensive filtering (status, severity, rule, time range)
- Get detailed alert information
- Acknowledge alerts
- Resolve alerts
- Real-time SSE stream for live updates
- Workspace-based access control

## Endpoints

### List Alerts
```
GET /alerts?workspaceId=xxx&status=open&severity=critical&limit=50
```

Query parameters:
- `workspaceId` (required, UUID): Filter by workspace
- `status` (optional): `open`, `acknowledged`, `resolved`, `all`
- `severity` (optional): `low`, `medium`, `high`, `critical`
- `ruleId` (optional, UUID): Filter by specific rule
- `since` (optional, ISO date): Filter alerts after this timestamp
- `limit` (optional, 1-100): Number of results (default: 50)

Response:
```json
{
  "alerts": [
    {
      "id": "clxxx",
      "severity": "critical",
      "title": "Price dropped below €100",
      "body": "99.99 € (was 129.99 €)",
      "triggeredAt": "2025-12-27T10:30:00Z",
      "acknowledgedAt": null,
      "resolvedAt": null,
      "rule": {
        "id": "clyyy",
        "name": "Monitor iPhone price",
        "source": {
          "url": "https://apple.com/iphone",
          "domain": "apple.com"
        }
      }
    }
  ],
  "count": 1
}
```

### Get Alert Detail
```
GET /alerts/:id
```

Returns full alert information with workspace and rule details.

### Acknowledge Alert
```
POST /alerts/:id/ack
```

Marks the alert as acknowledged by the current user. Sets `acknowledgedAt` timestamp and `acknowledgedBy` user ID.

### Resolve Alert
```
POST /alerts/:id/resolve
```

Marks the alert as resolved. Sets `resolvedAt` timestamp.

### Real-time Stream (SSE)
```
GET /alerts/stream?workspaceId=xxx
```

Server-Sent Events endpoint that pushes recent alerts every 5 seconds.

Client usage:
```javascript
const eventSource = new EventSource('/alerts/stream?workspaceId=xxx', {
  headers: { Authorization: 'Bearer <token>' }
});

eventSource.onmessage = (event) => {
  const alerts = JSON.parse(event.data);
  console.log('Recent alerts:', alerts);
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  eventSource.close();
};
```

## Database Schema Changes

Added to `Alert` model:
- `acknowledgedAt?: DateTime` - When alert was acknowledged
- `acknowledgedBy?: string` - User ID who acknowledged the alert

Migration: `20251227131722_add_alert_acknowledgement_fields`

## Access Control

All endpoints require authentication via JWT. Access is restricted to workspace members:
- Users must be workspace owner or member
- Verified via `WorkspacesService.verifyWorkspaceAccess()`

## Real-time Implementation

### Current (Polling)
The SSE endpoint polls the database every 5 seconds. Suitable for:
- Small to medium deployments
- Single-instance deployments
- Development environments

### Production (Redis Pub/Sub)
For production with multiple instances, implement Redis pub/sub:

1. Install Redis client:
```bash
npm install ioredis
```

2. Create RedisService with pub/sub clients

3. Update `AlertEventService`:
```typescript
// Instead of Subject
emit(alert: Alert, workspaceId: string) {
  await this.redis.publish(
    `alerts:workspace:${workspaceId}`,
    JSON.stringify(alert)
  );
}

subscribe(workspaceId: string): Observable<AlertEvent> {
  const subscriber = this.redis.duplicate();
  await subscriber.subscribe(`alerts:workspace:${workspaceId}`);

  return new Observable((observer) => {
    subscriber.on('message', (channel, message) => {
      observer.next(JSON.parse(message));
    });
  });
}
```

4. Update controller to use AlertEventService instead of polling

## Usage Example

```typescript
// In a service that creates alerts
async createAlert(alert: Alert, workspaceId: string) {
  const newAlert = await this.prisma.alert.create({ data: alert });

  // Emit event for real-time updates
  this.alertEventService.emit(newAlert, workspaceId);

  return newAlert;
}
```

## Testing

```bash
# List open alerts
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/alerts?workspaceId=xxx&status=open"

# Acknowledge alert
curl -X POST -H "Authorization: Bearer <token>" \
  "http://localhost:3000/alerts/clxxx/ack"

# SSE stream (keep connection open)
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/alerts/stream?workspaceId=xxx"
```

## Module Structure

```
alerts/
├── alerts.module.ts           # Module definition
├── alerts.controller.ts       # REST + SSE endpoints
├── alerts.service.ts          # Business logic
├── dto/
│   └── alert-filter.dto.ts   # Query validation
├── events/
│   └── alert-event.service.ts # Real-time events (optional)
└── README.md                  # This file
```

## Dependencies

- `@nestjs/common` - Framework
- `@nestjs/passport` - Authentication
- `rxjs` - Reactive streams for SSE
- `class-validator` - DTO validation
- `@prisma/client` - Database access

## Future Enhancements

- [ ] Redis pub/sub for horizontal scaling
- [ ] WebSocket support alongside SSE
- [ ] Alert aggregation/grouping
- [ ] Bulk operations (ack/resolve multiple alerts)
- [ ] Alert snoozing
- [ ] Custom notification preferences per user
- [ ] Alert templates
