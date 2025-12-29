# Error Taxonomy - User-Friendly Error Messages

## Problem

Pred implementáciou Error Taxonomy systému sa v rozšírení zobrazovali len technické kódy chýb ako `FETCH_TIMEOUT`, `BLOCK_CLOUDFLARE_SUSPECTED` atď. Používatelia nevedeli:
- Čo chyba znamená
- Či je to závažný problém
- Ako ho vyriešiť

## Riešenie

Implementovali sme **Error Taxonomy** systém v `@sentinel/shared` balíku, ktorý mapuje technické kódy na:
- **Názov** - ľudsky čitateľný názov chyby
- **Popis** - vysvetlenie čo sa stalo
- **Odporúčanie** - ako problém vyriešiť
- **Závažnosť** - `info` | `warning` | `error` | `critical`
- **Opakovateľnosť** - či má zmysel skúsiť znova

## Implementácia v Extension

### Import
```typescript
import { getErrorInfo } from '@sentinel/shared';
```

### Použitie
```typescript
const errorInfo = getErrorInfo(rule.lastErrorCode);
if (errorInfo) {
  // errorInfo.title - "Request Timeout"
  // errorInfo.description - "The website took too long to respond."
  // errorInfo.recommendation - "Try increasing the timeout..."
  // errorInfo.severity - "warning"
  // errorInfo.retryable - true
}
```

### Zobrazenie v UI

V zozname pravidiel sa chyby zobrazujú ako farebné boxy:

| Závažnosť | Farba pozadia | Farba okraja |
|-----------|---------------|--------------|
| critical  | #fef2f2 (červená) | #dc2626 |
| error     | #fef2f2 (červená) | #ef4444 |
| warning   | #fffbeb (žltá) | #f59e0b |
| info      | #eff6ff (modrá) | #3b82f6 |

## Zoznam Error Codes

### Fetch Errors
| Kód | Názov | Závažnosť |
|-----|-------|-----------|
| `FETCH_TIMEOUT` | Request Timeout | warning |
| `FETCH_DNS` | DNS Error | error |
| `FETCH_CONNECTION` | Connection Failed | warning |
| `FETCH_TLS` | SSL/TLS Error | error |
| `FETCH_HTTP_4XX` | Client Error | warning |
| `FETCH_HTTP_5XX` | Server Error | warning |

### Block Detection
| Kód | Názov | Závažnosť |
|-----|-------|-----------|
| `CAPTCHA_BLOCK` | CAPTCHA Required | error |
| `CLOUDFLARE_BLOCK` | Cloudflare Challenge | warning |
| `RATELIMIT_BLOCK` | Rate Limited | warning |
| `GEO_BLOCK` | Geographic Block | error |
| `BOT_DETECTION` | Bot Detection | warning |

### Extraction Errors
| Kód | Názov | Závažnosť |
|-----|-------|-----------|
| `SELECTOR_BROKEN` | Broken Selector | error |
| `SELECTOR_HEALED` | Selector Auto-Healed | info |
| `EXTRACT_SELECTOR_NOT_FOUND` | Element Not Found | error |
| `EXTRACT_EMPTY_VALUE` | Empty Value | warning |
| `EXTRACT_PARSE_ERROR` | Parse Error | warning |

### System Errors
| Kód | Názov | Závažnosť |
|-----|-------|-----------|
| `SYSTEM_WORKER_CRASH` | System Error | critical |
| `SYSTEM_QUEUE_DELAY` | Processing Delayed | info |

## Súvisiace súbory

- `packages/shared/src/error-taxonomy.ts` - definícia Error Taxonomy
- `packages/shared/src/domain.ts` - definícia ErrorCode type
- `apps/extension/src/popup/index.ts` - zobrazenie v UI
- `apps/web/src/components/rules/RulesList.tsx` - zobrazenie v dashboarde

## Pridanie novej chyby

1. Pridaj kód do `ErrorCode` type v `packages/shared/src/domain.ts`
2. Pridaj definíciu do `ERROR_TAXONOMY` v `packages/shared/src/error-taxonomy.ts`
3. Zbuildi shared package: `cd packages/shared && npm run build`
