# Alerts Module - Deployment Instructions

## Overview

Alerts module implementovaný pre Sentinel - Change Intelligence Platform. Poskytuje in-app notifikácie s real-time SSE streamingom.

## Implementované Features

✅ **Endpoints:**
- `GET /alerts` - List alerts s pokročilým filtrovaním
- `GET /alerts/:id` - Detail alertu
- `POST /alerts/:id/ack` - Acknowledge alert
- `POST /alerts/:id/resolve` - Resolve alert
- `GET /alerts/stream` - SSE real-time stream

✅ **Access Control:**
- JWT authentication (JwtAuthGuard)
- Workspace-based authorization
- Owner a member verification

✅ **Filtering:**
- Status: open, acknowledged, resolved, all
- Severity: low, medium, high, critical
- Rule ID
- Time range (since parameter)
- Pagination (limit 1-100)

✅ **Real-time Updates:**
- SSE endpoint s polling každých 5 sekúnd
- Optional Redis pub/sub pre production scaling

✅ **Tests:**
- Unit testy pre AlertsService
- Unit testy pre AlertsController
- Mock setup pre Prisma

## Deployment Steps

### 1. Spustiť Prisma Migráciu

```bash
cd /Users/marianfabian/Projects/sentinel/apps/api

# Spustiť databázový server (ak nebeží)
# docker compose up -d postgres  # alebo podľa vášho setupu

# Pustiť migráciu
npx prisma migrate deploy --schema=../../packages/shared/prisma/schema.prisma

# Regenerovať Prisma klienta
npx prisma generate --schema=../../packages/shared/prisma/schema.prisma
```

Migrácia pridá:
- `acknowledged_at` (DateTime?, nullable)
- `acknowledged_by` (TEXT, nullable)
- Index na `acknowledged_at` pre rýchlejšie queries

### 2. Odstrániť Temporary Type Casts

Po regenerácii Prisma klienta, odstráňte `as any` v:

**`apps/api/src/alerts/alerts.service.ts`:**

```typescript
// Nahradiť
(where as any).acknowledgedAt = null;

// S
where.acknowledgedAt = null;

// A podobne pre acknowledge() metódu
data: {
  acknowledgedAt: new Date(),
  acknowledgedBy: userId,
}  // bez 'as any'
```

### 3. Build a Spustenie

```bash
cd /Users/marianfabian/Projects/sentinel/apps/api

# Build
npm run build

# Alebo development mode
npm run start:dev
```

### 4. Verifikácia

```bash
# Health check
curl http://localhost:3000/health

# Test authentication endpoint
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Získať token a testovať alerts endpoint
TOKEN="<your-jwt-token>"
WORKSPACE_ID="<workspace-uuid>"

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts?workspaceId=$WORKSPACE_ID&status=open"
```

## Súborová Štruktúra

```
apps/api/src/alerts/
├── alerts.module.ts              # Module registration
├── alerts.controller.ts          # REST + SSE endpoints
├── alerts.controller.spec.ts     # Controller tests
├── alerts.service.ts             # Business logic
├── alerts.service.spec.ts        # Service tests
├── dto/
│   └── alert-filter.dto.ts      # Query validation DTO
├── events/
│   └── alert-event.service.ts   # Optional event emitter
├── README.md                     # Usage documentation
└── DEPLOYMENT.md                 # This file

packages/shared/prisma/
├── schema.prisma                 # Updated with new fields
└── migrations/
    └── 20251227131722_add_alert_acknowledgement_fields/
        └── migration.sql         # Migration SQL
```

## Testing

### Unit Tests

```bash
# Spustiť všetky testy
npm run test

# Len alerts testy
npm run test -- alerts

# S coverage
npm run test:cov -- alerts
```

### Integration Tests

```bash
# Vytvorte testovací workspace a alert
# Testujte endpointy:

# 1. List alerts
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts?workspaceId=$WORKSPACE_ID"

# 2. Get alert detail
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts/$ALERT_ID"

# 3. Acknowledge alert
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts/$ALERT_ID/ack"

# 4. Resolve alert
curl -X POST -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts/$ALERT_ID/resolve"

# 5. SSE stream (keep connection open)
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts/stream?workspaceId=$WORKSPACE_ID"
```

## Production Considerations

### 1. Redis Pub/Sub (Recommended)

Pre horizontálne škálovanie s viacerými API inštanciami:

```bash
npm install ioredis
```

Upraviť `alert-event.service.ts` na Redis pub/sub podľa komentárov v súbore.

### 2. Database Indexing

Migrácia už obsahuje index na `acknowledged_at`. Pre vysoký traffic zvážte:

```sql
-- Index for resolved alerts queries
CREATE INDEX IF NOT EXISTS "alerts_resolved_at_idx" ON "alerts"("resolved_at");

-- Composite index for status filtering
CREATE INDEX IF NOT EXISTS "alerts_status_idx"
  ON "alerts"("resolved_at", "acknowledged_at", "triggered_at" DESC);
```

### 3. Rate Limiting

Throttler je už nakonfigurovaný v `app.module.ts`. Pre SSE endpoint zvážte samostatný limit:

```typescript
@Throttle(10, 60)  // 10 requests per 60 seconds
@Sse('stream')
stream(...) { ... }
```

### 4. Monitoring

Sledujte:
- Počet otvorených SSE connections
- Database query performance (EXPLAIN ANALYZE)
- Memory usage pri dlhodobých SSE connections
- Redis pub/sub lag (ak implementované)

## Environment Variables

Žiadne nové environment variables nie sú potrebné. Používajú sa existujúce:

```env
DATABASE_URL=postgresql://...
JWT_SECRET=...
JWT_EXPIRATION=7d
THROTTLE_TTL=60
THROTTLE_LIMIT=100
```

## Rollback Plan

Ak potrebujete rollback:

```bash
# 1. Vrátiť migráciu
npx prisma migrate resolve --rolled-back "20251227131722_add_alert_acknowledgement_fields" \
  --schema=../../packages/shared/prisma/schema.prisma

# 2. Odstrániť AlertsModule z app.module.ts
# 3. Redeploy

# 4. Manuálne rollback DB (ak Prisma zlyhal)
psql $DATABASE_URL << EOF
ALTER TABLE "alerts" DROP COLUMN IF EXISTS "acknowledged_at";
ALTER TABLE "alerts" DROP COLUMN IF EXISTS "acknowledged_by";
DROP INDEX IF EXISTS "alerts_acknowledged_at_idx";
EOF
```

## Known Issues & TODOs

1. **Prisma Type Casts**: Odstráňte `as any` po `prisma generate`
2. **SSE Scalability**: Implementujte Redis pub/sub pre production
3. **Alert Aggregation**: Zvážte grouping podobných alertov
4. **Bulk Operations**: Pridajte batch acknowledge/resolve
5. **Notification Preferences**: User-specific alert preferences

## Support

Pre otázky kontaktujte:
- **Author**: eng-backend agent (Loki Mode)
- **Task**: M2-008
- **Date**: 2025-12-27
- **Project**: Sentinel - Change Intelligence Platform

---

**Status**: ✅ Ready for deployment (po Prisma migration)
