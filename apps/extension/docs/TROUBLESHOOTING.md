# Sentinel Extension - Troubleshooting Guide

Kompletná príručka riešenia problémov s Chrome rozšírením Sentinel.

**Posledná aktualizácia:** 29. december 2025

---

## Obsah

1. [Badge notifikácie](#1-badge-notifikácie)
2. [CSS Selektory](#2-css-selektory)
3. [Service Worker (Manifest V3)](#3-service-worker-manifest-v3)
4. [Element Picker](#4-element-picker)
5. [API komunikácia](#5-api-komunikácia)
6. [Screenshots](#6-screenshots)
7. [Worker - Extrakcia a Alerty](#7-worker---extrakcia-a-alerty)

---

## 1. Badge notifikácie

### 1.1 Badge sa nezobrazuje vôbec

**Príznaky:**
- Žiadne červené číslo pri ikone rozšírenia
- Aj keď sú v dashboarde viditeľné alerty

**Príčina:** Manifest V3 service worker lifecycle - Chrome môže kedykoľvek ukončiť service worker, a `onInstalled`/`onStartup` listenery sa potom nevolajú pri "wake-up".

**Riešenie:**
V `background/index.ts` musí byť top-level inicializácia:

```typescript
// Na konci súboru - spustí sa VŽDY pri štarte service workera
(async () => {
  const existingAlarm = await chrome.alarms.get(ALERT_POLL_ALARM);
  if (!existingAlarm) {
    chrome.alarms.create(ALERT_POLL_ALARM, {
      periodInMinutes: 1,  // Chrome minimum
    });
  }
  await updateAlertBadge();
})();
```

**Poznámka:** Chrome vynucuje minimum 1 minúta pre `chrome.alarms`. Kratšie intervaly sú automaticky zaokrúhlené.

---

### 1.2 Badge ukazuje menej alertov ako by mal

**Príznaky:**
- Badge ukazuje menšie číslo ako počet otvorených alertov v dashboarde
- Číslo sa "stratí" po chvíli

**Príčina (historická - december 2025):**
Pôvodná logika filtrovala alerty podľa `lastSeenAlertTime` - ukazovala len "nové od posledného otvorenia popup".

**Stav pred fixom:**
```typescript
// PROBLÉM: Filtrovalo len "nové" alerty
const newAlerts = response.alerts.filter(
  a => new Date(a.triggeredAt) > lastSeenDate
);
return newAlerts.length;
```

**Fix:**
```typescript
// Teraz vracia VŠETKY otvorené alerty
return response?.count || 0;
```

---

### 1.3 Badge sa nevynuluje po otvorení popup

**Príznaky:**
- Po otvorení popup badge stále ukazuje číslo
- Badge sa rýchlo vráti na pôvodné číslo

**Príčina:** `clearBadge()` nastavil `lastSeenAlertTime`, ale polling ignoroval tento čas a znova načítal všetky alerty.

**Fix (december 2025):**
Pridaný `&since=lastSeenTime` filter do API requestu:

```typescript
async function fetchUnreadAlertsCount(): Promise<number> {
  const storage = await chrome.storage.local.get(['lastSeenAlertTime']);
  const lastSeenTime = storage.lastSeenAlertTime;

  let url = `/alerts?workspaceId=${id}&status=open&limit=100`;

  // Filtrovať len alerty od posledného otvorenia popup
  if (lastSeenTime) {
    url += `&since=${encodeURIComponent(lastSeenTime)}`;
  }

  const response = await apiRequest(url);
  return response?.count || 0;
}
```

**Logika po fixe:**
1. Otvoríš popup → `lastSeenAlertTime = now` → badge = 0
2. Polling každú minútu → fetch alerts `since=lastSeenTime`
3. Ak žiadne nové alerty od posledného otvorenia → badge zostane 0
4. Ak príde nový alert → badge ukáže počet nových

---

### 1.4 Badge počíta alerty kde sa hodnota nezmenila

**Príznaky:**
- Badge ukazuje vysoké číslo
- V dashboarde sú alerty pre pravidlá kde sa hodnota nezmenila

**Príčina:** Toto je vlastne očakávané správanie - alert sa vytvára keď sa hodnota ZMENÍ. Ak vidíš staré alerty, znamená to že:
1. Alerty neboli nikdy acknowledged/resolved
2. Alebo boli acknowledged ale opäť sa hodnota zmenila

**Riešenie:**
- Manuálne acknowledge/resolve staré alerty v dashboarde
- Alebo použiť SQL:

```sql
-- Resolve všetky staré alerty
UPDATE alerts
SET status = 'resolved', resolved_at = NOW()
WHERE status = 'open'
  AND triggered_at < NOW() - INTERVAL '7 days';
```

---

## 2. CSS Selektory

### 2.1 SELECTOR_BROKEN - CSS-in-JS hash triedy

**Príznaky:**
- `SELECTOR_BROKEN` chyba v dashboarde
- Selektor obsahuje triedy ako `css-xyz123`, `sc-abc`, `nds-text`, `MuiButton-root-5`

**Príčina:** Stránky používajúce CSS-in-JS (Emotion, Styled Components, MUI, Nike Design System) generujú triedy ktoré sa menia pri každom builde.

**Riešenie (implementované december 2025):**
Extension používa `@medv/finder` s blacklistom nestabilných vzorov:

```typescript
const CSS_IN_JS_PATTERNS = [
  /^css-[a-z0-9]{4,}$/i,           // Emotion: css-1abc23
  /^sc-[a-z0-9-]+$/i,              // Styled Components: sc-abc123-0
  /^styled-[a-z0-9]+$/i,           // styled-jsx
  /^nds-[a-z0-9-]+$/i,             // Nike Design System: nds-text
  /^Mui[A-Z][a-zA-Z]+-[a-z]+-\d+$/, // MUI: MuiButton-root-123
  /^jss\d+$/i,                     // JSS: jss123
  /^_[a-z0-9]{5,}$/i,              // Underscore hash: _abc123
  /^[a-z]{1,3}[0-9]{3,}$/i,        // Short prefix + numbers: a123
  /^\d/,                           // Starts with number
  /^[a-f0-9]{6,}$/i,               // Pure hex hash
];
```

**Pre existujúce pravidlá - manuálna oprava:**

```sql
-- 1. Nájdi pravidlo s hash triedami
SELECT id, name, extraction->>'selector' as selector
FROM rules
WHERE extraction->>'selector' ~ 'css-[a-z0-9]{4,}|nds-|sc-';

-- 2. Oprav selektor (príklad pre nike.com)
UPDATE rules
SET extraction = jsonb_set(extraction, '{selector}', '"a[href*=\"sale\"]"'::jsonb),
    last_error_code = NULL
WHERE id = 'RULE_ID_HERE';
```

---

### 2.2 SELECTOR_BROKEN - SVG elementy

**Príznaky:**
- `SELECTOR_BROKEN` chyba
- Selektor obsahuje `g >`, `path`, `svg`, `:nth-child` pre SVG
- `Current Value: No data`

**Príčina:** SVG elementy (`<path>`, `<g>`, `<svg>`) nemajú textový obsah - `textContent` vráti prázdny string.

**Riešenie:**
SVG elementy nemožno monitorovať pre text. Extension teraz zobrazuje warning v console:

```typescript
if (isSvgElement(element)) {
  console.warn('Sentinel: Selected SVG element may not have stable text content');
}
```

**Pre existujúce pravidlá:**
```sql
-- Nájdi pravidlá so SVG selektormi
SELECT id, name, extraction->>'selector' as selector
FROM rules
WHERE extraction->>'selector' ~ '^g |^path|^svg|:nth-child.*path';

-- Tieto pravidlá treba manuálne opraviť alebo zmazať
DELETE FROM rules WHERE id = 'RULE_ID_WITH_SVG_SELECTOR';
```

---

### 2.3 Selektor matchuje nesprávny element

**Príznaky:**
- Selektor je príliš generický
- Matchuje iný element ako bol pôvodne vybraný
- Príklad: `a.menu-link` matchuje "New" namiesto "Sale"

**Príčina:** Generovaný selektor neobsahuje dostatočne unikátne atribúty.

**Riešenie:**
Použiť atribúty pre unikátnosť:

```sql
-- Príklad: nike.com menu link
-- Namiesto: a.menu-hover-trigger-link (matchuje všetky)
-- Použiť:   a.menu-hover-trigger-link[href*="sale"] (matchuje len Sale)

UPDATE rules
SET extraction = jsonb_set(extraction, '{selector}', '"a.menu-link[href*=\"sale\"]"'::jsonb)
WHERE id = 'RULE_ID';
```

**Stratégie pre unikátne selektory:**
1. `[href*="keyword"]` - pre linky
2. `[data-testid="value"]` - pre React/test atribúty
3. `[aria-label="value"]` - pre accessibility atribúty
4. `:contains("text")` - XPath alternatíva (nie CSS)

---

### 2.4 nth-child selektory zlyhávajú

**Príznaky:**
- Selektor obsahuje `:nth-child(X)`
- Po zmene layoutu stránky prestane fungovať

**Príčina:** `nth-child` je pozičný selektor - ak sa poradie elementov zmení, selektor zlyhá.

**Riešenie:**
Extension sa snaží vyhnúť `nth-child`, ale ak je to jediná možnosť:

```typescript
// Fallback generátor používa nth-child len keď je viac rovnakých siblings
const siblings = Array.from(parent.children).filter(
  child => child.tagName === current!.tagName
);
if (siblings.length > 1) {
  const index = siblings.indexOf(current) + 1;
  selector += `:nth-child(${index})`;
}
```

**Odporúčanie:** Vybrať element s unikátnejšími atribútmi (ID, data-*, aria-*).

---

## 3. Service Worker (Manifest V3)

### 3.1 Service worker sa neaktivuje

**Príznaky:**
- Badge nefunguje
- Element picker nereaguje
- V `chrome://extensions` → Inspect → Console žiadne logy

**Diagnóza:**
```
1. Otvor chrome://extensions
2. Nájdi Sentinel
3. Klikni "service worker" link
4. Skontroluj Console pre chyby
```

**Časté príčiny:**
- Import chýba `export {}` na konci súboru
- Syntaktická chyba v TypeScript
- Chýbajúce dependencies

**Riešenie:**
```bash
cd apps/extension
pnpm build
# Potom v Chrome: Reload rozšírenie
```

---

### 3.2 Polling prestane fungovať po čase

**Príznaky:**
- Badge funguje po štarte, potom prestane
- V logoch: "Sentinel: Alarm not found, creating..."

**Príčina:** Chrome môže ukončiť service worker a alarm sa nezachová.

**Riešenie:**
Top-level inicializácia (už implementované):

```typescript
(async () => {
  const existingAlarm = await chrome.alarms.get(ALERT_POLL_ALARM);
  if (!existingAlarm) {
    console.log('Sentinel: Alarm not found, creating...');
    chrome.alarms.create(ALERT_POLL_ALARM, {
      periodInMinutes: 1,
    });
  }
  await updateAlertBadge();
})();
```

---

### 3.3 Service worker crashes

**Príznaky:**
- Rozšírenie kompletne nefunguje
- V Console: `Service worker registration failed`

**Diagnóza:**
```
chrome://extensions → Sentinel → Errors
```

**Časté príčiny:**
1. **Uncaught exception** - chýba try/catch
2. **Async without await** - promise rejection
3. **Missing permissions** - manifest.json

**Riešenie:**
```typescript
// Vždy wrap async operácie
try {
  await someAsyncOperation();
} catch (error) {
  console.error('Operation failed:', error);
}
```

---

## 4. Element Picker

### 4.1 Element picker sa nespustí

**Príznaky:**
- Kliknutie na "Pick Element" nič nerobí
- Kurzor sa nezmení na crosshair

**Diagnóza:**
```
1. Otvor DevTools na stránke (F12)
2. Console → skontroluj chyby
3. Hľadaj: "Sentinel content script loaded"
```

**Časté príčiny:**
1. **Content script neinjektovaný** - stránka nie je v `matches` v manifest.json
2. **CSP blokuje** - stránka má striktný Content-Security-Policy
3. **Chrome internal page** - `chrome://`, `chrome-extension://` pages

**Riešenie pre CSP:**
Niektoré stránky (napr. GitHub) blokujú inline skripty. Toto je limitácia Chrome extensions.

---

### 4.2 Picker vyberie nesprávny element

**Príznaky:**
- Klikneš na text, ale vyberie sa parent kontajner
- Alebo vyberie sa child element (napr. `<span>` namiesto `<a>`)

**Príčina:** Event bubbling - `event.target` môže byť vnorený element.

**Riešenie v kóde:**
```typescript
function handleClick(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();

  const target = event.target as Element;
  // ... rest of handler
}
```

**Tip pre používateľov:** Použiť right-click → "Monitor this element with Sentinel" pre presnejší výber textu.

---

### 4.3 Picker nezachytáva dynamický obsah

**Príznaky:**
- Element sa načíta až po scrolle/interakcii
- Picker ho nevidí

**Príčina:** Content script beží pri načítaní stránky, dynamický obsah sa pridáva neskôr.

**Riešenie:**
Picker funguje na aktuálnom DOM - počkaj kým sa element načíta, potom klikni.

---

## 5. API komunikácia

### 5.1 "Session expired" - opakované odhlasovanie

**Príznaky:**
- Badge zmizne
- V popup: "Please log in"
- Musíš sa znova prihlásiť

**Príčina:** JWT token expiroval alebo bol invalidovaný (napr. zmena JWT_SECRET na serveri).

**Diagnóza:**
```typescript
// V background/index.ts
catch (error) {
  if (error instanceof Error && error.message === 'Session expired') {
    // Token bol automaticky vymazaný
    return 0;
  }
}
```

**Riešenie:**
1. Znova sa prihlásiť cez popup
2. Ak sa opakuje: skontrolovať JWT_SECRET na serveri (nesmie sa meniť!)

---

### 5.2 "Could not connect to API"

**Príznaky:**
- Popup zobrazuje chybu pripojenia
- Badge nefunguje

**Diagnóza:**
```bash
# Skontroluj či API beží
curl https://sentinel.taxinearme.sk/api/health
```

**Časté príčiny:**
1. API server je down
2. CORS problém
3. Sieťový problém

**Riešenie:**
```bash
# Na serveri
systemctl status sentinel-api
systemctl restart sentinel-api
```

---

### 5.3 Workspace sa nenačíta

**Príznaky:**
- Po prihlásení popup zobrazuje prázdny zoznam
- Badge ukazuje 0 aj keď sú alerty

**Príčina:** User nemá pridelený workspace.

**Diagnóza:**
```sql
-- Skontroluj workspace membership
SELECT u.email, w.name
FROM users u
LEFT JOIN workspace_members wm ON u.id = wm.user_id
LEFT JOIN workspaces w ON wm.workspace_id = w.id
WHERE u.email = 'user@example.com';
```

---

## 6. Screenshots

### 6.1 Screenshot sa neuloží

**Príznaky:**
- V dashboarde chýba screenshot
- V logoch: `S3 storage not configured`

**Príčina:** Worker nemá S3 konfiguráciu.

**Riešenie:**
Pozri `docs/OPERATIONS.md` → "Screenshots sa neukladajú"

---

### 6.2 Screenshot ukazuje celú stránku namiesto elementu

**Príznaky:**
- Screenshot obsahuje celú stránku
- Element nie je viditeľný/highlighted

**Príčina:** Element screenshot zlyhalo, worker použil fullpage fallback.

**Možné príčiny:**
1. Element sa nenašiel (selektor zlyhalo)
2. Element je mimo viewport
3. Cookie banner prekrýva element

---

### 6.3 Cookie banner na screenshote

**Príznaky:**
- Screenshot obsahuje cookie banner overlay
- Element je prekrytý

**Riešenie (implementované december 2025):**
Worker automaticky kliká na cookie "Accept" tlačidlá a skrýva bannery:

```typescript
const COOKIE_BANNER_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '[data-testid="cookie-accept"]',
  'button[aria-label*="cookie" i][aria-label*="accept" i]',
  // ... ďalšie
];

// Click cookie button with navigation handling
await Promise.race([
  btn.click(),
  page.waitForNavigation({ timeout: 3000 }).catch(() => {}),
]);
```

---

## Rýchla diagnostika

### Checklist pre debugging

```
□ Je rozšírenie enabled v chrome://extensions?
□ Je service worker aktívny? (klikni na "service worker" link)
□ Sú v Console nejaké chyby?
□ Je API dostupné? (curl health endpoint)
□ Je používateľ prihlásený? (skontroluj popup)
□ Má používateľ workspace? (skontroluj DB)
□ Je pravidlo aktívne? (skontroluj dashboard)
□ Je selektor validný? (skontroluj v DevTools)
```

### Užitočné príkazy

```bash
# Rebuild extension
cd apps/extension && pnpm build

# Check extension logs (v Chrome DevTools)
# 1. chrome://extensions
# 2. Sentinel → "service worker" link
# 3. Console tab

# Check API logs
ssh root@135.181.99.192
journalctl -u sentinel-api -f

# Check worker logs
journalctl -u sentinel-worker -f

# Database queries
docker exec -it n8n-postgres-1 psql -U n8n -d sentinel
```

---

## 7. Worker - Extrakcia a Alerty

### 7.1 False alerty z glitch extrakcií

**Príznaky:**
- Alert pre zmenu hodnoty, ale screenshot ukazuje správnu hodnotu
- Hodnota sa "zmenila" len na 1 beh, potom sa vrátila späť
- Napr. cena 413,90 € → 11,90 € → 413,90 € (prostredná hodnota je glitch)

**Príčina:** Playwright headless browser môže zachytiť stránku v prechodnom stave:
- Overlay/popup prekrýva hlavnú cenu a selektor zachytí inú cenu
- Race condition - stránka nie je plne načítaná
- Cookie banner alebo promo element obsahuje podobnú cenu

**Riešenie:**
Default `requireConsecutive` zmenený z 1 na 2 v `run.processor.ts`:

```typescript
// Step 8: Anti-flap check
// Default to 2 consecutive observations to filter out glitch extractions
const requireConsecutive = alertPolicy?.requireConsecutive ?? 2;
```

Teraz musí byť nová hodnota videná **2x po sebe** aby sa potvrdila zmena.

**Manuálna oprava stavu pravidla (ak glitch už nastavil zlú hodnotu):**
```sql
UPDATE rule_state
SET last_stable = '{"value": 41390, "currency": "EUR"}'::jsonb,
    candidate = null,
    candidate_count = 0
WHERE rule_id = '<rule_id>';
```

---

### 7.2 Alert sa nevytvoril pre zmenu hodnoty

**Príznaky:**
- Observation má `change_detected = true`
- Ale alert neexistuje

**Príčina A - Deduplication:** Rovnaká hodnota už bola alertovaná v ten deň.
- Dedupe key = `ruleId + conditionIds + valueHash + dayBucket`
- Napr. Monitor:50 sleduje sekundy (0-59) - hodnoty sa opakujú počas dňa
- Prvý alert pre hodnotu "19" o 14:40 → OK
- Druhý alert pre hodnotu "19" o 17:50 → BLOKOVANÝ (rovnaký dedupe key)

**Príčina B - Anti-flap:** Hodnota nebola potvrdená (requireConsecutive > 1)
- Glitch hodnota sa objavila len 1x, potom sa vrátila späť
- Anti-flap správne nepotvrdil zmenu

**Príčina C - Podmienky alertu:**
- `alertPolicy.conditions` je prázdne alebo chýba
- Podmienka nebola splnená (napr. `value_below` ale hodnota je vyššia)

**Debug:**
```sql
-- Skontroluj observácie a alerty
SELECT
  TO_CHAR(o.created_at, 'HH24:MI:SS') as time,
  o.extracted_normalized,
  o.change_detected,
  (SELECT COUNT(*) FROM alerts a
   WHERE a.rule_id = o.rule_id
   AND a.triggered_at BETWEEN o.created_at - interval '5s' AND o.created_at + interval '5s'
  ) as alert
FROM observations o
WHERE o.rule_id = '<rule_id>'
ORDER BY o.created_at DESC LIMIT 10;
```

---

### 7.3 Extrakcia vracia nesprávnu hodnotu

**Príznaky:**
- Screenshot ukazuje správnu hodnotu
- Ale `extracted_normalized` je iná hodnota

**Príčiny:**
1. **Selektor zachytáva iný element** - doprava, mesačná splátka, stará cena
2. **`textContent()` vs `innerText()`** - textContent zahŕňa skryté elementy
3. **Stránka v prechodnom stave** - overlay, loading, hydration

**Odporúčania od Codex subagenta:**
- Použiť container-scoped selektor (nie globálny)
- Použiť `innerText()` (viditeľný text) namiesto `textContent()`
- Čítať 2x s 250ms medzerou a porovnať
- Validácia rozsahu - odmietnuť nepravdepodobné hodnoty
- Fallback na JSON-LD (`script[type="application/ld+json"]`)

---

## Changelog

| Dátum | Problém | Riešenie |
|-------|---------|----------|
| 2025-12-29 | False alert z glitch extrakcie | Default `requireConsecutive` zmenený na 2 |
| 2025-12-29 | Badge počíta staré alerty | Pridaný `&since=` filter |
| 2025-12-29 | CSS-in-JS hash triedy | Implementovaný `@medv/finder` s blacklistom |
| 2025-12-29 | Cookie banner na screenshote | Navigation handling po cookie click |
| 2025-12-29 | Badge sa nezobrazuje | Top-level inicializácia pre MV3 |
| 2025-12-28 | SVG elementy bez textu | Warning v console, dokumentácia |
| 2025-12-27 | Session expired loop | Graceful handling v apiRequest |

---

*Pre serverové problémy pozri: `docs/OPERATIONS.md`*
*Pre error kódy pozri: `docs/ERROR-TAXONOMY.md`*
