# Alerts Module - Quick Start Guide

## 🚀 5-Minute Setup

### 1. Run Database Migration (1 min)

```bash
cd /Users/marianfabian/Projects/sentinel/apps/api

# Ensure database is running
docker compose up -d postgres  # or your DB setup

# Run migration
npx prisma migrate deploy --schema=../../packages/shared/prisma/schema.prisma

# Regenerate Prisma client
npx prisma generate --schema=../../packages/shared/prisma/schema.prisma
```

### 2. Remove Type Casts (1 min)

Edit `apps/api/src/alerts/alerts.service.ts`:

**Line 57-64** (findMany method):
```typescript
// BEFORE
(where as any).acknowledgedAt = null;

// AFTER
where.acknowledgedAt = null;
```

**Line 135** (acknowledge method):
```typescript
// BEFORE
} as any, // TODO: Regenerate Prisma client after migration

// AFTER
},
```

### 3. Build & Start (1 min)

```bash
npm run build
npm run start:dev  # or start:prod
```

### 4. Test API (2 min)

```bash
# Get auth token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}'

# Save token
export TOKEN="<your-jwt-token>"
export WORKSPACE_ID="<your-workspace-id>"

# Test alerts endpoint
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/alerts?workspaceId=$WORKSPACE_ID&status=open"
```

## ✅ Verification Checklist

- [ ] Migration ran successfully
- [ ] Prisma client regenerated
- [ ] Type casts removed
- [ ] API builds without errors
- [ ] GET /alerts endpoint returns 200
- [ ] JWT authentication works

## 📖 Next Steps

1. Read [README.md](./README.md) for API documentation
2. Check [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) for client examples
3. Review [DEPLOYMENT.md](./DEPLOYMENT.md) for production setup

## 🐛 Troubleshooting

### Migration fails
```bash
# Check DB connection
npx prisma db push --schema=../../packages/shared/prisma/schema.prisma

# Or manually run SQL
psql $DATABASE_URL < ../../packages/shared/prisma/migrations/20251227131722_add_alert_acknowledgement_fields/migration.sql
```

### Type errors after removing casts
```bash
# Ensure Prisma client is regenerated
npx prisma generate --schema=../../packages/shared/prisma/schema.prisma

# Restart TypeScript server in your editor
```

### 401 Unauthorized
```bash
# Check JWT_SECRET in .env
# Verify token expiration
# Ensure user has workspace membership
```

## 📞 Support

See [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md) for full details.
