# Sentinel Worker - Implementačný plán opráv

**Dátum:** 29. december 2024
**Priorita:** Kritická (bezpečnostné zraniteľnosti)

## Prehľad problémov

| Priorita | Problém | Závažnosť |
|----------|---------|-----------|
| P0 | Hardcoded Encryption Key | KRITICKÁ |
| P0 | SSRF zraniteľnosť | KRITICKÁ |
| P1 | Race Conditions v RuleState | VYSOKÁ |
| P1 | Memory Leaks - Playwright | VYSOKÁ |
| P2 | Polnočný bug v dayBucket | STREDNÁ |
| P2 | Duplicitná logika deduplikácie | STREDNÁ |
| P3 | Auto-healing uloženie nesprávneho selektora | NÍZKA |
| P3 | Timezone ICU závislosť | NÍZKA |

---

## Fáza 1: Kritické bezpečnostné opravy (P0)

### 1.1 Hardcoded Encryption Key

**Súbor:** `apps/worker/src/processors/alert.processor.ts`

**Problém:**
```typescript
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'sentinel-default-encryption-key-32';
```

**Riešenie:**
1. Odstrániť fallback - aplikácia musí zlyhať pri štarte ak ENCRYPTION_KEY chýba
2. Pridať validáciu do `config.service.ts`
3. Pridať startup check v `main.ts`

### 1.2 SSRF Zraniteľnosť

**Súbor:** Nový `apps/api/src/sources/utils/url-validator.ts`

**Blokovať:**
- `localhost`, `127.0.0.1`
- `169.254.169.254` (AWS metadata)
- Privátne IP rozsahy (10.x, 172.16-31.x, 192.168.x)
- `file://` protokol

---

## Fáza 2: Race Conditions (P1)

### 2.1 RuleState Optimistic Locking

**Súbory:**
- `packages/shared/prisma/schema.prisma` - pridať `version` field
- `apps/worker/src/processors/run.processor.ts` - implementovať optimistic locking

**Prisma zmena:**
```prisma
model RuleState {
  // ... existujúce fieldy ...
  version Int @default(0)  // NOVÝ FIELD
}
```

### 2.2 Cooldown Race Condition

**Súbor:** `apps/worker/src/services/dedupe.service.ts`

**Riešenie:** Redis SETNX pre atomickú kontrolu cooldownu

---

## Fáza 3: Playwright Memory Leaks (P1)

**Súbor:** `packages/extractor/src/fetcher/headless.ts`

**Riešenie:**
1. Implementovať BrowserPool s max 3 inštanciami
2. Idle timeout 5 minút
3. Graceful shutdown na SIGTERM/SIGINT
4. Vždy zatvoriť context v finally bloku

---

## Fáza 4: Anti-flap a Deduplikácia (P2)

### 4.1 Polnočný Bug

**Súbor:** `apps/worker/src/services/dedupe.service.ts`

**Riešenie:** 4-hodinové prekryvacie okno okolo polnoci

### 4.2 Duplicitná Logika

**Súbor:** `apps/worker/src/services/alert-generator.service.ts`

**Riešenie:** Odstrániť duplicitnú `generateDedupeKey()` metódu

---

## Fáza 5: Edge-cases (P3)

### 5.1 Auto-healing Validácia

**Súbor:** `apps/worker/src/processors/run.processor.ts`

**Riešenie:** Pridať 70% similarity threshold pred uložením healovaného selektora

### 5.2 Timezone Fallback

**Súbor:** `apps/worker/src/services/dedupe.service.ts`

**Riešenie:** Validovať timezone pred použitím, fallback na UTC

---

## Kritické súbory na úpravu

1. `apps/worker/src/processors/alert.processor.ts`
2. `apps/api/src/sources/sources.service.ts`
3. `apps/worker/src/processors/run.processor.ts`
4. `packages/extractor/src/fetcher/headless.ts`
5. `apps/worker/src/services/dedupe.service.ts`
6. `packages/shared/prisma/schema.prisma`

---

## Testovacia stratégia

```typescript
// SSRF testy
describe('URL Validator', () => {
  it('should reject localhost', async () => {
    expect((await validateUrl('http://localhost')).valid).toBe(false);
  });

  it('should reject AWS metadata', async () => {
    expect((await validateUrl('http://169.254.169.254')).valid).toBe(false);
  });
});
```

---

*Generované: 29. december 2024*
