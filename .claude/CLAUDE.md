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

### Oponent v2 - Scale readiness improvements (4. jan 2026)

**Kontext:** Externý agent "Oponent" analyzoval kód a identifikoval oblasti pre zlepšenie pred scale-out.

#### 1. Alert model refactor - AlertType enum + metadata JSONB
**Commit:** `dcf348b`
- Nový `AlertType` enum: `value_changed`, `schema_drift`, `market_context`, `budget_exceeded`, `provider_error`, `extraction_error`, `threshold_alert`
- Pole `metadata` (JSONB) pre štruktúrované dáta (old/new hodnoty, currency, country)
- Index na `alertType` pre efektívne filtrovanie
- `mapChangeKindToAlertType()` helper v run.processor.ts

#### 2. Float/Cents normalizácia
**Commit:** `14236ec`
- `valueLowCents`/`valueHighCents` (integer) pre presné porovnávanie cien
- Vyhneme sa float precision issues (29.83 vs 29.829999)
- `toCents()` helper v schema.ts
- Backward-compatible: fallback na float pre staré observations

**Kľúčové súbory:**
- `packages/shared/src/domain.ts` - SchemaExtractionMeta interface
- `packages/extractor/src/extraction/schema.ts` - toCents()
- `packages/extractor/src/antiflap/equals.ts` - cents-first comparison
- `apps/worker/src/utils/change-detection.ts` - cents diff calculation

#### 3. SLO metriky API
**Commit:** `4c2adad`
- `GET /stats/slo` - comprehensive SLO dashboard:
  - Extraction success rate (target: 95%)
  - Cost per successful extraction
  - Provider error rates (per-provider breakdown)
  - Schema drift rate
  - Latency percentiles (P50, P95, P99)
- `GET /stats/slo/hostnames` - per-domain breakdown (worst-first)
- Status: `healthy` | `warning` | `critical` pre každú metriku

**Thresholds:**
```typescript
extractionSuccessRate: { healthy: 0.95, warning: 0.90 }
costPerSuccess: { healthy: 0.01, warning: 0.02 }
providerErrorRate: { healthy: 0.05, warning: 0.10 }
latencyP95Ms: { healthy: 5000, warning: 10000 }
```

#### 4. Geo pinning cez FetchProfile
**Commit:** `de4b103`
- `geoCountry` pole v FetchProfile (ISO 3166-1 alpha-2)
- Priority: `FetchProfile.geoCountry` → `BRIGHTDATA_COUNTRY` env → undefined
- Umožňuje multi-market support (rôzne geo pre rôzne domény)

**Príklad použitia:**
```sql
UPDATE fetch_profiles SET geo_country = 'cz' WHERE name = 'Czech ecommerce';
UPDATE fetch_profiles SET geo_country = 'de' WHERE name = 'German suppliers';
```

#### 5. Hostile domain policy (Etsy, Amazon, DataDome sites)
**Problém:** Fallback zoo (http→headless→flaresolverr→brightdata) spôsobuje:
- Zbytočné requesty pred paid providerom
- Zvýšenú pravdepodobnosť challenge
- Zhoršený SLO

**Riešenie pre hostile domény:**
```sql
UPDATE fetch_profiles SET
  preferred_provider = 'brightdata',
  disabled_providers = '{http,headless,flaresolverr,twocaptcha_proxy,twocaptcha_datadome,scraping_browser}',
  stop_after_preferred_failure = true,
  geo_country = 'us'
WHERE name LIKE '%Etsy%' OR name LIKE '%DataDome%';
```

**Circuit breaker:** 3 failures v 10 min → cooldown 15min → 60min → 6h

#### 6. Aktívne domény (stav 4. jan 2026)
17 aktívnych domén vrátane:
- www.alza.sk (450 rules)
- www.reifen.com (151 rules)
- sk.iherb.com (44 rules)
- www.amazon.com (37 rules)
- www.etsy.com (36 rules) - **brightdata-only, geo=us**
- www.walmart.com (17 rules)

#### 7. Etsy Burst Test výsledky (4. jan 2026)
**Pred zmenou politiky:** 26.3% success rate (fallback zoo: http→headless→flaresolverr→brightdata)

**Po zmene politiky (brightdata-only):**
- **Success rate: 87.5%** (14/16 úspešných fetch attempts)
- **Zlepšenie: +61.2 percentuálnych bodov**
- **Total cost: $0.024** (16 × $0.0015)
- **Avg latency: 46.9s**
- **P95 latency: 90.0s** (= timeout)

**Zostávajúce chyby (2/16):** BrightData timeout (90s limit prekročený)

**Konfigurácia:**
```sql
-- Etsy hostile domain policy
preferred_provider = 'brightdata'
disabled_providers = '{http,headless,flaresolverr,twocaptcha_proxy,twocaptcha_datadome,scraping_browser}'
stop_after_preferred_failure = true
geo_country = 'us'
```

**Rate limiter poznámka:** Pre paralelné pravidlá na rovnakej doméne potrebný stagger 90+ sekúnd (brightdata paidRequestsPerMinute=2, burst=1).

#### 8. Selector Audit - EXTRACT_SELECTOR_NOT_FOUND Root Cause (4. jan 2026)

**Problém:** Vysoký podiel EXTRACT_SELECTOR_NOT_FOUND chýb na viacerých doménach (Amazon 76%, Temu 100%, Target 100%).

**Root cause analýza:**

| Doména | Veľkosť | Skutočná príčina | Fix |
|--------|---------|------------------|-----|
| Amazon | 5KB | CAPTCHA soft-wall (`validateCaptcha`, `opfcaptcha.amazon.com`) | Classifier signature |
| Temu | 3KB | Kwai JS challenge (`kwcdn.com/chl/js`) | Classifier signature |
| Target | 138KB | Redirect na homepage (geo-blocking) | FetchProfile geo_country |
| Zalando | 148B | 502 Bad Gateway | Network error handling |

**Záver:** EXTRACT_SELECTOR_NOT_FOUND je väčšinou **classifier gap**, nie selector problém! Stránky vracajú 200 OK s CAPTCHA/challenge obsahom, ktorý nebol detekovaný.

**Implementované classifier signatúry:**
```typescript
// Amazon soft-wall CAPTCHA
/validatecaptcha/i
/opfcaptcha\.amazon\.com/i

// Temu/Kwai JS challenge
/kwcdn\.com.*chl\/js/i
/tcf4d6d81375da79971fbf9d1e81b99bb9/i  // Temu challenge token
```

**Nové fixtures:**
- `amazon-captcha-softwall.html`
- `temu-challenge.html`

**Testy:** 74 passing (vrátane 12 nových pre Amazon/Temu)

#### 8. Burst Test výsledky - Amazon/Temu/Target/Zalando (4. jan 2026)

**FetchProfile konfigurácia (brightdata-only pre hostile domény):**
```sql
-- fp-brightdata-001 (Amazon, Temu)
preferred_provider = 'brightdata'
disabled_providers = '{http,headless,flaresolverr,twocaptcha_proxy,twocaptcha_datadome,scraping_browser}'
stop_after_preferred_failure = true
geo_country = 'us'

-- fp-zalando-de (Zalando)
geo_country = 'de'
```

**SLO výsledky za 24h:**
| Doména | Attempts | Success | Rate | Total Cost | Avg Latency |
|--------|----------|---------|------|------------|-------------|
| **Amazon** | 23 | 23 | **100%** | $0.009 | 1.1s |
| **Target** | 4 | 3 | 75% | $0.003 | 11.2s |
| **Temu** | 6 | 3 | **50%** | $0.0045 | 22.1s |
| **Zalando** | 5 | 3 | 60% | $0.003 | 3.6s |

**Chyby podľa typu:**

| Doména | Outcome | Detail |
|--------|---------|--------|
| Temu | TIMEOUT | 60s limit prekročený (2×) |
| Temu | STILL_BLOCKED | DataDome challenge (3MB) - BrightData nedokáže obísť |
| Target | HTTP 404 | Geo-redirect problém |
| Zalando | HTTP 403 | Free provider blokovaný |
| Zalando | RATE_LIMITED | BrightData trial account limit |
| Temu | RATE_LIMITED | BrightData trial account limit |

**Závery:**
1. **Amazon brightdata-only = 100% success** (po priradení FetchProfile)
2. **Temu DataDome** - ani BrightData Web Unlocker nedokáže spoľahlivo obísť
3. **BrightData trial limity** - potrebné verified account pre burst testy
4. **Classifier signatúry fungujú** - Amazon CAPTCHA a Temu challenge správne detekované

**Odporúčania:**
- Temu: Zvážiť 2captcha DataDome riešenie alebo Scraping Browser
- BrightData: Verifikovať account pre vyššie rate limity
- Target: Upraviť geo_country alebo URL

#### 9. Domain Tier System (5. jan 2026)
**Problém:** Jednotný fallback zoo (http→headless→flaresolverr→brightdata) neefektívny pre rôzne typy domén.

**Riešenie:** 3-úrovňový tier systém v FetchProfile:

| Tier | Názov | SLO Target | Fetch Strategy | Príklady |
|------|-------|------------|----------------|----------|
| **tier_a** | HTTP-first | ≥95% | http→headless→flaresolverr, bez paid | alza.sk, reifen.com, iherb.com |
| **tier_b** | Paid-first stable | ≥95% | brightdata-only, geo-pinned | amazon.com, etsy.com, walmart.com |
| **tier_c** | Hostile/best-effort | <70% OK | brightdata→scraping_browser→2captcha | temu.com, shein.com |
| **rate_limit** | Rate limited | N/A | Paused, exponential backoff | Domény s rate limit chybami |
| **unknown** | Neznámy | N/A | Default tier_a behavior | Nové domény |

**Konfigurácia:**
```sql
-- Tier A (default) - väčšina domén
UPDATE fetch_profiles SET domain_tier = 'tier_a' WHERE domain_tier IS NULL;

-- Tier B - stabilné hostile domény (paid-only)
UPDATE fetch_profiles SET
  domain_tier = 'tier_b',
  preferred_provider = 'brightdata',
  disabled_providers = '{http,headless,flaresolverr}',
  stop_after_preferred_failure = true,
  geo_country = 'us'
WHERE name ILIKE '%amazon%' OR name ILIKE '%etsy%';

-- Tier C - agresívne hostile domény (best-effort)
UPDATE fetch_profiles SET
  domain_tier = 'tier_c',
  preferred_provider = 'brightdata'
WHERE name ILIKE '%temu%' OR name ILIKE '%shein%';
```

**Metriky podľa tieru (stav 5. jan 2026):**
| Tier | Domény | Úspešnosť | Priemerný cost/fetch |
|------|--------|-----------|----------------------|
| tier_a | 14 | 92% | $0.00 (free) |
| tier_b | 3 | 94% | $0.0015 (brightdata) |
| tier_c | 0 | - | - (best-effort) |

**Support Matrix:**
| Doména | Tier | Provider | Stav | Poznámka |
|--------|------|----------|------|----------|
| alza.sk | tier_a | http | OK | Default, stabilný |
| reifen.com | tier_a | http | OK | Default, stabilný |
| amazon.com | tier_b | brightdata | OK | 100% po tier_b |
| etsy.com | tier_b | brightdata | OK | 87.5%, timeout issues |
| temu.com | tier_c | brightdata | FAIL | 50%, DataDome blocker |
| target.com | tier_b | brightdata | PARTIAL | Geo-redirect issues |

**Implementácia:**
- Prisma enum `DomainTier` v schéme
- Pole `domain_tier` v FetchProfile s default `tier_a`
- FetchOrchestrator respektuje tier pri výbere providera
