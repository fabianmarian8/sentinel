# Rules Module

Komplexný CRUD modul pre správu monitoring pravidiel v Sentinel platforme.

## Štruktúra súborov

```
rules/
├── dto/
│   ├── alert-policy.dto.ts          # Konfigurácia alertov a podmienok
│   ├── create-rule.dto.ts            # DTO pre vytvorenie rule
│   ├── extraction-config.dto.ts      # Konfigurácia extrakcie dát
│   ├── normalization-config.dto.ts   # Konfigurácia normalizácie
│   ├── schedule-config.dto.ts        # Konfigurácia plánovania
│   └── update-rule.dto.ts            # DTO pre update rule
├── rules.controller.ts               # HTTP endpoints
├── rules.service.ts                  # Business logika
├── rules.module.ts                   # NestJS modul
└── README.md                         # Dokumentácia
```

## API Endpoints

### GET /rules?workspaceId=xxx
Získať všetky rules vo workspace.

**Query parametre:**
- `workspaceId` (required) - ID workspace

**Response:**
```json
[
  {
    "id": "clh123...",
    "sourceId": "clh456...",
    "source": {
      "id": "clh456...",
      "url": "https://example.com",
      "domain": "example.com"
    },
    "name": "Monitor product price",
    "ruleType": "price",
    "enabled": true,
    "healthScore": 98.5,
    "lastErrorCode": null,
    "lastErrorAt": null,
    "nextRunAt": "2025-12-27T14:00:00Z",
    "createdAt": "2025-12-27T12:00:00Z",
    "observationCount": 142,
    "currentState": {
      "lastStable": { "value": 99.99, "currency": "EUR" },
      "candidate": null,
      "candidateCount": 0
    }
  }
]
```

### GET /rules?sourceId=xxx
Získať všetky rules pre konkrétny source.

**Query parametre:**
- `sourceId` (required) - ID source

### POST /rules
Vytvoriť nové monitorovacie pravidlo.

**Request body:**
```json
{
  "sourceId": "clh123...",
  "name": "Monitor product price",
  "ruleType": "price",
  "extraction": {
    "method": "css",
    "selector": ".price-value",
    "attribute": "data-price",
    "postProcess": [
      {
        "type": "trim",
        "params": {}
      },
      {
        "type": "extract_number",
        "params": {}
      }
    ]
  },
  "normalization": {
    "type": "price",
    "currency": "EUR",
    "locale": "sk-SK",
    "decimalPlaces": 2
  },
  "schedule": {
    "intervalSeconds": 3600,
    "jitterSeconds": 60
  },
  "alertPolicy": {
    "conditions": [
      {
        "type": "value_decreased",
        "severity": "high",
        "threshold": 10
      }
    ],
    "channels": ["clh789..."],
    "cooldownSeconds": 3600
  },
  "enabled": true
}
```

**Response:**
```json
{
  "id": "clh123...",
  "sourceId": "clh456...",
  "source": {
    "id": "clh456...",
    "url": "https://example.com/product",
    "domain": "example.com",
    "workspace": {
      "id": "clh789...",
      "name": "My Workspace"
    }
  },
  "name": "Monitor product price",
  "ruleType": "price",
  "extraction": { ... },
  "normalization": { ... },
  "schedule": { ... },
  "alertPolicy": { ... },
  "enabled": true,
  "healthScore": 100,
  "lastErrorCode": null,
  "lastErrorAt": null,
  "nextRunAt": "2025-12-27T14:23:45Z",
  "createdAt": "2025-12-27T13:00:00Z",
  "currentState": {
    "lastStable": null,
    "candidate": null,
    "candidateCount": 0
  },
  "latestObservations": []
}
```

### GET /rules/:id
Získať detailné informácie o rule vrátane posledných 5 observations.

**Response:**
```json
{
  "id": "clh123...",
  "sourceId": "clh456...",
  "source": { ... },
  "name": "Monitor product price",
  "ruleType": "price",
  "extraction": { ... },
  "normalization": { ... },
  "schedule": { ... },
  "alertPolicy": { ... },
  "enabled": true,
  "healthScore": 98.5,
  "lastErrorCode": null,
  "lastErrorAt": null,
  "nextRunAt": "2025-12-27T14:00:00Z",
  "createdAt": "2025-12-27T12:00:00Z",
  "currentState": {
    "lastStable": { "value": 99.99, "currency": "EUR" },
    "candidate": null,
    "candidateCount": 0,
    "updatedAt": "2025-12-27T13:45:00Z"
  },
  "latestObservations": [
    {
      "id": "clh999...",
      "extractedRaw": "99,99 €",
      "extractedNormalized": {
        "value": 99.99,
        "currency": "EUR"
      },
      "changeDetected": false,
      "changeKind": null,
      "diffSummary": null,
      "createdAt": "2025-12-27T13:45:00Z",
      "run": {
        "startedAt": "2025-12-27T13:44:55Z",
        "finishedAt": "2025-12-27T13:45:02Z",
        "httpStatus": 200,
        "errorCode": null
      }
    }
  ]
}
```

### PATCH /rules/:id
Aktualizovať existujúce rule.

**Request body:** (všetky polia voliteľné okrem sourceId)
```json
{
  "name": "Updated rule name",
  "enabled": false,
  "schedule": {
    "intervalSeconds": 7200,
    "jitterSeconds": 120
  }
}
```

**Poznámka:** Ak sa aktualizuje `schedule`, automaticky sa prepočíta `nextRunAt`.

### DELETE /rules/:id
Permanentne vymazať rule vrátane všetkých observations a alertov.

**Response:**
```json
{
  "message": "Rule deleted successfully"
}
```

### POST /rules/:id/pause
Pozastaviť rule (nastaví `enabled=false`).

**Response:**
```json
{
  "id": "clh123...",
  "name": "Monitor product price",
  "enabled": false,
  "message": "Rule paused successfully"
}
```

### POST /rules/:id/resume
Obnoviť pozastavené rule (nastaví `enabled=true` a prepočíta `nextRunAt`).

**Response:**
```json
{
  "id": "clh123...",
  "name": "Monitor product price",
  "enabled": true,
  "nextRunAt": "2025-12-27T15:30:45Z",
  "message": "Rule resumed successfully"
}
```

## DTOs

### ExtractionConfigDto

Definuje ako sa majú extrahovať dáta zo stránky.

**Polia:**
- `method`: `'css' | 'xpath' | 'jsonpath' | 'regex'`
- `selector`: CSS selector, XPath výraz, JSONPath alebo regex pattern
- `attribute?`: HTML atribút na extrakciu (napr. `data-price`, `href`)
- `postProcess?`: Array post-procesing krokov
- `extractAll?`: Extrahovať všetky match alebo len prvý

**Post-process typy:**
- `trim` - Odstrániť whitespace
- `lowercase` - Previesť na malé písmená
- `uppercase` - Previesť na veľké písmená
- `replace` - Nahradiť text (params: `pattern`, `replacement`)
- `extract_number` - Extrahovať číselné hodnoty

### NormalizationConfigDto

Definuje normalizáciu extrahovaných dát.

**Polia:**
- `type`: `'price' | 'number' | 'text' | 'boolean' | 'date'`
- `currency?`: Kód meny (napr. `EUR`, `USD`)
- `locale?`: Locale pre parsing (napr. `sk-SK`, `en-US`)
- `unit?`: Jednotka pre čísla (napr. `kg`, `m`)
- `decimalPlaces?`: Počet desatinných miest
- `params?`: Ďalšie custom parametre

### ScheduleConfigDto

Konfigurácia plánovania kontrol.

**Polia:**
- `intervalSeconds`: Interval medzi kontrolami (min 60, max 2592000)
- `jitterSeconds?`: Náhodný posun 0-300 sekúnd (predíde synchronizácii)

**Výpočet nextRunAt:**
```
nextRunAt = now + intervalSeconds + random(0, jitterSeconds)
```

### AlertPolicyDto

Konfigurácia alertov a podmienok.

**Polia:**
- `conditions`: Array alert podmienok
- `channels?`: Array ID notification channels
- `cooldownSeconds?`: Min. čas medzi alertmi (anti-spam)

**Condition typy:**
- `value_changed` - Hodnota sa zmenila
- `value_increased` - Hodnota stúpla
- `value_decreased` - Hodnota klesla
- `value_above` - Hodnota nad threshold
- `value_below` - Hodnota pod threshold
- `value_equals` - Hodnota sa rovná
- `value_not_equals` - Hodnota sa nerovná
- `value_contains` - Obsahuje text
- `value_not_contains` - Neobsahuje text
- `value_disappeared` - Hodnota zmizla
- `value_appeared` - Hodnota sa objavila
- `percentage_change` - Percentuálna zmena

**Severity levels:**
- `low` - Nízka priorita
- `medium` - Stredná priorita
- `high` - Vysoká priorita
- `critical` - Kritická priorita

## Service Methods

### verifyWorkspaceAccess(workspaceId, userId)
Overí, či má používateľ prístup k workspace (owner alebo member).

### verifySourceAccess(sourceId, userId)
Overí, či má používateľ prístup k source cez workspace.

### verifyRuleAccess(ruleId, userId)
Overí, či má používateľ prístup k rule cez source a workspace.

### calculateNextRunAt(schedule)
Vypočíta ďalší čas spustenia na základe schedule config.

```typescript
const intervalMs = schedule.intervalSeconds * 1000;
const jitterMs = schedule.jitterSeconds
  ? Math.random() * schedule.jitterSeconds * 1000
  : 0;
return new Date(Date.now() + intervalMs + jitterMs);
```

### findByWorkspace(workspaceId, userId)
Vráti všetky rules vo workspace s overview informáciami.

### findBySource(sourceId, userId)
Vráti všetky rules pre source.

### create(userId, dto)
Vytvorí nové rule a initial RuleState v transakcii.

**Proces:**
1. Verify source access
2. Calculate initial nextRunAt
3. Create rule
4. Create RuleState (lastStable=null, candidate=null, candidateCount=0)

### findOne(id, userId)
Vráti detailné info o rule vrátane posledných 5 observations.

### update(id, userId, dto)
Aktualizuje rule. Ak sa zmení schedule, prepočíta nextRunAt.

### remove(id, userId)
Vymaže rule (cascade delete state, runs, observations, alerts).

### pause(id, userId)
Pozastaví rule (enabled=false).

### resume(id, userId)
Obnoví rule (enabled=true, recalculate nextRunAt).

## Validácia

Všetky DTOs používajú `class-validator` dekorátory:

- `@IsUUID()` - Validácia UUID formátu
- `@IsString()` - String validácia
- `@MinLength(1)` / `@MaxLength(100)` - Dĺžka stringu
- `@IsEnum(RuleType)` - Enum validácia
- `@IsInt()` / `@IsNumber()` - Číselná validácia
- `@Min(60)` / `@Max(2592000)` - Rozsah hodnôt
- `@IsBoolean()` - Boolean validácia
- `@IsArray()` - Array validácia
- `@ValidateNested()` - Vnorené objekty
- `@Type(() => DTO)` - Class transformer
- `@IsOptional()` - Voliteľné pole

## Security

Všetky endpoints sú chránené:

- `@UseGuards(AuthGuard('jwt'))` - Vyžaduje autentifikáciu
- `@ApiBearerAuth()` - Swagger auth docs
- Access control cez workspace membership:
  - Owner môže všetko
  - Members môžu všetko v rámci workspace
  - Iní používatelia nemajú prístup

## Error Handling

- `ForbiddenException` - Nedostatočné oprávnenia
- `NotFoundException` - Rule/Source/Workspace neexistuje
- `BadRequestException` - Neplatné dáta (validácia)

## Integration

Modul je registrovaný v `AppModule`:

```typescript
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    // ...
    RulesModule,
    // ...
  ],
})
export class AppModule {}
```

## Testing

Basic controller tests sú v `rules.controller.spec.ts`.

Pre spustenie testov:
```bash
npm test -- rules.controller.spec
```

## Príklady použitia

### Vytvorenie price monitoring rule

```bash
curl -X POST http://localhost:3000/rules \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "clh123...",
    "name": "Monitor product price",
    "ruleType": "price",
    "extraction": {
      "method": "css",
      "selector": ".product-price",
      "postProcess": [
        { "type": "trim" },
        { "type": "extract_number" }
      ]
    },
    "normalization": {
      "type": "price",
      "currency": "EUR",
      "locale": "sk-SK",
      "decimalPlaces": 2
    },
    "schedule": {
      "intervalSeconds": 3600,
      "jitterSeconds": 60
    },
    "alertPolicy": {
      "conditions": [
        {
          "type": "value_decreased",
          "severity": "high",
          "threshold": 5
        }
      ]
    }
  }'
```

### Aktualizácia schedule

```bash
curl -X PATCH http://localhost:3000/rules/clh123... \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schedule": {
      "intervalSeconds": 7200,
      "jitterSeconds": 120
    }
  }'
```

### Pozastavenie rule

```bash
curl -X POST http://localhost:3000/rules/clh123.../pause \
  -H "Authorization: Bearer $TOKEN"
```

## Architektúra

```
Client Request
    ↓
RulesController (validation, auth)
    ↓
RulesService (business logic, access control)
    ↓
PrismaService (database operations)
    ↓
PostgreSQL
```

## Database Schema

Rule má nasledujúce relácie:

- `rule` -> `source` (many-to-one)
- `rule` -> `rule_state` (one-to-one)
- `rule` -> `runs` (one-to-many)
- `rule` -> `observations` (one-to-many)
- `rule` -> `alerts` (one-to-many)

Cascade delete: Pri vymazaní rule sa vymažú aj všetky súvisiace záznamy.
