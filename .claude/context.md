# Context Summary

## Current Status
- **Project**: Sentinel - Web Monitoring Platform
- **Phase**: Self-healing selectors implementation complete
- **Task**: Documentation and session wrap-up

## Completed Work

### Self-Healing Selectors (hlavná práca tejto session)
1. **Nový modul** `packages/extractor/src/selector-healing/`
   - `types.ts` - ElementFingerprint, SelectorFingerprint, HealingResult
   - `fingerprint.ts` - Extrakcia fingerprint z DOM elementov
   - `similarity.ts` - Váhovaný algoritmus podobnosti (Jaccard, Levenshtein)
   - `healing.ts` - Multi-stratégové liečenie (primary → fallback → fingerprint)

2. **Worker integrácia** `apps/worker/src/processors/run.processor.ts`
   - `extractWithHealing()` nahradil priamu extrakciu
   - Automatické ukladanie fingerprint pri úspešnej extrakcii
   - Auto-update pravidla pri healed selektore

3. **Testy** - Všetky prešli:
   - Primary selector funguje
   - Fallback healing funguje
   - Fingerprint matching (66% podobnosť) funguje

### Analýza zlyhávajúcich pravidiel
- **Amazon** - Produkt "Currently unavailable" (nie bug)
- **Etsy** - DataDome blokácia (systémová prekážka)

### Dokumentácia
- Vytvorená: `docs/sessions/2026-01-02-self-healing-selectors.md`

## Commity tejto session
| Commit | Popis |
|--------|-------|
| `c910661` | feat: Self-healing selectors with fingerprinting |
| `b53aefb` | docs: Add self-healing selectors session notes |
| `ad63140` | docs: Move session notes to docs/sessions/ |

## Technical Context

### Infraštruktúra TieredFetch
| Tier | Provider | Output |
|------|----------|--------|
| Free 1 | HTTP fetch | Raw HTML |
| Free 2 | FlareSolverr | Rendered DOM |
| Paid 1 | Bright Data | Rendered HTML |
| Paid 2 | 2Captcha | CAPTCHA token |

### Similarity algoritmus (váhy)
- tagName: 20% (must match)
- id: 15%
- classNames: 15% (Jaccard)
- textContent: 15% (Levenshtein)
- parentStructure: 10%
- attributes: 10%
- position: 10%
- grandparent: 5%

## Čo chýba (feedback od externého agenta)
- Domain Capability Model (hostile/moderate/open)
- Success rate UI badge
- Passive capture mode (extension sleduje keď user browsuje)
- "Neviem" stav namiesto "Error"

## Next Steps
1. Implementovať Domain Capability Model
2. Pridať UI badge pre reliability
3. Zvážiť Passive capture mode v extension
4. Circuit breaker pre Bright Data

## Debugging príkazy
```bash
# Worker logy
ssh root@135.181.99.192 "journalctl -u sentinel-worker -n 50 | grep -E 'healed|healing'"

# Check pravidlá
ssh root@135.181.99.192 "docker exec -i n8n-postgres-1 psql -U n8n -d sentinel -c \"SELECT id, name, health_score FROM rules WHERE health_score < 50\""

# Restart worker
ssh root@135.181.99.192 "systemctl restart sentinel-worker"
```
