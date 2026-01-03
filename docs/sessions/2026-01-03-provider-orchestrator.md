# Provider Orchestrator Implementation

**Dátum:** 2026-01-03
**Status:** Dokončené

## Prehľad

Implementácia inteligentného Provider Orchestrator systému, ktorý nahrádza lineárny TieredFetch fallback chain policy-driven výberom providerov.

## Problém (z externej analýzy)

1. **Diera A:** Bright Data zlyhalo → prázdna odpoveď nebola správne klasifikovaná
2. **Diera B:** Chýbal provider orchestrátor - lineárny fallback nebol efektívny
3. **Diera C:** Žiadne cost tracking a budget enforcement

## Riešenie

### Nové komponenty

| Komponent | Súbor | Účel |
|-----------|-------|------|
| **FetchAttempt Ledger** | `packages/shared/prisma/schema.prisma` | Audit log všetkých fetch pokusov |
| **DomainStats** | `packages/shared/prisma/schema.prisma` | Denné agregácie per doména |
| **FetchResult Types** | `apps/worker/src/types/fetch-result.ts` | Unified contract pre všetky providers |
| **Empty/Block Classifiers** | `apps/worker/src/utils/fetch-classifiers.ts` | Detekcia prázdnych responses a blokov |
| **Circuit Breaker** | `apps/worker/src/services/domain-circuit-breaker.service.ts` | Per (workspace, hostname, provider) |
| **Budget Guard** | `apps/worker/src/services/budget-guard.service.ts` | Denné cost limity |
| **FetchAttempt Logger** | `apps/worker/src/services/fetch-attempt-logger.service.ts` | Logovanie pokusov |
| **FetchOrchestrator** | `apps/worker/src/services/fetch-orchestrator.service.ts` | Hlavný orchestrátor |
| **Stats API** | `apps/api/src/stats/` | Endpointy pre UI |

### Provider Chain

```
FREE (vždy prvé):
  http → mobile_ua → flaresolverr → headless

PAID (ak allowPaid=true a budget OK):
  brightdata → scraping_browser → twocaptcha_proxy
```

### Circuit Breaker

Per (workspaceId, hostname, providerId) s eskalujúcimi cooldowns:

| Otvorenie | Cooldown |
|-----------|----------|
| 1. krát | 15 minút |
| 2. krát | 60 minút |
| 3.+ krát | 6 hodín (hostile domain) |

Otvorí sa po 3 zlyhaniach v 10-minútovom okne.

### Budget Enforcement

| Úroveň | Denný limit | Efekt |
|--------|-------------|-------|
| Workspace | $10 | Všetky pravidlá degradujú na free |
| Doména | $2 | Konkrétna doména degraduje na free |
| Pravidlo | $0.50 | Pravidlo degraduje na free |

### Empty ako First-Class Outcome

```typescript
type FetchOutcome =
  | 'ok'              // Úspech
  | 'blocked'         // Detekovaná ochrana (Cloudflare, DataDome...)
  | 'captcha_required'// CAPTCHA potrebná
  | 'empty'           // Prázdna/neplatná odpoveď (soft failure)
  | 'timeout'         // Timeout
  | 'network_error'   // Sieťová chyba
  | 'provider_error'; // Chyba providera
```

## Stats API Endpoints

```
GET /stats/domains?days=7   - Domain reliability stats
GET /stats/providers?days=7 - Provider success rates & costs
GET /stats/budget           - Current spend vs daily limit
```

## Commity

| Hash | Popis |
|------|-------|
| `5962ffc` | feat(db): add FetchAttempt ledger and DomainStats models |
| `55b8019` | feat(worker): add empty/block detection classifiers |
| `22a9b69` | fix(worker): circuit breaker cleanup and cooldown tier fix |
| `f06f24d` | feat(worker): add budget guard service |
| `a0ea62f` | fix(worker): use proper Prisma enum types |
| `74c6992` | feat(worker): add FetchOrchestrator for policy-driven fetching |
| `12ad078` | feat(worker): register orchestrator services in module |
| `888fb07` | fix(worker): critical fixes for RunProcessor integration |

## Testy

- 18 nových testov pre fetch-classifiers
- 74/74 testov prechádza
- Build úspešný

## Ďalšie kroky

1. Monitoring na produkcii - sledovať circuit breaker aktivitu
2. UI dashboard pre stats endpointy
3. Konfigurovateľné budget limity per workspace (momentálne hardcoded)
