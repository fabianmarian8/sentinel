# Cloudflare Pages Cache Fix

## Problém

Browser zobrazoval starú verziu (Strážca) napriek novým deploymentom kvôla agresívnemu cachingu na viacerých úrovniach:

1. **Cloudflare Edge Cache**: `cache-control: s-maxage=31536000` (1 rok!)
2. **Browser Cache**: Service workers + local cache
3. **Next.js Static Export**: Default cache headers príliš agresívne

### Prečo `curl` videl správnu verziu ale browser nie?

- `curl` **nepoužíva** browser cache ani service workers
- Browser má **3 vrstvy cache**: Service Worker → Browser Cache → Cloudflare Edge
- Všetky 3 vrstvy mali starú verziu

## Riešenie

### 1. Immediate Fix (vykonaj TERAZ)

```bash
# Purge cache a redeploy
./purge-cache.sh

# Alebo manuálne:
cd /Users/marianfabian/Projects/sentinel/apps/web
npx wrangler pages deployment create --project-name=sentinel-app --branch=main
```

### 2. Browser Cache Clear

**Mac:**
- Cmd+Shift+R (hard refresh)
- Cmd+Option+E (clear cache)
- Cmd+Shift+Delete (clear all)

**Windows:**
- Ctrl+Shift+R (hard refresh)
- Ctrl+Shift+Delete (clear all)

**DevTools:**
1. F12 → Network tab
2. ✅ Disable cache
3. Right-click Reload → Empty Cache and Hard Reload

### 3. Dlhodobá oprava (UŽ IMPLEMENTOVANÉ)

#### `/Users/marianfabian/Projects/sentinel/apps/web/next.config.js`
```js
async headers() {
  return [
    {
      source: '/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
    },
    {
      source: '/_next/static/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ];
}
```

#### `/Users/marianfabian/Projects/sentinel/apps/web/public/_headers`
```
/*.html
  Cache-Control: public, max-age=0, must-revalidate

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
```

## Deploy Workflow

### Normálny deploy
```bash
./deploy-fresh.sh
```

### Cache purge bez rebuildu
```bash
./purge-cache.sh
```

### Manuálny proces
```bash
# 1. Clean build
rm -rf .next .vercel
npm run build

# 2. Deploy
npx wrangler pages deploy .vercel/output/static \
  --project-name=sentinel-app \
  --branch=main

# 3. Verify
curl -sI https://sentinel.taxinearme.sk/ | grep -i cache
```

## Overenie

```bash
# Check cache headers
curl -sI https://sentinel.taxinearme.sk/ | grep -i "cache\|age"

# Check content
curl -s https://sentinel.taxinearme.sk/_next/static/chunks/app/page-c084416727f4bf9a.js \
  | grep -o "Sentinel\|Strážca"

# Expected output:
# Sentinel  ✅
# NOT Strážca ❌
```

## Timeline

- **28.12.2024 21:59**: Problém identifikovaný
- **28.12.2024 22:00**: Cache headers opravené
- **28.12.2024 22:01**: Deploy skripty vytvorené

## Prečo to fungovalo pre `curl` ale nie browser?

### curl request:
```
User → Cloudflare Edge → Origin
              ↓
          (bypass browser cache)
```

### Browser request (PRED opravou):
```
User → Service Worker → Browser Cache → Cloudflare Edge → Origin
        ↓ (1 rok)        ↓ (1 rok)        ↓ (1 rok)
     STARÁ VERZIA     STARÁ VERZIA     STARÁ VERZIA
```

### Browser request (PO oprave):
```
User → Service Worker → Browser Cache → Cloudflare Edge → Origin
        ↓ (0s)           ↓ (0s)           ↓ (0s)
     VŽDY FRESH       VŽDY FRESH       VŽDY FRESH
```

## Next Steps

1. ✅ Spusti `./deploy-fresh.sh`
2. ✅ Počkaj 60s na propagáciu
3. ✅ Hard refresh browser (Cmd+Shift+R)
4. ✅ Otvor incognito window pre test

## Prevencia

Od teraz:
- HTML/RSC: `max-age=0, must-revalidate` (žiadny cache)
- Static assets: `max-age=31536000, immutable` (permanentný cache lebo hash v názve)
- Každý deploy = nové chunk hashe = automatická invalidácia
