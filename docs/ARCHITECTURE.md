# Sentinel - Change Intelligence Platform

Komplexná dokumentácia architektúry, servera a závislostí.

## Obsah

1. [Prehľad projektu](#prehľad-projektu)
2. [Štruktúra monorepa](#štruktúra-monorepa)
3. [Serverová infraštruktúra](#serverová-infraštruktúra)
4. [Databázová schéma](#databázová-schéma)
5. [Worker Pipeline](#worker-pipeline)
6. [Extractor Package](#extractor-package)
7. [Storage System](#storage-system)
8. [Error Taxonomy](#error-taxonomy)
9. [Deployment](#deployment)

---

## Prehľad projektu

Sentinel je platforma pre monitorovanie zmien na webových stránkach. Umožňuje:

- **Extrakciu dát** - CSS/XPath selektory, JSON path, regex
- **Normalizáciu** - ceny, dostupnosť, text, čísla
- **Detekciu zmien** - Anti-flap algoritmus pre stabilné hodnoty
- **Alerting** - Slack, email, webhook notifikácie
- **Screenshots** - Automatické zachytávanie stavu stránky

### Tech Stack

| Vrstva | Technológia |
|--------|-------------|
| Runtime | Node.js 20+ |
| Package Manager | pnpm 10+ (workspaces) |
| Backend | NestJS 10.x |
| Job Queue | BullMQ + Redis |
| Database | PostgreSQL 16 + Prisma ORM |
| Frontend | Next.js 14 (Cloudflare Pages) |
| Extension | Chrome Manifest V3 |
| Storage | MinIO (S3-compatible) |
| Headless | Playwright + FlareSolverr |

---

## Štruktúra monorepa

```
sentinel/
├── apps/
│   ├── api/              # NestJS REST API (:3000)
│   │   ├── src/
│   │   │   ├── rules/    # CRUD pre pravidlá
│   │   │   ├── sources/  # Zdroje (URL)
│   │   │   ├── auth/     # JWT autentifikácia
│   │   │   └── alerts/   # Správa alertov
│   │   └── package.json
│   │
│   ├── worker/           # BullMQ background worker
│   │   ├── src/
│   │   │   ├── processors/
│   │   │   │   ├── run.processor.ts      # Hlavný procesor pravidiel
│   │   │   │   └── alert.processor.ts    # Odosielanie notifikácií
│   │   │   ├── services/
│   │   │   │   ├── queue.service.ts          # Správa BullMQ frontov
│   │   │   │   ├── dedupe.service.ts         # Deduplikácia alertov
│   │   │   │   ├── condition-evaluator.ts    # Vyhodnocovanie podmienok
│   │   │   │   ├── alert-generator.ts        # Generovanie alertov
│   │   │   │   ├── rate-limiter.ts           # Token bucket rate limiting
│   │   │   │   └── health-score.ts           # Zdravie pravidiel (0-100)
│   │   │   └── utils/
│   │   │       ├── normalize-value.ts        # Normalizácia hodnôt
│   │   │       └── change-detection.ts       # Detekcia typu zmeny
│   │   └── package.json
│   │
│   ├── web/              # Next.js dashboard
│   │   ├── src/
│   │   │   ├── app/      # App Router
│   │   │   └── components/
│   │   └── package.json
│   │
│   ├── extension/        # Chrome MV3 extension
│   │   ├── src/
│   │   │   ├── popup/    # Popup UI
│   │   │   ├── background.ts
│   │   │   └── content.ts
│   │   └── manifest.json
│   │
│   └── api-proxy/        # Cloudflare Worker proxy
│
├── packages/
│   ├── shared/           # Spoločné typy a Prisma
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── src/
│   │       ├── domain.ts        # TypeScript typy
│   │       └── error-taxonomy.ts # Mapovanie chýb
│   │
│   ├── extractor/        # Extrakcia a fetching
│   │   └── src/
│   │       ├── fetcher/          # HTTP + Headless + FlareSolverr
│   │       ├── extraction/       # CSS/XPath/Regex parsovanie
│   │       ├── normalization/    # Normalizácia hodnôt
│   │       ├── antiflap/         # Anti-flap state machine
│   │       └── change-detection/ # Detekcia zmien
│   │
│   ├── notify/           # Notifikačné kanály
│   │   └── src/
│   │       ├── slack.ts
│   │       ├── email.ts
│   │       └── webhook.ts
│   │
│   └── storage/          # S3/Supabase storage
│       └── src/
│           ├── client.ts         # S3 client
│           ├── supabase-client.ts
│           └── factory.ts        # Auto-select storage
│
└── docs/                 # Dokumentácia
    └── ARCHITECTURE.md   # Tento súbor
```

---

## Serverová infraštruktúra

### Hetzner VPS

| Parameter | Hodnota |
|-----------|---------|
| IP | `135.181.99.192` |
| OS | Ubuntu 22.04 |
| SSH | `ssh root@135.181.99.192` |

### Systemd služby

```bash
# Sentinel služby
sentinel-api.service      # NestJS API (:3000)
sentinel-web.service      # Next.js Dashboard (:8080)
sentinel-worker.service   # BullMQ Worker

# Infraštruktúra
redis-server.service      # Redis pre BullMQ
cloudflare-tunnel.service # Hlavný Cloudflare tunnel
```

#### Konfigurácia služieb

**sentinel-worker.service:**
```ini
[Unit]
Description=Sentinel Worker
After=network.target redis.service

[Service]
Type=simple
WorkingDirectory=/root/sentinel/apps/worker
ExecStart=/usr/bin/node dist/main.js
Environment=NODE_ENV=production
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Docker kontajnery

```bash
# cd /root/n8n && docker compose up -d
```

| Kontajner | Image | Porty | Účel |
|-----------|-------|-------|------|
| n8n-postgres-1 | postgres:16 | 5432 | Hlavná databáza |
| n8n-minio-1 | minio/minio:latest | 9000, 9001 | S3 storage |
| n8n-n8n-1 | n8nio/n8n | 5678 | Automation |
| flaresolverr | ghcr.io/flaresolverr/flaresolverr | 8191 | Cloudflare bypass |

### Cloudflare Tunnel

Konfigurácia: `/root/.cloudflared/config.yml`

| Hostname | Interný port | Služba |
|----------|--------------|--------|
| sentinel.taxinearme.sk | 8080 | Next.js Dashboard |
| storage.taxinearme.sk | 9000 | MinIO S3 API |
| minio.taxinearme.sk | 9001 | MinIO Console |
| n8n.taxinearme.sk | 5678 | N8N Automation |
| claude.taxinearme.sk | 7681 | Claude Web Terminal |

### Environment premenné (Worker)

Súbor: `/root/sentinel/apps/worker/.env`

```bash
NODE_ENV=production
DATABASE_URL=postgresql://n8n:n8n_password_2024@localhost:5432/sentinel?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
WORKER_CONCURRENCY_RULES=5
WORKER_CONCURRENCY_ALERTS=10

# S3 Storage (MinIO)
S3_ENDPOINT=https://storage.taxinearme.sk
S3_REGION=us-east-1
S3_BUCKET=sentinel-storage
S3_ACCESS_KEY_ID=sentinel_admin
S3_SECRET_ACCESS_KEY=sentinel_minio_2024_secure
S3_FORCE_PATH_STYLE=true

# FlareSolverr
FLARESOLVERR_URL=http://localhost:8191/v1
```

---

## Databázová schéma

### Hlavné modely

```
User (1) ──── (*) Workspace ──── (*) Source ──── (*) Rule
                     │                              │
                     ├── FetchProfile               ├── RuleState
                     └── NotificationChannel        ├── Run ──── Observation
                                                    └── Alert
```

### Kľúčové tabuľky

| Tabuľka | Účel | Kľúčové polia |
|---------|------|---------------|
| `rules` | Pravidlá monitorovania | `extraction`, `normalization`, `alertPolicy` |
| `rule_state` | Anti-flap stav | `lastStable`, `candidate`, `candidateCount` |
| `runs` | História behov | `fetchModeUsed`, `errorCode`, `screenshotPath` |
| `observations` | Extrahované hodnoty | `extractedNormalized`, `changeKind` |
| `alerts` | Generované alerty | `severity`, `dedupeKey`, `channelsSent` |
| `fetch_profiles` | Fetch konfigurácia | `mode`, `userAgent`, `cookies`, `headers` |

### Enums

```typescript
enum FetchMode {
  http       // Rýchly HTTP fetch
  headless   // Playwright browser
  flaresolverr // Cloudflare bypass (2captcha)
}

enum RuleType {
  price        // Cenová normalizácia
  availability // Skladová dostupnosť
  text         // Textový obsah
  number       // Číselné hodnoty
  json_field   // JSON path extrakcia
}

enum ChangeKind {
  new_value         // Prvá hodnota
  value_changed     // Zmena hodnoty
  value_disappeared // Hodnota zmizla
  threshold_exceeded // Prekročený prah
}
```

---

## Worker Pipeline

### Hlavný flow (RunProcessor)

```
┌─────────────────────────────────────────────────────────────────┐
│                    BullMQ Job: rules:run                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Load Rule ──► 2. Rate Limit Check ──► 3. Create Run Record │
│                                                                 │
│  4. smartFetch() ──► HTTP → Headless fallback → FlareSolverr   │
│        │                                                        │
│        ▼                                                        │
│  5. extract() ──► Primary selector → Auto-healing (fallbacks)  │
│        │                                                        │
│        ▼                                                        │
│  6. normalizeValue() ──► Price/Availability/Text/Number        │
│        │                                                        │
│        ▼                                                        │
│  7. processAntiFlap() ──► Candidate counting → Confirmation    │
│        │                                                        │
│        ▼                                                        │
│  8. detectChange() ──► ChangeKind určenie                      │
│        │                                                        │
│        ▼                                                        │
│  9. Screenshot upload (ak enabled)                              │
│        │                                                        │
│        ▼                                                        │
│  10. Trigger Alerts (ak confirmedChange)                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Rate Limiting

Token bucket per domain a mode:

| Mode | Tokeny | Refill |
|------|--------|--------|
| http | 60/min | 1/sec |
| headless | 20/min | 1/3sec |
| flaresolverr | 5/min | 1/12sec |

### Anti-Flap algoritmus

Zabraňuje falošným alertom pri nestabilných hodnotách:

```
Kandidát → Počítaj po sebe idúce rovnaké hodnoty → Potvrď zmenu
              │
              └── requireConsecutive: 2 (default)
```

### Auto-healing selektorov

Ak primárny selektor zlyhá, worker skúša alternatívne selektory z `selectorFingerprint`:

```typescript
{
  "alternativeSelectors": [
    ".product-price .amount",
    "[data-price]",
    ".price-box .final-price"
  ],
  "textAnchor": "199.99"  // Validácia hodnoty
}
```

---

## Extractor Package

### Moduly

| Modul | Súbory | Účel |
|-------|--------|------|
| `fetcher/` | smart-fetch.ts, http.ts, headless.ts, flaresolverr.ts | Sťahovanie HTML |
| `extraction/` | css.ts, xpath.ts, regex.ts, jsonpath.ts | Extrakcia hodnôt |
| `normalization/` | price.ts, availability.ts, text.ts | Normalizácia |
| `antiflap/` | state-machine.ts | Stabilizácia hodnôt |
| `change-detection/` | detector.ts | Detekcia typu zmeny |

### smartFetch()

Inteligentný fetch s auto-fallback:

```
HTTP request
    │
    ├── Success → Return HTML
    │
    ├── Block detected (CAPTCHA, Cloudflare)
    │       │
    │       └── Fallback to Headless
    │               │
    │               ├── Success → Return HTML
    │               │
    │               └── Still blocked → FlareSolverr (2captcha)
    │
    └── Error → Return error code
```

### Block Detection

Detekcia blokovania v `block-detection.ts`:

| ErrorCode | Popis |
|-----------|-------|
| BLOCK_CLOUDFLARE_SUSPECTED | Cloudflare challenge |
| BLOCK_CAPTCHA_SUSPECTED | CAPTCHA detekované |
| BLOCK_RATE_LIMIT_429 | HTTP 429 |
| BLOCK_FORBIDDEN_403 | HTTP 403 |

---

## Storage System

### Priorita klientov

1. **Supabase Storage** - ak `SUPABASE_URL` a `SUPABASE_SERVICE_ROLE_KEY`
2. **S3 (MinIO)** - ak `S3_BUCKET` a credentials

### Štruktúra súborov

```
sentinel-storage/
├── rules/
│   └── {ruleId}/
│       └── runs/
│           └── {runId}/
│               ├── screenshot-{timestamp}.png
│               └── html-{timestamp}.html
```

### Prístupové URL

- **Interné (worker):** `http://localhost:9000`
- **Verejné (browser):** `https://storage.taxinearme.sk`

---

## Error Taxonomy

Mapovanie technických kódov na používateľsky prívetivé správy.

### Import

```typescript
import { getErrorInfo, ErrorInfo } from '@sentinel/shared';

const info = getErrorInfo('FETCH_TIMEOUT');
// info.title = "Request Timeout"
// info.description = "The website took too long to respond."
// info.recommendation = "Try increasing the timeout..."
// info.severity = "warning"
// info.retryable = true
```

### Kategórie chýb

| Kategória | Príklady | Severity |
|-----------|----------|----------|
| Fetch | FETCH_TIMEOUT, FETCH_DNS | warning/error |
| Block | CLOUDFLARE_BLOCK, CAPTCHA_BLOCK | warning/error |
| Extraction | SELECTOR_BROKEN, EXTRACT_EMPTY_VALUE | error/warning |
| System | SYSTEM_WORKER_CRASH | critical |

Podrobnosti v: `apps/extension/docs/ERROR-TAXONOMY.md`

---

## Deployment

### Web Dashboard (Cloudflare Pages)

```bash
cd apps/web
npx @cloudflare/next-on-pages
npx wrangler pages deploy .vercel/output/static
```

### Worker (Server)

```bash
ssh root@135.181.99.192
cd /root/sentinel
git pull
pnpm install
pnpm --filter @sentinel/worker build
systemctl restart sentinel-worker
```

### API (Server)

```bash
pnpm --filter @sentinel/api build
systemctl restart sentinel-api
```

### Užitočné príkazy

```bash
# Logy workera
journalctl -u sentinel-worker -f

# Restart všetkých služieb
systemctl restart sentinel-api sentinel-worker sentinel-web

# Docker kontajnery
cd /root/n8n && docker compose logs -f

# MinIO console
# https://minio.taxinearme.sk (sentinel_admin / sentinel_minio_2024_secure)
```

---

## Troubleshooting

### Screenshots nefungujú

1. Skontroluj S3 credentials v `.env`
2. Over MinIO bucket existuje: `sentinel-storage`
3. Skontroluj cloudflared config pre `storage.taxinearme.sk`
4. Reštartuj worker: `systemctl restart sentinel-worker`

### Worker nebeží

```bash
# Status
systemctl status sentinel-worker

# Logy
journalctl -u sentinel-worker -n 100

# Redis
systemctl status redis-server
redis-cli ping
```

### Headless fallback nefunguje

1. Over že Playwright je nainštalovaný
2. Skontroluj `/root/sentinel/apps/worker/.env` pre FlareSolverr URL
3. Ver že flaresolverr docker beží: `docker ps | grep flare`

---

*Posledná aktualizácia: 29. december 2024*
