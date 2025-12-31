# API Server - NestJS Backend

> **Role**: Main API server for Sentinel platform
> **Host**: sentinel.taxinearme.sk (135.181.99.192)
> **Hardware**: Hetzner VPS 4GB RAM
> **Critical Path**: Yes - All frontend requests go through this

## Topology
| Direction | Connected To | Protocol | Purpose |
|-----------|--------------|----------|---------|
| <- Receives | Next.js Frontend | HTTPS:443 | API requests |
| -> Sends | PostgreSQL (Supabase) | TCP:5432 | Database queries |
| -> Sends | OneSignal | HTTPS | Push notifications |
| -> Sends | Slack API | HTTPS | Slack notifications |

## Quick Health
```bash
curl https://sentinel.taxinearme.sk/api/health
ssh root@135.181.99.192 "systemctl status sentinel-api"
```

## Key Processes
- `apps/api/src/main.ts`: NestJS entry point (port 3000)
- `sentinel-api`: Systemd service

---
<!-- WARM CONTEXT ENDS ABOVE THIS LINE -->

## Full Documentation

### Quick Reference
- **Hostname**: sentinel.taxinearme.sk
- **IP**: 135.181.99.192
- **Access**: `ssh root@135.181.99.192`
- **OS**: Ubuntu 22.04

## What's Deployed Here

| Component | Entry Point | Status |
|-----------|-------------|--------|
| **NestJS API** | `apps/api/src/main.ts` | Active |
| **Prisma ORM** | `apps/api/prisma/schema.prisma` | Active |

## Key Paths

**Code:**
```
/root/sentinel/apps/api/
├── src/
│   ├── notification-channels/  # Push, Slack, Discord
│   ├── monitors/               # Website monitoring
│   ├── alerts/                 # Alert management
│   └── auth/                   # Supabase auth
└── prisma/
    └── schema.prisma           # Database schema
```

## Services Running

**Check Status:**
```bash
systemctl status sentinel-api
```

**Restart Service:**
```bash
systemctl restart sentinel-api
```

**View Logs:**
```bash
journalctl -u sentinel-api -f
```

## Common Issues

**Issue:** Port 3000 already in use
- **Symptom**: EADDRINUSE error in logs
- **Fix**: `lsof -i :3000` then `kill -9 <PID>`

**Issue:** API returns 401 Unauthorized
- **Symptom**: Frontend can't fetch data
- **Fix**: Check Supabase JWT configuration

---

**Last Updated:** 2024-12-31
**Maintained By:** Marian
