# Orchestrator P0/P1 Fixes - Engineering Task List

**Dátum:** 2026-01-03
**Autor:** Claude Code (na základe analýzy externého agenta)
**Status:** Plán

## Zhrnutie problémov

### P0 - Kritické
1. **Duplicitná klasifikácia outcome** - 3 rôzne implementácie
2. **Rate limiting mimo reality** - limituje podľa fetchProfile.mode, nie skutočného providera
3. **rawSample sa neplní** - debugging naslepo

### P1 - Dôležité
4. **Doménové policy** - chýba allowlist/denylist providerov
5. **Cost model nekonzistentný** - 0.003 vs 0.0015 pre brightdata

---

## PR1: Zjednotenie outcome klasifikácie

### Problém
Tri nezávislé implementácie block/outcome detekcie:
- `packages/extractor/src/fetcher/block-detection.ts` (detectBlock)
- `apps/worker/src/utils/fetch-classifiers.ts` (determineFetchOutcome)
- `apps/worker/src/services/fetch-orchestrator.service.ts` (mapToOutcome + checkForBlockPage)

### Riešenie
Použiť **jediný** classifier: `apps/worker/src/utils/fetch-classifiers.ts` (`determineFetchOutcome`)

### Zmeny

#### 1. Odstrániť duplicitu z orchestrátora
**Súbor:** `apps/worker/src/services/fetch-orchestrator.service.ts`

```typescript
// PRED:
private mapToOutcome(result: { success: boolean; errorCode: string | null; html: string | null }): FetchOutcome {
  // ... lokálna logika
}
private checkForBlockPage(html: string): { isBlocked: boolean; kind: string; signals: string[] } {
  // ... duplicitná detekcia
}

// PO:
import { determineFetchOutcome } from '../utils/fetch-classifiers';

// V execute() po každom provider pokuse:
const classification = determineFetchOutcome(
  providerResult.httpStatus,
  providerResult.html,
  contentType,
  providerResult.errorDetail
);

const fetchResult: FetchResult = {
  provider: candidate.id,
  outcome: classification.outcome,
  blockKind: classification.blockKind,
  signals: classification.signals,
  // ...
};
```

#### 2. Rozšíriť determineFetchOutcome o chýbajúce patterny
**Súbor:** `apps/worker/src/utils/fetch-classifiers.ts`

Pridať patterny z `checkForBlockPage`:
- `datadome device check`
- `cf-browser-verification`

### Akceptačné kritériá
- [ ] Orchestrátor volá `determineFetchOutcome()` pre každý provider pokus
- [ ] `signals` a `blockKind` sú správne vyplnené v `FetchResult`
- [ ] `mapToOutcome()` a `checkForBlockPage()` sú odstránené z orchestrátora
- [ ] Unit testy pre determineFetchOutcome pokrývajú DataDome/Cloudflare/PerimeterX

---

## PR2: Prepojenie rate limitingu s reálnym providerom

### Problém
Rate limit sa volá PRED orchestrátorom s `fetchProfile.mode`:
```typescript
// run.processor.ts:150
const rateLimitResult = await this.rateLimiter.consumeToken(
  domain,
  fetchModeUsed,  // <-- fetchProfile.mode, nie skutočný provider!
);
```

Ak `fetchProfile.mode = 'http'`, ale orchestrátor použije `brightdata`, rate limit pre brightdata sa neaplikuje.

### Riešenie
Rate limiting presunúť DO orchestrátora per-provider.

### Zmeny

#### 1. Pridať rate limiter do orchestrátora
**Súbor:** `apps/worker/src/services/fetch-orchestrator.service.ts`

```typescript
constructor(
  // ...
  private readonly rateLimiter: RateLimiterService,
) {}

// V fetch() pred candidate.execute():
const rateLimitResult = await this.rateLimiter.consumeToken(
  req.hostname,
  candidate.id,  // skutočný provider
);

if (!rateLimitResult.allowed) {
  this.logger.debug(`[Orchestrator] Rate limit for ${candidate.id}@${req.hostname}, skipping`);
  continue;
}
```

#### 2. Odstrániť rate limit z RunProcessor
**Súbor:** `apps/worker/src/processors/run.processor.ts`

Odstrániť blok na riadkoch 150-174 (rateLimiter.consumeToken pred orchestrátorom).

#### 3. Rozšíriť RateLimiterService o provider-aware buckety
**Súbor:** `apps/worker/src/services/rate-limiter.service.ts`

```typescript
// Key format: domain:provider
// Rôzne limity pre rôzne providery:
// - http/headless: vyššie limity (10 req/min)
// - brightdata/scraping_browser: nižšie limity (2 req/min)
```

### Akceptačné kritériá
- [ ] Rate limit sa volá v orchestrátori pred každým provider pokusom
- [ ] Rate limit kľúč obsahuje provider ID (`etsy.com:brightdata`)
- [ ] Paid providery majú nižšie limity ako free
- [ ] RunProcessor už nerobí rate limit check pred orchestrátorom

---

## PR3: Implementácia rawSample pre debugging

### Problém
`Run.rawSample` existuje v schéme ale nikde sa nenastavuje. Pri problémoch musíme robiť forenznú analýzu naslepo.

### Riešenie
Ukladať výrez HTML pri problémových outcome.

### Zmeny

#### 1. Pridať rawSample do OrchestratorResult
**Súbor:** `apps/worker/src/services/fetch-orchestrator.service.ts`

```typescript
export interface OrchestratorResult {
  final: FetchResult;
  attempts: FetchResult[];
  html?: string;
  rawSample?: string;  // Prvých 50KB pri problémoch
}

// V fetch() na konci:
return {
  final: finalResult,
  attempts,
  html: finalHtml,
  rawSample: this.extractRawSample(finalResult, finalHtml),
};

private extractRawSample(result: FetchResult, html?: string): string | undefined {
  // Ukladať sample len pri problémoch
  const problemOutcomes: FetchOutcome[] = ['blocked', 'captcha_required', 'empty'];
  if (!problemOutcomes.includes(result.outcome)) return undefined;
  if (!html) return undefined;

  // Max 50KB
  return html.slice(0, 50000);
}
```

#### 2. Uložiť rawSample do Run
**Súbor:** `apps/worker/src/processors/run.processor.ts`

```typescript
// Po orchestrator.fetch():
const orchestratorResult = await this.fetchOrchestrator.fetch(fetchRequest, orchestratorConfig);

// Pri vytváraní/aktualizácii Run záznamu:
await this.prisma.run.update({
  where: { id: run.id },
  data: {
    // ...
    rawSample: orchestratorResult.rawSample,
  },
});
```

### Akceptačné kritériá
- [ ] rawSample je vyplnený pri outcome: blocked, captcha_required, empty
- [ ] rawSample je max 50KB
- [ ] rawSample NIE je vyplnený pri outcome: ok (šetrí DB)
- [ ] Existujúci debug endpoint `/api/runs/:id/debug` zobrazuje rawSample

---

## PR4: Doménové policy - provider allowlist/denylist

### Problém
`preferredProvider` len presúva providera na začiatok, ale ak failne, systém skúša všetkých ostatných (aj zbytočných pre danú doménu).

Pre Etsy: ak brightdata failne, skúša http, headless, flaresolverr - všetci zbytočne.

### Riešenie
Rozšíriť FetchProfile o `disabledProviders` a `stopAfterPreferredFailure`.

### Zmeny

#### 1. Prisma schéma
**Súbor:** `packages/shared/prisma/schema.prisma`

```prisma
model FetchProfile {
  // ... existujúce polia ...

  // Domain policy
  preferredProvider         FetchProvider? @map("preferred_provider")
  disabledProviders         FetchProvider[] @map("disabled_providers")
  stopAfterPreferredFailure Boolean @default(false) @map("stop_after_preferred_failure")
  maxAttempts               Int?    @map("max_attempts")
}
```

#### 2. Implementácia v orchestrátore
**Súbor:** `apps/worker/src/services/fetch-orchestrator.service.ts`

```typescript
// V buildCandidates():
// Filtrovať disabled providery
const filteredCandidates = candidates.filter(
  c => !req.disabledProviders?.includes(c.id)
);

// V fetch():
// Ak preferredProvider failol a stopAfterPreferredFailure je true, skončiť
if (req.stopAfterPreferredFailure && req.preferredProvider) {
  const preferredFailed = attempts.some(
    a => a.provider === req.preferredProvider && a.outcome !== 'ok'
  );
  if (preferredFailed) {
    this.logger.log(`[Orchestrator] Preferred provider failed, stopping (stopAfterPreferredFailure=true)`);
    break;
  }
}
```

#### 3. SQL pre Etsy
```sql
UPDATE fetch_profiles
SET
  preferred_provider = 'brightdata',
  disabled_providers = '{http,headless,flaresolverr}',
  stop_after_preferred_failure = true
WHERE name LIKE '%etsy%';
```

### Akceptačné kritériá
- [ ] disabledProviders fungujú - provider sa neskúša
- [ ] stopAfterPreferredFailure zastaví chain po zlyhané preferredProvider
- [ ] Etsy používa len brightdata (disabled sú http, headless, flaresolverr)

---

## PR5: Konsolidácia cost modelu

### Problém
- `apps/worker/src/types/fetch-result.ts`: `brightdata: 0.003`
- `apps/worker/src/services/brightdata.service.ts`: `~0.0015`

Budget guard rozhoduje podľa jedného čísla, ledger loguje druhé.

### Riešenie
Jediné miesto pravdy pre cost: `PROVIDER_COSTS` v `fetch-result.ts`.

### Zmeny

#### 1. Aktualizovať PROVIDER_COSTS
**Súbor:** `apps/worker/src/types/fetch-result.ts`

```typescript
export const PROVIDER_COSTS: Record<ProviderId, { perRequest: number; description: string }> = {
  // ...
  brightdata: { perRequest: 0.0015, description: 'Bright Data Web Unlocker ~$1.50/1000' },
  // ...
};
```

#### 2. Provider služby majú vracať skutočný cost
**Súbor:** `apps/worker/src/services/brightdata.service.ts`

```typescript
// Použiť PROVIDER_COSTS.brightdata.perRequest namiesto hardcoded hodnoty
import { PROVIDER_COSTS } from '../types/fetch-result';

return {
  success: true,
  html,
  cost: PROVIDER_COSTS.brightdata.perRequest,
  // ...
};
```

### Akceptačné kritériá
- [ ] Všetky provider služby používajú PROVIDER_COSTS
- [ ] BudgetGuard a ledger používajú rovnaké hodnoty
- [ ] Komentáre v PROVIDER_COSTS zodpovedajú realite

---

## Poradie implementácie

1. **PR1** (Klasifikácia) - základ pre všetko ostatné
2. **PR3** (rawSample) - nezávislé, pomôže pri debugovaní
3. **PR5** (Cost model) - rýchle, nízke riziko
4. **PR2** (Rate limiting) - vyžaduje PR1
5. **PR4** (Domain policy) - vyžaduje PR1, PR2

## Odhadovaná náročnosť

| PR | Effort | Risk | LOC |
|----|--------|------|-----|
| PR1 | Stredný | Stredný | ~100 |
| PR2 | Vysoký | Vysoký | ~150 |
| PR3 | Nízky | Nízky | ~50 |
| PR4 | Stredný | Stredný | ~100 |
| PR5 | Nízky | Nízky | ~20 |

**Celkom:** ~420 LOC, 2-3 dni práce
