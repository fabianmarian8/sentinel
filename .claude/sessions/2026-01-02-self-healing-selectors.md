# Session: Self-Healing Selectors - 02.01.2026

## Prehľad
Implementácia automatického opravovania zlomených CSS selektorov pomocou element fingerprinting.

---

## 1. Problém

Používatelia hlásili "Broken Selector" chyby pre Amazon a Etsy pravidlá. Selektory sa lámu keď:
- E-shop zmení HTML štruktúru
- Triedy sa premenujú
- Elementy sa presunú

---

## 2. Riešenie: Self-Healing Selectors

### Nový modul: `packages/extractor/src/selector-healing/`

| Súbor | Účel |
|-------|------|
| `types.ts` | ElementFingerprint, SelectorFingerprint, HealingResult |
| `fingerprint.ts` | Extrakcia fingerprint z elementov |
| `similarity.ts` | Váhovaný algoritmus podobnosti |
| `healing.ts` | Multi-stratégové liečenie |
| `index.ts` | Exporty modulu |

### Healing stratégie (v poradí)

1. **Primary selector** - Skús pôvodný selector
2. **Fallback selectors** - Skús alternatívne selektory z konfigurácie
3. **Fingerprint matching** - Nájdi podobný element pomocou fingerprint

### Element Fingerprint obsahuje

```typescript
interface ElementFingerprint {
  tagName: string;           // div, span, etc.
  id?: string;               // Stabilné ID
  classNames: string[];      // Filtrované triedy (bez CSS-in-JS)
  textContent: string;       // Prvých 100 znakov
  textLength: number;
  parentTag: string;
  parentClasses: string[];
  parentId?: string;
  grandparentTag?: string;
  siblingIndex: number;      // Pozícia medzi súrodencami
  depth: number;             // Hĺbka v DOM
  attributes: Record<string, string>;  // data-testid, aria-label, etc.
}
```

### Similarity algoritmus (váhy)

| Komponent | Váha |
|-----------|------|
| tagName | 20% (must match) |
| id | 15% |
| classNames | 15% (Jaccard) |
| textContent | 15% (Levenshtein) |
| parentStructure | 10% |
| attributes | 10% |
| position | 10% |
| grandparent | 5% |

### Worker integrácia

**Súbor:** `apps/worker/src/processors/run.processor.ts`

```typescript
// Nový flow
const healingResult = await extractWithHealing(html, {
  selector: extraction.selector,
  attribute: extraction.attribute,
  fallbackSelectors: [...configFallbacks, ...fingerprintAlternatives],
  storedFingerprint: rule.selectorFingerprint,
  similarityThreshold: 0.6,
});

// Ak healed, automaticky aktualizuj pravidlo
if (healingResult.healed) {
  await prisma.rule.update({
    where: { id: ruleId },
    data: {
      extraction: { ...extraction, selector: healingResult.selectorUsed },
      selectorFingerprint: newFingerprint,
    },
  });
}
```

### Testované scenáre

| Test | Výsledok |
|------|----------|
| Primary selector funguje | ✅ Vráti hodnotu + fingerprint |
| Primary zlyhal, fallback funguje | ✅ Auto-heal, similarity 0% |
| Všetko zlyhalo, fingerprint match | ✅ Nájde element so 66% podobnosťou |

---

## 3. Analýza zlyhávajúcich pravidiel

### Amazon (cmjx5t5zm000dz346f09iof1o)
- **Problém:** Produkt je "Currently unavailable" - nemá cenu
- **Príčina:** Nie je to bug, produkt nie je na sklade
- **Riešenie:** Healing nemôže nájsť cenu ktorá neexistuje

### Etsy (cmjwwvhsz00073ahj9wup5ziw)
- **Problém:** DataDome blokácia
- **Príčina:** Aj Bright Data vracia prázdnu odpoveď
- **Riešenie:** Systémová prekážka, nie problém selektora

---

## 4. Bot Protection - Produktová realita

### Čo už máme
- ✅ Block detection (403/429, CF markers, DataDome)
- ✅ TieredFetch orchestrátor (HTTP → FlareSolverr → Bright Data)
- ✅ Per-domain rate limiting
- ✅ Health score tracking
- ✅ Evidence (screenshots, HTML archív)
- ✅ Validation + anti-flap

### Čo chýba (feedback od externého agenta)
- ❌ Domain Capability Model (explicitné "hostile/moderate/open")
- ❌ Success rate UI badge ("93% last 7d" / "Unreliable")
- ❌ Passive capture mode (extension sleduje keď user browsuje)
- ❌ "Neviem" namiesto "zlyhalo" v UI

### Kľúčový insight

> **Bot protection nie je edge case, je to core product challenge.**
>
> Rozdiel medzi "monitoring tool" a "večná údržba" je v tom, ako elegantne priznáš "tento web je hostile, úspešnosť 40%".

---

## 5. Aktuálna infraštruktúra TieredFetch

| Tier | Provider | Output | Kedy |
|------|----------|--------|------|
| Free 1 | HTTP fetch | Raw HTML | Statické stránky |
| Free 2 | FlareSolverr | Rendered DOM | JS-heavy, Cloudflare |
| Paid 1 | Bright Data Web Unlocker | Rendered HTML | DataDome, PerimeterX |
| Paid 2 | 2Captcha | CAPTCHA token | Keď Bright Data vráti CAPTCHA |

### Flow
```
HTTP → (blocked?) → FlareSolverr → (blocked?) → Bright Data → (CAPTCHA?) → 2Captcha
```

### Známe problémy
- Bright Data občas vracia prázdnu odpoveď (DataDome/Etsy)
- Chýba fallback keď Bright Data zlyhá
- Chýba cost tracking / budget limity

---

## 6. Odporúčané ďalšie kroky

1. **Domain Capability Model**
   - `capability: "open" | "moderate" | "hostile"`
   - `expectedSuccessRate: number (rolling 7d)`
   - `maxFrequency: number (enforced)`

2. **UI improvements**
   - Reliability badge: "93% last 7d" / "Unreliable: frequently blocked"
   - "Neviem" stav namiesto "Error"

3. **Passive capture mode**
   - Extension sleduje ceny keď user browsuje
   - Drasticky zvyšuje úspešnosť pri hostile weboch

4. **Provider orchestrator refactor**
   - Abstrakcia "provider" namiesto len "mode"
   - Cost budget limity
   - Automatic fallback policies

---

## Commity

| Commit | Popis |
|--------|-------|
| `c910661` | feat: Self-healing selectors with fingerprinting |

---

## Príkazy

```bash
# Test healing modulu
cd /Users/marianfabian/Projects/sentinel
node -e "
const { extractWithHealing } = require('./packages/extractor/dist/selector-healing');
extractWithHealing('<html>...</html>', {
  selector: '.price',
  attribute: 'text',
}).then(console.log);
"

# Worker logy
ssh root@135.181.99.192 "journalctl -u sentinel-worker -n 50 | grep -E 'healed|healing'"

# Check pravidlá v DB
ssh root@135.181.99.192 "docker exec -i n8n-postgres-1 psql -U n8n -d sentinel -c \"
  SELECT id, name, health_score, last_error_code, selector_fingerprint IS NOT NULL as has_fp
  FROM rules WHERE health_score < 50
\""
```

---

*Posledná aktualizácia: 02.01.2026*
