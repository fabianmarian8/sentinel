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

### Screenshots full-page namiesto element (2. jan 2026)
**Problém:** Screenshoty boli full-page (1920x1080, 500KB+) namiesto element-only s paddingom.

**Príčiny a riešenia:**
1. **HTTP mode nemá screenshoty** (`d6ecdf7`)
   - HTTP fetch nemôže robiť screenshoty
   - Fix: Ak `screenshotOnChange=true`, automaticky prepnúť na FlareSolverr mode

2. **preferredMode=flaresolverr ignoroval selector** (`dfb6584`)
   - FlareSolverr vždy robil full-page screenshot
   - Fix: Pridaná kontrola `needsElementScreenshot`, volá sa `takeElementScreenshot`

3. **Hardkódovaný padding** (`817ae5b`)
   - Rôzne hodnoty (189px, 400px) na rôznych miestach
   - Fix: Globálna konštanta `SCREENSHOT_PADDING_PX = 189` v `packages/extractor/src/config/screenshot.ts`

**Výsledok:** Screenshot z 1920x993 (523KB) → 472x402 (22KB) - **24x menšie súbory**

## Kľúčové konfigurácie

### Screenshot padding
```typescript
// packages/extractor/src/config/screenshot.ts
export const SCREENSHOT_PADDING_PX = 189;  // 10x10cm pri 96 DPI
```

### Dôležité súbory pre screenshoty
- `packages/extractor/src/fetcher/smart-fetch.ts` - rozhodovanie o fetch mode
- `packages/extractor/src/fetcher/headless.ts` - `takeElementScreenshot()`
- `apps/worker/src/processors/run.processor.ts` - volanie smartFetch

Detailný troubleshooting: `docs/OPERATIONS.md`

### Fetch Classifier - Dvojvrstvová architektúra (3. jan 2026)
**Problém:** BrightData vracal `captcha_required` pre legitímne Etsy produktové stránky.

**Príčina:** Generické keyword matching (`recaptcha`, `blocked`, `captcha`) spôsobovalo false positives na veľkých stránkach s:
- reCAPTCHA widgetmi pre kontaktné formuláre
- DataDome SDK skriptami (`DD_BLOCKED_EVENT_NAME`, `CaptchaPassed`)
- JS kódom obsahujúcim "blocked" keywordy

**Riešenie:** Dvojvrstvová architektúra classifiera:

```
TIER 1: Presné signatúry (vždy aktívne, akákoľvek veľkosť)
├── geo.captcha-delivery.com, captcha-delivery.com/captcha (DataDome URL)
├── cf-browser-verification (Cloudflare atribút)
├── px-captcha (PerimeterX widget)
├── hcaptcha-challenge, h-captcha-response (hCaptcha)
└── DataDome challenge text (SK/EN)

TIER 2: Heuristiky (size-gated, <50KB alebo bez product schema)
├── checking your browser + cloudflare + ray id
├── perimeterx, _pxhd
├── verify you are human, i am not a robot
└── access denied, forbidden (<10KB)
```

**Product detekcia:** Schema.org JSON-LD (`"@type": "Product"`) namiesto keyword matching.

**Kľúčové súbory:**
- `apps/worker/src/utils/fetch-classifiers.ts` - hlavný classifier
- `apps/worker/src/services/brightdata.service.ts` - BrightData isBlocked()
- `apps/worker/src/utils/__tests__/fetch-classifiers.spec.ts` - 58 testov
- `apps/worker/src/utils/__tests__/fixtures/` - 6 HTML fixtures

**Regression testy:** 6 fixtures (datadome, cloudflare, perimeterx, rate-limit, generic-block, etsy-product)

**Výsledok:** BrightData vracia `outcome: ok` pre Etsy (522KB, 1.9s, $0.0015)
