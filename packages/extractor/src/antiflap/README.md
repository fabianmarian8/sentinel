# Anti-Flap State Machine

Prevents false alerts by requiring N consecutive observations of a new value before confirming a change.

## Purpose

When monitoring web content, values can temporarily flicker or "flap" between states. For example:
- A price might temporarily show as "N/A" during page load
- Availability might flicker between "in stock" and "out of stock"
- Text content might change briefly during A/B testing

The anti-flap mechanism ensures that only **persistent** changes trigger alerts.

## How It Works

```
Initial State: value = 100 (stable)

Observation 1: value = 200  → candidate = 200, count = 1  (no alert)
Observation 2: value = 200  → candidate = 200, count = 2  (no alert)
Observation 3: value = 200  → CONFIRMED! stable = 200     (ALERT!)

If value returns to 100 before count reaches threshold:
Observation 1: value = 200  → candidate = 200, count = 1
Observation 2: value = 100  → candidate = null, count = 0  (back to stable, no alert)
```

## Algorithm

1. **First observation** → Set as stable, no change confirmed
2. **Same as current stable** → Reset candidate
3. **Same as current candidate** → Increment count
4. **Count reaches threshold** → Confirm change, promote candidate to stable
5. **Different value** → New candidate, reset count to 1

## Usage

```typescript
import { processAntiFlap, RuleState, AntiFlipResult } from '@sentinel/extractor';

// Initial state (e.g., loaded from database)
let state: RuleState | null = null;

// Process first observation
const { result, newState } = processAntiFlap(
  { value: 99.99, currency: 'USD' },  // Current value
  state,                               // Previous state
  3                                    // Require 3 consecutive observations
);

console.log(result.confirmedChange);  // false (first observation)
console.log(result.newStable);        // { value: 99.99, currency: 'USD' }

// Update state in database
state = { ...state, ...newState } as RuleState;

// Process subsequent observations
const step2 = processAntiFlap(
  { value: 89.99, currency: 'USD' },
  state,
  3
);
console.log(step2.result.candidateCount); // 1
console.log(step2.result.confirmedChange); // false

// Continue until threshold reached...
```

## Value Comparison

The `equals()` function handles different value types intelligently:

### Price Objects
```typescript
// Compares numeric value and currency
equals(
  { value: 99.99, currency: 'USD' },
  { value: 99.99, currency: 'USD' }
) // → true
```

### Availability Objects
```typescript
// Compares status and lead time
equals(
  { status: 'in_stock', leadTimeDays: 0 },
  { status: 'in_stock', leadTimeDays: 0 }
) // → true
```

### Text Objects
```typescript
// Compares hash (ignoring snippet differences)
equals(
  { hash: 'abc123', snippet: 'Some text...' },
  { hash: 'abc123', snippet: 'Different text...' }
) // → true (hash matches)
```

### Generic Values
```typescript
// Fallback: deep JSON comparison
equals({ a: 1, b: 2 }, { a: 1, b: 2 }) // → true
```

## API

### `processAntiFlap(currentValue, state, requireConsecutive)`

**Parameters:**
- `currentValue: any` - The newly observed value
- `state: RuleState | null` - Current rule state (null for first observation)
- `requireConsecutive: number` - Number of consecutive observations required to confirm change

**Returns:**
```typescript
{
  result: AntiFlipResult,
  newState: Partial<RuleState>
}
```

### `AntiFlipResult`

```typescript
interface AntiFlipResult {
  confirmedChange: boolean;      // Whether change has been confirmed
  previousStable: any | null;    // Previous stable value (only when confirmed)
  newStable: any | null;         // New stable value (only when confirmed or first observation)
  candidateValue: any | null;    // Current candidate value (when not confirmed)
  candidateCount: number;        // Current candidate count
}
```

### `RuleState`

```typescript
interface RuleState {
  ruleId: string;
  lastStable: any;               // Last confirmed stable value
  candidate: any | null;         // Current candidate value
  candidateCount: number;        // Consecutive observations of candidate
  updatedAt: Date;
}
```

## Database Integration

The `RuleState` is designed to be stored in the `rule_state` table:

```sql
CREATE TABLE rule_state (
  rule_id TEXT PRIMARY KEY,
  last_stable JSONB NOT NULL,
  candidate JSONB,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

Example usage with database:

```typescript
import { processAntiFlap } from '@sentinel/extractor';
import { db } from './database';

async function checkRule(ruleId: string, currentValue: any, requireConsecutive: number) {
  // Load state from database
  const state = await db.query(
    'SELECT * FROM rule_state WHERE rule_id = $1',
    [ruleId]
  ).then(result => result.rows[0] || null);

  // Process through anti-flap
  const { result, newState } = processAntiFlap(currentValue, state, requireConsecutive);

  // Update state in database
  await db.query(
    `INSERT INTO rule_state (rule_id, last_stable, candidate, candidate_count, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (rule_id) DO UPDATE SET
       last_stable = EXCLUDED.last_stable,
       candidate = EXCLUDED.candidate,
       candidate_count = EXCLUDED.candidate_count,
       updated_at = EXCLUDED.updated_at`,
    [
      ruleId,
      JSON.stringify(newState.lastStable ?? state?.lastStable),
      newState.candidate ? JSON.stringify(newState.candidate) : null,
      newState.candidateCount ?? 0
    ]
  );

  // If change confirmed, trigger alert
  if (result.confirmedChange) {
    await sendAlert({
      ruleId,
      previousValue: result.previousStable,
      newValue: result.newStable
    });
  }
}
```

## Configuration

The `requireConsecutive` parameter controls sensitivity:

- **`1`** - Immediate confirmation (no anti-flap protection)
- **`2`** - Must see value twice to confirm
- **`3`** - Must see value three times (recommended default)
- **`5+`** - Very conservative (use for noisy sources)

## Test Coverage

The module includes comprehensive tests covering:
- First observation behavior
- Stable value detection
- Candidate accumulation
- Change confirmation threshold
- Candidate reset on value change
- Different value types (price, availability, text, generic)
- Edge cases (requireConsecutive=0, flapping scenarios, etc.)

Run tests:
```bash
npm test -- antiflap
```

## Implementation Files

```
src/antiflap/
  ├── antiflap.ts          # Main state machine logic
  ├── equals.ts            # Value comparison utilities
  ├── types.ts             # TypeScript interfaces
  ├── index.ts             # Public exports
  ├── antiflap.test.ts     # State machine tests
  ├── equals.test.ts       # Comparison utility tests
  └── README.md            # This file
```
