# Sentinel - Change Intelligence Platform

**Project:** Web monitoring platform that tracks website changes and sends notifications
**Status:** Production
**Primary Goal:** Monitor websites for changes and alert users via multiple channels

## Quick Reference
- **Start API:** `cd apps/api && npm run dev`
- **Start Web:** `cd apps/web && npm run dev`
- **Test:** `npm test`
- **Build:** `npm run build`

## Architecture Overview
- **Monorepo:** Turborepo with apps/api and apps/web
- **Backend:** NestJS API with Prisma ORM
- **Frontend:** Next.js 14 with App Router
- **Database:** PostgreSQL (Supabase)
- **Notifications:** OneSignal (Push), Slack, Discord, Webhooks

## Core Components
- `apps/api/` - NestJS backend API
- `apps/web/` - Next.js frontend
- `packages/` - Shared packages

## Key Integrations
- **OneSignal:** Push notifications (App ID: d2a6756a-e9d6-4162-9c86-0869bde9328b)
- **Slack:** OAuth integration for channel notifications
- **Supabase:** PostgreSQL database and auth

## Environment
- **Production Web:** https://sentinel-app-biv.pages.dev (HLAVNÁ URL - jediná platná!)
- **Production API:** https://sentinel.taxinearme.sk
- **Server:** Hetzner VPS (135.181.99.192)

## Vyriešené problémy (2026-01)

### Screenshots nefungovali v browseri
**Problém:** Screenshoty sa nezobrazovali - broken image.

**Príčiny a riešenia:**
1. **JPEG/PNG mismatch** (`551e4e0`) - Playwright generuje JPEG, ale storage klient uploadoval s PNG content-type
   - Fix: `packages/storage/src/client.ts` - zmenené na `.jpg` a `image/jpeg`

2. **localhost URL** (`bcd3eb6`) - Worker ukladal URL ako `http://localhost:9000/...`
   - Browser beží na klientovi a nemá prístup k serveru cez localhost
   - Fix: Pridaný `S3_PUBLIC_URL` env variable pre verejnú URL
   - Konfigurácia: `S3_PUBLIC_URL=https://storage.taxinearme.sk/sentinel-storage`

### Oponent P0/P1 fixes (`518ac71`)
1. **JSONPath blokovaný** (P0) - Odstránený z API, nie je implementovaný
2. **Circuit breaker** (P1) - Pridaný pre BrightData/2captcha platené služby
3. **Error kódy** (P1) - Pridaná deprecation dokumentácia pre legacy kódy
4. **LlmExtractionService** (P1) - Odstránený nepoužívaný kód

### CSS-in-JS selektory
**Problém:** Selektory s hash triedami (`css-abc123`) sa menia pri každom builde.
**Riešenie:** Extension používa `@medv/finder` s blacklistom CSS-in-JS vzorov.

Detailný troubleshooting: `docs/OPERATIONS.md`
