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
- **Production Web:** https://sentinel-app.pages.dev
- **Production API:** https://sentinel.taxinearme.sk
- **Server:** Hetzner VPS (135.181.99.192)
