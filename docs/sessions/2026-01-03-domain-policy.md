# Domain Policy Implementation

**Dátum:** 2026-01-03
**Status:** Dokončené

## Prehľad

Implementácia domain policy pre paid-first routing na základe odporúčaní externého agenta pre Etsy problém.

## Problém

FlareSolverr zlyhával na Etsy (EXTRACT_SELECTOR_NOT_FOUND) zatiaľ čo Bright Data fungoval.

**Root cause:** FlareSolverr vracia HTML okamžite po vyriešení Cloudflare challenge bez čakania na JavaScript rendering. Etsy používa `.wt-text-title-larger` selector ktorý existuje až po JS renderingu.

## Riešenie

### Nové polia v FetchProfile

| Pole | Typ | Popis |
|------|-----|-------|
| `preferredProvider` | FetchProvider? | Preferovaný provider pre paid-first |
| `flareSolverrWaitSeconds` | Int? | Čakanie po challenge (sekundy) |

### Logika v FetchOrchestrator

```typescript
// Ak je preferredProvider nastavený, presunie sa na začiatok kandidátov
if (req.preferredProvider && config.allowPaid) {
  const preferredIndex = candidates.findIndex(c => c.id === req.preferredProvider);
  if (preferredIndex > 0) {
    const [preferred] = candidates.splice(preferredIndex, 1);
    candidates.unshift(preferred);
  }
}
```

### FlareSolverr waitInSeconds

Propagované cez:
- `SmartFetchOptions.flareSolverrWaitSeconds`
- `FetchRequest.flareSolverrWaitSeconds`
- `FetchProfile.flareSolverrWaitSeconds`

## Použitie pre Etsy

```sql
-- Nastav Etsy FetchProfile na paid-first
UPDATE fetch_profiles
SET preferred_provider = 'brightdata'
WHERE workspace_id = '<workspace>'
  AND name LIKE '%etsy%';
```

Alebo alternatívne s FlareSolverr wait:
```sql
UPDATE fetch_profiles
SET flaresolverr_wait_seconds = 5
WHERE workspace_id = '<workspace>'
  AND name LIKE '%etsy%';
```

## Commity

| Hash | Popis |
|------|-------|
| `7c973b6` | feat(orchestrator): add domain policy for paid-first routing |

## Zmenené súbory

- `packages/shared/prisma/schema.prisma` - nové polia v FetchProfile
- `apps/worker/src/types/fetch-result.ts` - rozšírený FetchRequest interface
- `apps/worker/src/services/fetch-orchestrator.service.ts` - preferredProvider routing
- `apps/worker/src/processors/run.processor.ts` - propagácia polí
- `packages/extractor/src/fetcher/smart-fetch.ts` - flareSolverrWaitSeconds

## Ďalšie kroky

1. **UI pre FetchProfile** - pridať formulár pre preferredProvider a waitSeconds
2. **Auto-detection** - automaticky nastaviť paid-first pre hostile domény
3. **Monitoring** - sledovať success rate per doména a provider
