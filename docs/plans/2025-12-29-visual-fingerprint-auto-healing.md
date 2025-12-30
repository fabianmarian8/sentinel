# Visual Fingerprint Auto-Healing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementovať vizuálny fingerprinting systém, ktorý automaticky nájde element keď CSS selektor zlyhá - na základe vizuálnych vlastností (pozícia, veľkosť, farby, textový pattern).

**Architecture:**
1. Extension generuje rozšírený VisualFingerprint pri výbere elementu
2. Worker pri extrakcii ak selektor zlyhá, použije visual-matcher modul
3. Visual-matcher nájde najpodobnejší element v HTML pomocou scoring algoritmu
4. Ak nájde match s vysokým skóre (>0.7), automaticky opraví selektor

**Tech Stack:** TypeScript, Cheerio, Puppeteer/FlareSolverr (pre computed styles), Prisma

---

## Task 1: Definovať VisualFingerprint typy

**Files:**
- Create: `packages/extractor/src/visual-matcher/types.ts`
- Create: `packages/extractor/src/visual-matcher/index.ts`

**Step 1: Vytvoriť types.ts**

```typescript
// packages/extractor/src/visual-matcher/types.ts

/**
 * Visual fingerprint pre element - používa sa na auto-healing
 * keď CSS selektor zlyhá
 */
export interface VisualFingerprint {
  // Pozícia relatívna k viewportu (0-1)
  relativePosition: {
    x: number; // 0 = ľavý okraj, 1 = pravý okraj
    y: number; // 0 = vrch, 1 = spodok
  };

  // Rozmery elementu v px
  dimensions: {
    width: number;
    height: number;
  };

  // Vizuálne vlastnosti
  styles: {
    backgroundColor: string;
    color: string;
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    borderRadius: number;
    display: string;
  };

  // Textový pattern (regex) odvodený z hodnoty
  // napr. "413,90 €" -> "^\\d+,\\d{2}\\s*€$"
  textPattern: string | null;

  // Presný text v čase vytvorenia (pre validáciu)
  textSnapshot: string;

  // Cesta v DOM strome (bez hash classes)
  domPath: string[];

  // Susedné elementy (anchor points)
  neighbors: {
    above: string | null; // text elementu nad
    below: string | null;
    left: string | null;
    right: string | null;
    parent: string | null; // text parent elementu
  };

  // Tag a sémantické atribúty
  tagName: string;
  semanticAttributes: {
    role?: string;
    ariaLabel?: string;
    dataTestId?: string;
    name?: string;
    type?: string;
  };
}

/**
 * Výsledok hľadania elementu podľa visual fingerprint
 */
export interface VisualMatchResult {
  found: boolean;
  selector: string | null;
  confidence: number; // 0-1, kde 1 = perfektný match
  matchDetails: {
    positionScore: number;
    dimensionScore: number;
    styleScore: number;
    textPatternScore: number;
    neighborScore: number;
    domPathScore: number;
  };
  candidatesEvaluated: number;
}

/**
 * Konfigurácia pre visual matcher
 */
export interface VisualMatcherConfig {
  // Minimálne skóre pre akceptovanie matchu (default: 0.7)
  minConfidence: number;

  // Váhy pre jednotlivé faktory
  weights: {
    position: number;    // default: 0.15
    dimensions: number;  // default: 0.10
    styles: number;      // default: 0.15
    textPattern: number; // default: 0.30 (najdôležitejšie)
    neighbors: number;   // default: 0.15
    domPath: number;     // default: 0.15
  };

  // Max počet kandidátov na vyhodnotenie
  maxCandidates: number; // default: 50
}

export const DEFAULT_MATCHER_CONFIG: VisualMatcherConfig = {
  minConfidence: 0.7,
  weights: {
    position: 0.15,
    dimensions: 0.10,
    styles: 0.15,
    textPattern: 0.30,
    neighbors: 0.15,
    domPath: 0.15,
  },
  maxCandidates: 50,
};
```

**Step 2: Vytvoriť index.ts export**

```typescript
// packages/extractor/src/visual-matcher/index.ts
export * from './types';
```

**Step 3: Commit**

```bash
git add packages/extractor/src/visual-matcher/
git commit -m "feat(extractor): add VisualFingerprint types for auto-healing"
```

---

## Task 2: Implementovať text pattern generator

**Files:**
- Create: `packages/extractor/src/visual-matcher/text-pattern.ts`
- Create: `packages/extractor/src/visual-matcher/text-pattern.test.ts`

**Step 1: Napísať failing test**

```typescript
// packages/extractor/src/visual-matcher/text-pattern.test.ts
import { describe, it, expect } from 'vitest';
import { generateTextPattern, matchesTextPattern } from './text-pattern';

describe('generateTextPattern', () => {
  it('should generate pattern for price with currency', () => {
    const pattern = generateTextPattern('413,90 €');
    expect(pattern).toBe('^\\d{1,6}[,.]\\d{2}\\s*€$');
  });

  it('should generate pattern for price with dollar', () => {
    const pattern = generateTextPattern('$99.99');
    expect(pattern).toBe('^\\$\\d{1,6}[,.]\\d{2}$');
  });

  it('should generate pattern for integer', () => {
    const pattern = generateTextPattern('1234');
    expect(pattern).toBe('^\\d+$');
  });

  it('should generate pattern for date', () => {
    const pattern = generateTextPattern('29.12.2025');
    expect(pattern).toBe('^\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}$');
  });

  it('should generate pattern for percentage', () => {
    const pattern = generateTextPattern('15%');
    expect(pattern).toBe('^\\d{1,3}\\s*%$');
  });

  it('should return null for generic text', () => {
    const pattern = generateTextPattern('Nejaký náhodný text');
    expect(pattern).toBeNull();
  });
});

describe('matchesTextPattern', () => {
  it('should match similar price', () => {
    const pattern = generateTextPattern('413,90 €');
    expect(matchesTextPattern('599,00 €', pattern!)).toBe(true);
    expect(matchesTextPattern('1234,56 €', pattern!)).toBe(true);
  });

  it('should not match different format', () => {
    const pattern = generateTextPattern('413,90 €');
    expect(matchesTextPattern('$99.99', pattern!)).toBe(false);
    expect(matchesTextPattern('Skladom', pattern!)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/marianfabian/Projects/sentinel
pnpm --filter @sentinel/extractor test -- text-pattern.test.ts
```

Expected: FAIL - module not found

**Step 3: Implementovať text-pattern.ts**

```typescript
// packages/extractor/src/visual-matcher/text-pattern.ts

/**
 * Pattern templates pre bežné hodnoty
 */
const PATTERN_TEMPLATES = [
  // Ceny s menou
  { regex: /^\$?\d{1,6}[,.]\d{2}\s*€?$/, pattern: '^\\d{1,6}[,.]\\d{2}\\s*€$' },
  { regex: /^\$\d{1,6}[,.]\d{2}$/, pattern: '^\\$\\d{1,6}[,.]\\d{2}$' },
  { regex: /^\d{1,6}[,.]\d{2}\s*(Kč|CZK)$/i, pattern: '^\\d{1,6}[,.]\\d{2}\\s*(Kč|CZK)$' },

  // Celé čísla
  { regex: /^\d+$/, pattern: '^\\d+$' },

  // Percentá
  { regex: /^\d{1,3}\s*%$/, pattern: '^\\d{1,3}\\s*%$' },

  // Dátumy
  { regex: /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/, pattern: '^\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}$' },

  // Čas
  { regex: /^\d{1,2}:\d{2}(:\d{2})?$/, pattern: '^\\d{1,2}:\\d{2}(:\\d{2})?$' },

  // Dostupnosť keywords
  { regex: /^(skladom|dostupné|na sklade|in stock|available)/i, pattern: '^(skladom|dostupné|na sklade|in stock|available)' },
  { regex: /^(vypredané|nedostupné|out of stock|unavailable)/i, pattern: '^(vypredané|nedostupné|out of stock|unavailable)' },
];

/**
 * Generuje regex pattern z hodnoty elementu
 * Vracia null ak hodnota nemá rozpoznateľný vzor
 */
export function generateTextPattern(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed || trimmed.length > 100) {
    return null;
  }

  for (const template of PATTERN_TEMPLATES) {
    if (template.regex.test(trimmed)) {
      return template.pattern;
    }
  }

  return null;
}

/**
 * Kontroluje či text zodpovedá patternu
 */
export function matchesTextPattern(text: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(text.trim());
  } catch {
    return false;
  }
}

/**
 * Vypočíta similarity skóre medzi dvoma textami
 * na základe ich štruktúry (nie obsahu)
 */
export function textStructureSimilarity(text1: string, text2: string): number {
  const pattern1 = generateTextPattern(text1);
  const pattern2 = generateTextPattern(text2);

  // Oba majú pattern a sú rovnaké
  if (pattern1 && pattern2 && pattern1 === pattern2) {
    return 1.0;
  }

  // Jeden má pattern, druhý ho matchuje
  if (pattern1 && matchesTextPattern(text2, pattern1)) {
    return 0.9;
  }
  if (pattern2 && matchesTextPattern(text1, pattern2)) {
    return 0.9;
  }

  // Podobná dĺžka a charakter set
  const len1 = text1.length;
  const len2 = text2.length;
  const lenRatio = Math.min(len1, len2) / Math.max(len1, len2);

  const hasDigits1 = /\d/.test(text1);
  const hasDigits2 = /\d/.test(text2);
  const digitMatch = hasDigits1 === hasDigits2 ? 0.3 : 0;

  return lenRatio * 0.3 + digitMatch;
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @sentinel/extractor test -- text-pattern.test.ts
```

Expected: PASS

**Step 5: Update index.ts a commit**

```typescript
// packages/extractor/src/visual-matcher/index.ts
export * from './types';
export * from './text-pattern';
```

```bash
git add packages/extractor/src/visual-matcher/
git commit -m "feat(extractor): add text pattern generator for visual matching"
```

---

## Task 3: Implementovať scoring algoritmus

**Files:**
- Create: `packages/extractor/src/visual-matcher/scoring.ts`
- Create: `packages/extractor/src/visual-matcher/scoring.test.ts`

**Step 1: Napísať failing test**

```typescript
// packages/extractor/src/visual-matcher/scoring.test.ts
import { describe, it, expect } from 'vitest';
import { calculateMatchScore } from './scoring';
import type { VisualFingerprint } from './types';

describe('calculateMatchScore', () => {
  const baseFingerprint: VisualFingerprint = {
    relativePosition: { x: 0.8, y: 0.3 },
    dimensions: { width: 100, height: 30 },
    styles: {
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(0, 0, 0)',
      fontSize: 16,
      fontWeight: 'bold',
      fontFamily: 'Arial',
      borderRadius: 0,
      display: 'block',
    },
    textPattern: '^\\d{1,6}[,.]\\d{2}\\s*€$',
    textSnapshot: '413,90 €',
    domPath: ['body', 'main', 'div.product', 'span.price'],
    neighbors: {
      above: 'Cena:',
      below: 'Do košíka',
      left: null,
      right: null,
      parent: 'Product info',
    },
    tagName: 'span',
    semanticAttributes: {},
  };

  it('should return 1.0 for identical fingerprint', () => {
    const score = calculateMatchScore(baseFingerprint, baseFingerprint);
    expect(score.confidence).toBeCloseTo(1.0, 1);
  });

  it('should return high score for similar position and matching text pattern', () => {
    const candidate: VisualFingerprint = {
      ...baseFingerprint,
      relativePosition: { x: 0.82, y: 0.32 }, // mierne posunuté
      textSnapshot: '599,00 €', // iná cena, rovnaký pattern
    };
    const score = calculateMatchScore(baseFingerprint, candidate);
    expect(score.confidence).toBeGreaterThan(0.8);
  });

  it('should return low score for different text pattern', () => {
    const candidate: VisualFingerprint = {
      ...baseFingerprint,
      textPattern: null,
      textSnapshot: 'Skladom',
    };
    const score = calculateMatchScore(baseFingerprint, candidate);
    expect(score.confidence).toBeLessThan(0.5);
  });

  it('should return medium score for same pattern but different position', () => {
    const candidate: VisualFingerprint = {
      ...baseFingerprint,
      relativePosition: { x: 0.2, y: 0.9 }, // úplne iná pozícia
      textSnapshot: '199,00 €', // rovnaký pattern
    };
    const score = calculateMatchScore(baseFingerprint, candidate);
    expect(score.confidence).toBeGreaterThan(0.5);
    expect(score.confidence).toBeLessThan(0.8);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @sentinel/extractor test -- scoring.test.ts
```

**Step 3: Implementovať scoring.ts**

```typescript
// packages/extractor/src/visual-matcher/scoring.ts
import type { VisualFingerprint, VisualMatchResult, VisualMatcherConfig, DEFAULT_MATCHER_CONFIG } from './types';
import { matchesTextPattern } from './text-pattern';

/**
 * Vypočíta match skóre medzi fingerprintom a kandidátom
 */
export function calculateMatchScore(
  fingerprint: VisualFingerprint,
  candidate: VisualFingerprint,
  config: VisualMatcherConfig = DEFAULT_MATCHER_CONFIG
): VisualMatchResult {
  const details = {
    positionScore: calculatePositionScore(fingerprint, candidate),
    dimensionScore: calculateDimensionScore(fingerprint, candidate),
    styleScore: calculateStyleScore(fingerprint, candidate),
    textPatternScore: calculateTextPatternScore(fingerprint, candidate),
    neighborScore: calculateNeighborScore(fingerprint, candidate),
    domPathScore: calculateDomPathScore(fingerprint, candidate),
  };

  const { weights } = config;
  const confidence =
    details.positionScore * weights.position +
    details.dimensionScore * weights.dimensions +
    details.styleScore * weights.styles +
    details.textPatternScore * weights.textPattern +
    details.neighborScore * weights.neighbors +
    details.domPathScore * weights.domPath;

  return {
    found: confidence >= config.minConfidence,
    selector: null, // bude doplnený matcher-om
    confidence,
    matchDetails: details,
    candidatesEvaluated: 1,
  };
}

/**
 * Pozícia: penalizuj veľké posuny
 */
function calculatePositionScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  const dx = Math.abs(fp.relativePosition.x - cand.relativePosition.x);
  const dy = Math.abs(fp.relativePosition.y - cand.relativePosition.y);
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Max distance je sqrt(2) ≈ 1.414, normalizujeme
  return Math.max(0, 1 - distance);
}

/**
 * Rozmery: toleruj ±30% odchýlku
 */
function calculateDimensionScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  const widthRatio = Math.min(fp.dimensions.width, cand.dimensions.width) /
                     Math.max(fp.dimensions.width, cand.dimensions.width);
  const heightRatio = Math.min(fp.dimensions.height, cand.dimensions.height) /
                      Math.max(fp.dimensions.height, cand.dimensions.height);

  return (widthRatio + heightRatio) / 2;
}

/**
 * Štýly: porovnaj farby, font
 */
function calculateStyleScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  let score = 0;
  let factors = 0;

  // Font size (±4px tolerancia)
  const fontSizeDiff = Math.abs(fp.styles.fontSize - cand.styles.fontSize);
  score += fontSizeDiff <= 4 ? 1 : fontSizeDiff <= 8 ? 0.5 : 0;
  factors++;

  // Font weight
  score += fp.styles.fontWeight === cand.styles.fontWeight ? 1 : 0;
  factors++;

  // Color (exact match)
  score += fp.styles.color === cand.styles.color ? 1 : 0.5; // partial pre podobné
  factors++;

  // Display type
  score += fp.styles.display === cand.styles.display ? 1 : 0;
  factors++;

  return score / factors;
}

/**
 * Text pattern: najdôležitejší faktor
 */
function calculateTextPatternScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  // Rovnaký pattern
  if (fp.textPattern && cand.textPattern && fp.textPattern === cand.textPattern) {
    return 1.0;
  }

  // Fingerprint má pattern a kandidát ho matchuje
  if (fp.textPattern && matchesTextPattern(cand.textSnapshot, fp.textPattern)) {
    return 0.95;
  }

  // Podobná štruktúra textu (dĺžka, má čísla, atď)
  const hasDigits1 = /\d/.test(fp.textSnapshot);
  const hasDigits2 = /\d/.test(cand.textSnapshot);

  if (hasDigits1 !== hasDigits2) {
    return 0.1; // Veľmi odlišné
  }

  const lenRatio = Math.min(fp.textSnapshot.length, cand.textSnapshot.length) /
                   Math.max(fp.textSnapshot.length, cand.textSnapshot.length);

  return lenRatio * 0.5;
}

/**
 * Susedia: anchor points
 */
function calculateNeighborScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  let matches = 0;
  let total = 0;

  const compareNeighbor = (n1: string | null, n2: string | null) => {
    if (n1 && n2) {
      total++;
      // Fuzzy match - obsahuje podobný text
      if (n1.toLowerCase().includes(n2.toLowerCase().substring(0, 10)) ||
          n2.toLowerCase().includes(n1.toLowerCase().substring(0, 10))) {
        matches++;
      }
    }
  };

  compareNeighbor(fp.neighbors.above, cand.neighbors.above);
  compareNeighbor(fp.neighbors.below, cand.neighbors.below);
  compareNeighbor(fp.neighbors.left, cand.neighbors.left);
  compareNeighbor(fp.neighbors.right, cand.neighbors.right);
  compareNeighbor(fp.neighbors.parent, cand.neighbors.parent);

  return total > 0 ? matches / total : 0.5; // Neutral ak nie sú dáta
}

/**
 * DOM path: porovnaj cestu v strome
 */
function calculateDomPathScore(fp: VisualFingerprint, cand: VisualFingerprint): number {
  // Tag musí sedieť
  if (fp.tagName !== cand.tagName) {
    return 0.2;
  }

  // Porovnaj path (ignoruj hash classes)
  const cleanPath = (path: string[]) =>
    path.map(p => p.replace(/\.[a-z]{2,3}-[a-z0-9]+/gi, '')); // odstráň css-xyz123

  const fp_clean = cleanPath(fp.domPath);
  const cand_clean = cleanPath(cand.domPath);

  let matches = 0;
  const minLen = Math.min(fp_clean.length, cand_clean.length);

  for (let i = 0; i < minLen; i++) {
    if (fp_clean[i] === cand_clean[i]) {
      matches++;
    }
  }

  return minLen > 0 ? matches / minLen : 0;
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @sentinel/extractor test -- scoring.test.ts
```

**Step 5: Update index.ts a commit**

```typescript
// packages/extractor/src/visual-matcher/index.ts
export * from './types';
export * from './text-pattern';
export * from './scoring';
```

```bash
git add packages/extractor/src/visual-matcher/
git commit -m "feat(extractor): add scoring algorithm for visual matching"
```

---

## Task 4: Rozšíriť extension o Visual Fingerprint generátor

**Files:**
- Modify: `apps/extension/src/content/index.ts`

**Step 1: Pridať interface a helper funkcie**

Na začiatok súboru (po existujúcom `SelectorFingerprint` interface) pridať:

```typescript
// apps/extension/src/content/index.ts - po riadku 27

interface VisualFingerprint {
  relativePosition: { x: number; y: number };
  dimensions: { width: number; height: number };
  styles: {
    backgroundColor: string;
    color: string;
    fontSize: number;
    fontWeight: string;
    fontFamily: string;
    borderRadius: number;
    display: string;
  };
  textPattern: string | null;
  textSnapshot: string;
  domPath: string[];
  neighbors: {
    above: string | null;
    below: string | null;
    left: string | null;
    right: string | null;
    parent: string | null;
  };
  tagName: string;
  semanticAttributes: {
    role?: string;
    ariaLabel?: string;
    dataTestId?: string;
    name?: string;
    type?: string;
  };
}
```

**Step 2: Pridať text pattern generator**

```typescript
// apps/extension/src/content/index.ts - pred generateFingerprint()

const TEXT_PATTERNS = [
  { regex: /^\$?\d{1,6}[,.]\d{2}\s*€?$/, pattern: '^\\d{1,6}[,.]\\d{2}\\s*€$' },
  { regex: /^\$\d{1,6}[,.]\d{2}$/, pattern: '^\\$\\d{1,6}[,.]\\d{2}$' },
  { regex: /^\d+$/, pattern: '^\\d+$' },
  { regex: /^\d{1,3}\s*%$/, pattern: '^\\d{1,3}\\s*%$' },
  { regex: /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/, pattern: '^\\d{1,2}[./]\\d{1,2}[./]\\d{2,4}$' },
];

function generateTextPattern(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) return null;

  for (const t of TEXT_PATTERNS) {
    if (t.regex.test(trimmed)) return t.pattern;
  }
  return null;
}

function getNeighborText(element: Element, direction: 'above' | 'below' | 'left' | 'right'): string | null {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  let testX = centerX;
  let testY = centerY;
  const step = 50;

  switch (direction) {
    case 'above': testY = rect.top - step; break;
    case 'below': testY = rect.bottom + step; break;
    case 'left': testX = rect.left - step; break;
    case 'right': testX = rect.right + step; break;
  }

  const neighbor = document.elementFromPoint(testX, testY);
  if (neighbor && neighbor !== element && !element.contains(neighbor)) {
    const text = neighbor.textContent?.trim().slice(0, 50);
    return text || null;
  }
  return null;
}

function getDomPath(element: Element): string[] {
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let part = current.tagName.toLowerCase();

    // Pridaj ID ak existuje
    if (current.id) {
      part += `#${current.id}`;
    } else {
      // Pridaj stabilné classes (nie hash)
      const stableClasses = Array.from(current.classList)
        .filter(cls =>
          !cls.match(/^[a-z]{2,3}-[a-z0-9]+$/i) && // css-xyz123
          !cls.match(/^[a-z]{1,2}\d+/i) &&          // a1b2
          !cls.match(/^_/) &&                        // _xyz
          cls.length < 25
        )
        .slice(0, 2);

      if (stableClasses.length > 0) {
        part += '.' + stableClasses.join('.');
      }
    }

    path.unshift(part);
    current = current.parentElement;

    if (path.length > 6) break;
  }

  return path;
}
```

**Step 3: Pridať generateVisualFingerprint funkciu**

```typescript
// apps/extension/src/content/index.ts - po getDomPath()

function generateVisualFingerprint(element: Element): VisualFingerprint {
  const rect = element.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const computedStyle = window.getComputedStyle(element);
  const textContent = getElementValue(element).slice(0, 100);

  return {
    relativePosition: {
      x: (rect.left + rect.width / 2) / viewportWidth,
      y: (rect.top + rect.height / 2) / viewportHeight,
    },
    dimensions: {
      width: rect.width,
      height: rect.height,
    },
    styles: {
      backgroundColor: computedStyle.backgroundColor,
      color: computedStyle.color,
      fontSize: parseFloat(computedStyle.fontSize) || 16,
      fontWeight: computedStyle.fontWeight,
      fontFamily: computedStyle.fontFamily.split(',')[0].trim(),
      borderRadius: parseFloat(computedStyle.borderRadius) || 0,
      display: computedStyle.display,
    },
    textPattern: generateTextPattern(textContent),
    textSnapshot: textContent,
    domPath: getDomPath(element),
    neighbors: {
      above: getNeighborText(element, 'above'),
      below: getNeighborText(element, 'below'),
      left: getNeighborText(element, 'left'),
      right: getNeighborText(element, 'right'),
      parent: element.parentElement?.textContent?.trim().slice(0, 50) || null,
    },
    tagName: element.tagName.toLowerCase(),
    semanticAttributes: {
      role: element.getAttribute('role') || undefined,
      ariaLabel: element.getAttribute('aria-label') || undefined,
      dataTestId: element.getAttribute('data-testid') ||
                  element.getAttribute('data-test-id') || undefined,
      name: element.getAttribute('name') || undefined,
      type: element.getAttribute('type') || undefined,
    },
  };
}
```

**Step 4: Upraviť handleClick aby zahrnul visual fingerprint**

V existujúcej funkcii `handleClick` (okolo riadku 391), upraviť:

```typescript
function handleClick(event: MouseEvent): void {
  if (!isPicking) return;

  event.preventDefault();
  event.stopPropagation();

  const target = event.target as Element;

  if (target.closest('.sentinel-highlight')) return;

  // Generate fingerprint (includes selector)
  const fingerprint = generateFingerprint(target);
  const visualFingerprint = generateVisualFingerprint(target);  // NOVÉ
  const value = getElementValue(target);

  const selectedElement: SelectedElement = {
    selector: fingerprint.selector,
    value,
    tagName: target.tagName.toLowerCase(),
    fingerprint: {
      ...fingerprint,
      visualFingerprint,  // NOVÉ - pridať do fingerprint objektu
    },
  };

  chrome.runtime.sendMessage({
    action: 'elementSelected',
    element: selectedElement,
  });

  stopPicker();
}
```

**Step 5: Upraviť interface SelectorFingerprint**

```typescript
// apps/extension/src/content/index.ts - riadok 10-20

interface SelectorFingerprint {
  selector: string;
  alternativeSelectors?: string[];
  textAnchor?: string;
  parentContext?: {
    tag: string;
    classes: string[];
    id?: string;
  }[];
  attributes?: Record<string, string>;
  visualFingerprint?: VisualFingerprint;  // NOVÉ
}
```

**Step 6: Commit**

```bash
git add apps/extension/src/content/index.ts
git commit -m "feat(extension): add visual fingerprint generation"
```

---

## Task 5: Implementovať visual matcher v extractor

**Files:**
- Create: `packages/extractor/src/visual-matcher/matcher.ts`
- Create: `packages/extractor/src/visual-matcher/matcher.test.ts`

**Step 1: Napísať failing test**

```typescript
// packages/extractor/src/visual-matcher/matcher.test.ts
import { describe, it, expect } from 'vitest';
import { findElementByVisualFingerprint } from './matcher';
import type { VisualFingerprint } from './types';

describe('findElementByVisualFingerprint', () => {
  const sampleHtml = `
    <html>
      <body style="margin:0; width:1000px; height:800px;">
        <header style="height:100px;">Header</header>
        <main>
          <div class="product">
            <span class="label">Cena:</span>
            <span class="price" style="color:red; font-size:24px; font-weight:bold;">599,00 €</span>
            <button>Do košíka</button>
          </div>
        </main>
      </body>
    </html>
  `;

  const priceFingerprint: VisualFingerprint = {
    relativePosition: { x: 0.3, y: 0.2 },
    dimensions: { width: 100, height: 30 },
    styles: {
      backgroundColor: 'transparent',
      color: 'red',
      fontSize: 24,
      fontWeight: 'bold',
      fontFamily: 'Arial',
      borderRadius: 0,
      display: 'inline',
    },
    textPattern: '^\\d{1,6}[,.]\\d{2}\\s*€$',
    textSnapshot: '413,90 €',
    domPath: ['body', 'main', 'div.product', 'span.price'],
    neighbors: {
      above: null,
      below: 'Do košíka',
      left: 'Cena:',
      right: null,
      parent: 'Cena: 413,90 € Do košíka',
    },
    tagName: 'span',
    semanticAttributes: {},
  };

  it('should find element matching price pattern', () => {
    const result = findElementByVisualFingerprint(sampleHtml, priceFingerprint);

    expect(result.found).toBe(true);
    expect(result.selector).toContain('.price');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('should not find element with different pattern', () => {
    const buttonFingerprint: VisualFingerprint = {
      ...priceFingerprint,
      textPattern: null,
      textSnapshot: 'Submit form',
      tagName: 'button',
    };

    const result = findElementByVisualFingerprint(sampleHtml, buttonFingerprint);
    expect(result.confidence).toBeLessThan(0.5);
  });
});
```

**Step 2: Implementovať matcher.ts**

```typescript
// packages/extractor/src/visual-matcher/matcher.ts
import * as cheerio from 'cheerio';
import type { VisualFingerprint, VisualMatchResult, VisualMatcherConfig } from './types';
import { DEFAULT_MATCHER_CONFIG } from './types';
import { calculateMatchScore } from './scoring';
import { generateTextPattern } from './text-pattern';

/**
 * Nájde element v HTML na základe visual fingerprint
 */
export function findElementByVisualFingerprint(
  html: string,
  fingerprint: VisualFingerprint,
  config: VisualMatcherConfig = DEFAULT_MATCHER_CONFIG
): VisualMatchResult {
  const $ = cheerio.load(html);

  // Zbieraj kandidátov - elementy s rovnakým tagom
  const candidates: Array<{ element: cheerio.Cheerio; selector: string; fingerprint: VisualFingerprint }> = [];

  $(fingerprint.tagName).each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();

    // Skip prázdne alebo príliš dlhé
    if (!text || text.length > 200) return;

    // Generuj fingerprint pre kandidáta (zjednodušený - bez computed styles)
    const candFingerprint = extractFingerprintFromCheerio($, $el);

    // Generuj unikátny selektor
    const selector = generateUniqueSelector($, $el);

    candidates.push({ element: $el, selector, fingerprint: candFingerprint });

    if (candidates.length >= config.maxCandidates) return false; // break
  });

  // Nájdi najlepší match
  let bestMatch: VisualMatchResult = {
    found: false,
    selector: null,
    confidence: 0,
    matchDetails: {
      positionScore: 0,
      dimensionScore: 0,
      styleScore: 0,
      textPatternScore: 0,
      neighborScore: 0,
      domPathScore: 0,
    },
    candidatesEvaluated: candidates.length,
  };

  for (const candidate of candidates) {
    const score = calculateMatchScore(fingerprint, candidate.fingerprint, config);

    if (score.confidence > bestMatch.confidence) {
      bestMatch = {
        ...score,
        selector: candidate.selector,
        candidatesEvaluated: candidates.length,
      };
    }
  }

  bestMatch.found = bestMatch.confidence >= config.minConfidence;

  return bestMatch;
}

/**
 * Extrahuj fingerprint z Cheerio elementu (bez DOM - len statická analýza)
 */
function extractFingerprintFromCheerio($: cheerio.CheerioAPI, $el: cheerio.Cheerio): VisualFingerprint {
  const text = $el.text().trim().slice(0, 100);

  // DOM path
  const domPath: string[] = [];
  let current = $el;
  while (current.length && current[0].tagName !== 'html') {
    const tag = current[0].tagName?.toLowerCase() || '';
    if (!tag) break;

    let part = tag;
    const id = current.attr('id');
    const classes = (current.attr('class') || '').split(/\s+/)
      .filter(cls =>
        cls &&
        !cls.match(/^[a-z]{2,3}-[a-z0-9]+$/i) &&
        !cls.match(/^[a-z]{1,2}\d+/i) &&
        cls.length < 25
      )
      .slice(0, 2);

    if (id) {
      part += `#${id}`;
    } else if (classes.length > 0) {
      part += '.' + classes.join('.');
    }

    domPath.unshift(part);
    current = current.parent();

    if (domPath.length > 6) break;
  }

  // Neighbors (zjednodušené - len parent a siblings)
  const parentText = $el.parent().text().trim().slice(0, 50);
  const prevText = $el.prev().text().trim().slice(0, 50) || null;
  const nextText = $el.next().text().trim().slice(0, 50) || null;

  return {
    relativePosition: { x: 0.5, y: 0.5 }, // Nemáme pozíciu z Cheerio
    dimensions: { width: 100, height: 30 }, // Default
    styles: {
      backgroundColor: 'transparent',
      color: 'inherit',
      fontSize: 16,
      fontWeight: 'normal',
      fontFamily: 'inherit',
      borderRadius: 0,
      display: 'inline',
    },
    textPattern: generateTextPattern(text),
    textSnapshot: text,
    domPath,
    neighbors: {
      above: null,
      below: nextText,
      left: prevText,
      right: null,
      parent: parentText,
    },
    tagName: $el[0].tagName?.toLowerCase() || 'span',
    semanticAttributes: {
      role: $el.attr('role'),
      ariaLabel: $el.attr('aria-label'),
      dataTestId: $el.attr('data-testid') || $el.attr('data-test-id'),
      name: $el.attr('name'),
      type: $el.attr('type'),
    },
  };
}

/**
 * Generuj unikátny CSS selektor pre element
 */
function generateUniqueSelector($: cheerio.CheerioAPI, $el: cheerio.Cheerio): string {
  // Skús ID
  const id = $el.attr('id');
  if (id) {
    return `#${CSS.escape(id)}`;
  }

  // Skús data-testid
  const testId = $el.attr('data-testid') || $el.attr('data-test-id');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Build path
  const path: string[] = [];
  let current = $el;

  while (current.length && current[0].tagName && current[0].tagName !== 'html') {
    const tag = current[0].tagName.toLowerCase();
    let part = tag;

    const classes = (current.attr('class') || '').split(/\s+/)
      .filter(cls =>
        cls &&
        !cls.match(/^[a-z]{2,3}-[a-z0-9]+$/i) &&
        !cls.match(/^[a-z]{1,2}\d+/i)
      )
      .slice(0, 2);

    if (classes.length > 0) {
      part += '.' + classes.map(c => CSS.escape(c)).join('.');
    }

    // nth-child ak potrebné
    const siblings = current.parent().children(tag);
    if (siblings.length > 1) {
      const index = siblings.index(current) + 1;
      part += `:nth-child(${index})`;
    }

    path.unshift(part);
    current = current.parent();

    // Skús či je unikátny
    if (path.length >= 2) {
      const selector = path.join(' > ');
      try {
        if ($(selector).length === 1) {
          return selector;
        }
      } catch {
        // Invalid selector
      }
    }

    if (path.length > 5) break;
  }

  return path.join(' > ');
}

// CSS.escape polyfill pre Node.js
if (typeof CSS === 'undefined' || !CSS.escape) {
  (globalThis as any).CSS = {
    escape: (str: string) => str.replace(/([^\w-])/g, '\\$1'),
  };
}
```

**Step 3: Run test**

```bash
pnpm --filter @sentinel/extractor test -- matcher.test.ts
```

**Step 4: Update index.ts a commit**

```typescript
// packages/extractor/src/visual-matcher/index.ts
export * from './types';
export * from './text-pattern';
export * from './scoring';
export * from './matcher';
```

```bash
git add packages/extractor/src/visual-matcher/
git commit -m "feat(extractor): add visual matcher for finding elements by fingerprint"
```

---

## Task 6: Integrovať do worker run.processor.ts

**Files:**
- Modify: `apps/worker/src/processors/run.processor.ts`

**Step 1: Pridať import**

Na začiatok súboru pridať:

```typescript
import { findElementByVisualFingerprint } from '@sentinel/extractor/visual-matcher';
```

**Step 2: Rozšíriť auto-healing logiku**

V `run.processor.ts`, po existujúcej auto-healing logike (okolo riadku 344), pridať visual matching ako fallback:

```typescript
// Po riadku ~344 (po "for loop" s alternativeSelectors)

// Visual fingerprint fallback - ak CSS selektory zlyhali
if (!extractResult.success && rule.selectorFingerprint) {
  const fingerprint = rule.selectorFingerprint as {
    alternativeSelectors?: string[];
    textAnchor?: string;
    visualFingerprint?: any;
  };

  if (fingerprint.visualFingerprint && fetchResult.html) {
    this.logger.log(
      `[Job ${job.id}] CSS selectors failed, trying visual fingerprint matching`,
    );

    try {
      const visualMatch = findElementByVisualFingerprint(
        fetchResult.html,
        fingerprint.visualFingerprint,
        { minConfidence: 0.7, maxCandidates: 50, weights: {
          position: 0.15,
          dimensions: 0.10,
          styles: 0.15,
          textPattern: 0.30,
          neighbors: 0.15,
          domPath: 0.15,
        }},
      );

      if (visualMatch.found && visualMatch.selector) {
        this.logger.log(
          `[Job ${job.id}] Visual match found: ${visualMatch.selector} (confidence: ${(visualMatch.confidence * 100).toFixed(0)}%)`,
        );

        // Skús extrahovať s novým selektorom
        const visualConfig = { ...extraction, selector: visualMatch.selector };
        const visualResult = extract(fetchResult.html, visualConfig);

        if (visualResult.success) {
          extractResult = visualResult;
          selectorHealed = true;
          healedSelector = visualMatch.selector;

          this.logger.log(
            `[Job ${job.id}] Visual auto-heal SUCCESS! New selector: ${visualMatch.selector}`,
          );

          // Ulož nový selektor
          try {
            const newExtraction = { ...extraction, selector: visualMatch.selector };
            await this.prisma.rule.update({
              where: { id: ruleId },
              data: {
                extraction: newExtraction as any,
                lastErrorCode: null,
                lastErrorAt: null,
              },
            });
          } catch (updateError) {
            this.logger.warn(
              `[Job ${job.id}] Failed to persist visual-healed selector: ${updateError}`,
            );
          }
        }
      } else {
        this.logger.debug(
          `[Job ${job.id}] Visual match not found (best confidence: ${(visualMatch.confidence * 100).toFixed(0)}%, evaluated: ${visualMatch.candidatesEvaluated})`,
        );
      }
    } catch (visualError) {
      this.logger.warn(
        `[Job ${job.id}] Visual matching error: ${visualError}`,
      );
    }
  }
}
```

**Step 3: Commit**

```bash
git add apps/worker/src/processors/run.processor.ts
git commit -m "feat(worker): integrate visual fingerprint auto-healing"
```

---

## Task 7: Aktualizovať extractor package exports

**Files:**
- Modify: `packages/extractor/src/index.ts`
- Modify: `packages/extractor/package.json`

**Step 1: Pridať export do index.ts**

```typescript
// packages/extractor/src/index.ts - na koniec
export * from './visual-matcher';
```

**Step 2: Pridať subpath export do package.json**

V `packages/extractor/package.json`, v sekcii `exports` pridať:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./visual-matcher": {
      "import": "./dist/visual-matcher/index.js",
      "types": "./dist/visual-matcher/index.d.ts"
    }
  }
}
```

**Step 3: Build a commit**

```bash
pnpm --filter @sentinel/extractor build
git add packages/extractor/
git commit -m "feat(extractor): export visual-matcher module"
```

---

## Task 8: Database migration pre rozšírený fingerprint

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`
- Create: migration

**Step 1: Overiť že selectorFingerprint je už Json**

Súčasná schema má:
```prisma
selectorFingerprint Json? @map("selector_fingerprint")
```

Toto je dostatočné - Json pole môže obsahovať ľubovoľnú štruktúru vrátane visualFingerprint.

**Step 2: Commit poznámku**

```bash
git commit --allow-empty -m "docs: selectorFingerprint already supports visualFingerprint (Json type)"
```

---

## Task 9: Validácia pri vytváraní pravidla (API)

**Files:**
- Modify: `apps/api/src/rules/rules.service.ts`

**Step 1: Nájsť createRule metódu a pridať validáciu**

V `rules.service.ts`, v `createRule` metóde, pred uložením pridať validáciu:

```typescript
// Validácia: ak fingerprint nemá textSnapshot alebo je prázdny, warning
if (dto.selectorFingerprint) {
  const fp = dto.selectorFingerprint as any;

  // Varovanie pre SVG elementy
  if (fp.visualFingerprint?.tagName === 'path' ||
      fp.visualFingerprint?.tagName === 'svg' ||
      fp.visualFingerprint?.tagName === 'g') {
    this.logger.warn(
      `Rule ${dto.name}: SVG element selected - may not contain extractable text`,
    );
  }

  // Varovanie pre prázdny text
  if (!fp.textAnchor && !fp.visualFingerprint?.textSnapshot) {
    this.logger.warn(
      `Rule ${dto.name}: No text anchor - auto-healing may be limited`,
    );
  }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/rules/rules.service.ts
git commit -m "feat(api): add validation warnings for selector fingerprint"
```

---

## Task 10: Build, test a deploy

**Step 1: Build všetko**

```bash
cd /Users/marianfabian/Projects/sentinel
pnpm build
```

**Step 2: Run testy**

```bash
pnpm test
```

**Step 3: Deploy na server**

```bash
ssh root@135.181.99.192 "cd /root/sentinel && git pull && pnpm install && pnpm build && systemctl restart sentinel-worker sentinel-api"
```

**Step 4: Rebuild extension**

```bash
pnpm --filter @sentinel/extension build
```

**Step 5: Final commit**

```bash
git add .
git commit -m "feat: complete visual fingerprint auto-healing system

- Add VisualFingerprint types and text pattern generator
- Implement scoring algorithm for visual matching
- Extend extension to capture visual fingerprint (position, styles, neighbors)
- Add visual matcher module to extractor package
- Integrate visual auto-healing into worker
- Add validation warnings for SVG elements

🤖 Generated with Claude Code"
```

---

## Zhrnutie

Po implementácii:

1. **Extension** zachytí vizuálny fingerprint (pozícia, štýly, susedia, text pattern)
2. **Worker** pri zlyhavaní selektora:
   - Najprv skúsi alternatívne CSS selektory
   - Potom použije visual matcher na nájdenie podobného elementu
3. **Visual matcher** používa weighted scoring:
   - 30% text pattern (najdôležitejšie)
   - 15% pozícia, štýly, susedia, DOM path
   - 10% rozmery
4. **Auto-healing** automaticky opraví selektor ak nájde match s >70% confidence

**Výhody:**
- Funguje aj keď sa zmenia CSS classes
- Funguje aj keď sa element mierne posunie
- Prioritizuje text pattern (cena ostáva cenou)
- Anchor points (susedia) pomáhajú identifikovať správny element

---

**Plan complete and saved to `docs/plans/2025-12-29-visual-fingerprint-auto-healing.md`.**

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
