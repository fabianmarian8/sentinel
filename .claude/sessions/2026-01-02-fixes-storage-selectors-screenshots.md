# Session: Storage, Selectors & Screenshots - 02.01.2026

## Prehľad
Opravy pre MinIO storage, CSS selector patterns a screenshot kvalitu.

---

## 1. MinIO Storage - Screenshots nefungovali

### Problém
Worker logoval: `No storage client configured - screenshots will be disabled`

### Root Cause
Worker `.env` nemal S3/MinIO credentials.

### Riešenie
Pridané do `/root/sentinel/apps/worker/.env`:
```bash
# S3 Storage (MinIO)
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=sentinel-storage
S3_ACCESS_KEY_ID=sentinel_admin
S3_SECRET_ACCESS_KEY=8r5luTMpbATKaCxeq9gis4tdFjkfU
S3_FORCE_PATH_STYLE=true
```

### MinIO Info
- **Čo je MinIO:** Self-hosted S3-compatible storage (open-source, zadarmo)
- **Docker:** `n8n-minio-1` kontajner
- **Bucket:** `sentinel-storage`
- **Console:** https://minio.taxinearme.sk
- **API:** https://storage.taxinearme.sk

---

## 2. Broken Selectors - Amazon/Walmart/eBay

### Problém
Pravidlá pre Amazon, Walmart, eBay mali opakovane "Broken Selector" error.

### Root Cause (Oponent analýza)
`CSS_IN_JS_PATTERNS` v extension nefiltroval e-commerce špecifické dynamické triedy:
- Amazon: `a-price-whole`, `a-size-medium`, `aok-hidden`
- Walmart: `w_iUH7`, `w_V_DM` (hash triedy)
- eBay: `ux-*`, `x-*`, `vi-*`
- Tachyons: `f6`, `pa3`, `lh-copy`

### Riešenie
**Súbor:** `apps/extension/src/content/index.ts`

Pridané nové patterns:
```typescript
// === Amazon patterns ===
/^a-[a-z]+-[a-z0-9-]+$/i,        // a-price-whole, a-size-medium
/^aok-[a-z0-9-]+$/i,             // aok-inline-block
/^a-spacing-/i,                  // Amazon spacing utilities
/^a-declarative$/i,              // Amazon declarative
/^a-popover-/i,                  // Amazon popover classes
/^celwidget$/i,                  // Amazon widget class

// === Walmart patterns ===
/^w_[a-zA-Z0-9]{2,}$/,           // Walmart hash: w_iUH7

// === Tachyons utilities ===
/^f[0-9]$/,                      // Font size: f1-f7
/^lh-[a-z]+$/,                   // Line height
/^[pm][atrblxyhv][0-9]$/,        // Padding/margin

// === eBay patterns ===
/^ux-[a-z0-9-]+$/i,              // eBay UX components
/^x-[a-z0-9-]+$/i,               // eBay X components
/^vi-[a-z0-9-]+$/i,              // eBay view item
```

**Commit:** `a71d7a3`

### Po oprave
1. Reload extension v Chrome (`chrome://extensions`)
2. Vymazať staré broken pravidlá
3. Vytvoriť nové - selektory budú stabilnejšie

---

## 3. Screenshots nečitateľné

### Problém
Screenshots boli príliš veľké a nečitateľné.

### Root Cause
- Padding bol 200px (~5cm), používateľ chcel 10cm
- Fallback bol `fullPage: true` (obrovské súbory)
- Prípona `.png` ale obsah bol JPEG

### Riešenie
**Súbor:** `packages/extractor/src/fetcher/headless.ts`

| Pred | Po |
|------|-----|
| `padding = 200` | `padding = 400` (~10cm) |
| `fullPage: true` | `fullPage: false` (viewport only) |

**Súbor:** `apps/worker/src/processors/run.processor.ts`
- Zmenené `screenshot-${run.id}.png` → `screenshot-${run.id}.jpg`

**Commit:** `615837c`

---

## 4. CAPTCHA Toggle Button

### Problém
Potrebný toggle pre `captchaIntervalEnforced` na testovanie.

### Riešenie
**Súbory upravené:**
- `apps/web/src/app/dashboard/rules/[id]/RuleDetailClient.tsx` - UI toggle
- `apps/api/src/rules/dto/update-rule.dto.ts` - DTO property
- `apps/api/src/rules/rules.service.ts` - update handler

### Ako funguje
| Toggle | Význam |
|--------|--------|
| 🔒 Zapnuté | Interval 1 deň, nepoužije Bright Data |
| 🔓 Vypnuté | Automaticky eskaluje na Bright Data |

**Commit:** `6cf0d6d`

---

## 5. FlareSolverr Session Error

### Problém
```
Error: invalid session id
```

### Riešenie
```bash
docker restart flaresolverr
```

---

## Commity tejto session

| Commit | Popis |
|--------|-------|
| `6cf0d6d` | CAPTCHA toggle button |
| `a71d7a3` | Amazon/Walmart/eBay CSS patterns |
| `615837c` | Screenshot padding 400px + viewport fallback |

---

## Príkazy pre troubleshooting

### MinIO
```bash
# Check bucket
docker exec n8n-minio-1 mc ls local/sentinel-storage/

# List screenshots
docker exec n8n-minio-1 mc ls local/sentinel-storage/rules/ --recursive
```

### FlareSolverr
```bash
# Restart
docker restart flaresolverr

# Logs
docker logs flaresolverr --tail 20
```

### Worker
```bash
# Status
systemctl status sentinel-worker

# Logs
journalctl -u sentinel-worker -f

# Restart
systemctl restart sentinel-worker
```

---

## Známe limitácie

1. **Browser DOM vs HTTP mismatch** - Amazon/Walmart servujú iný HTML pre HTTP vs browser
2. **DataDome bypass** - Vyžaduje Bright Data ($0.0015/request)
3. **iHerb** - Potrebuje Bright Data, FlareSolverr často zlyháva

---

*Posledná aktualizácia: 02.01.2026*
