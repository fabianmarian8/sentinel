# M2-006: Alert Deduplication - Test Scenarios

## Scenario 1: Basic Deduplication

**Setup:**
- Rule: Monitor product price
- Alert policy: cooldownSeconds = 0 (disabled)
- Workspace timezone: "Europe/Bratislava"

**Test Steps:**
1. Price changes from €100 to €90
2. Condition `price_below: 95` triggers
3. Alert created with dedupeKey = `hash(rule-1:cond-1:€90:2025-12-27)`
4. Same price detected again 10 minutes later
5. Same dedupe key generated
6. Alert suppressed: "Duplicate alert exists (id: alert-123, age: 600s)"

**Expected:** Only 1 alert sent

## Scenario 2: Cooldown Period

**Setup:**
- Rule: Monitor availability
- Alert policy: cooldownSeconds = 3600 (1 hour)
- Workspace timezone: "UTC"

**Test Steps:**
1. Availability changes to "out_of_stock"
2. Condition `availability_is: out_of_stock` triggers
3. Alert created at 10:00
4. Availability changes to "in_stock" at 10:30
5. Availability changes back to "out_of_stock" at 10:45
6. New condition triggered, different dedupe key (different value)
7. Cooldown check: last alert was 45 minutes ago
8. Alert suppressed: "Cooldown active (900s remaining, last: alert-456)"

**Expected:** Only 1 alert sent (at 10:00)

## Scenario 3: Cooldown Expired

**Setup:**
- Rule: Monitor text changes
- Alert policy: cooldownSeconds = 1800 (30 minutes)

**Test Steps:**
1. Text changes at 10:00 → Alert sent
2. Text changes at 10:35 (35 minutes later)
3. Different dedupe key (different text)
4. Cooldown check: last alert was 35 minutes ago (> 30 minutes)
5. Alert allowed and sent

**Expected:** 2 alerts sent

## Scenario 4: Day Boundary Reset

**Setup:**
- Rule: Monitor price
- Alert policy: cooldownSeconds = 0
- Workspace timezone: "America/New_York"

**Test Steps:**
1. Price = €50 on 2025-12-27 at 23:00 EST
2. Alert sent, dedupeKey includes day = "2025-12-27"
3. Same price at 00:30 EST on 2025-12-28
4. New dedupeKey with day = "2025-12-28"
5. Alert allowed and sent

**Expected:** 2 alerts sent (one per day)

## Scenario 5: Multiple Conditions

**Setup:**
- Rule: Monitor price with 2 conditions
- Conditions:
  - cond-1: `price_below: 90`
  - cond-2: `price_drop_percent: 10`
- Alert policy: cooldownSeconds = 0

**Test Steps:**
1. Price drops from €100 to €80
2. Both conditions trigger
3. dedupeKey = `hash(rule-1:cond-1,cond-2:€80:2025-12-27)`
4. Alert sent
5. Price drops to €75
6. Both conditions still triggered
7. New dedupeKey = `hash(rule-1:cond-1,cond-2:€75:2025-12-27)`
8. Alert allowed (different value)

**Expected:** 2 alerts sent

## Scenario 6: Timezone Handling

**Setup:**
- Rule in workspace with timezone "Asia/Tokyo"
- Current time: 2025-12-27 23:30 UTC
- Tokyo time: 2025-12-28 08:30 JST

**Test Steps:**
1. Alert triggered at 23:30 UTC
2. Day bucket calculated in Tokyo timezone = "2025-12-28"
3. dedupeKey uses "2025-12-28"
4. Alert sent
5. Alert triggered at 00:30 UTC (still 2025-12-28 in Tokyo)
6. Same day bucket = "2025-12-28"
7. Same dedupeKey
8. Alert suppressed

**Expected:** 1 alert sent

## Scenario 7: Invalid Timezone Fallback

**Setup:**
- Rule in workspace with invalid timezone "Invalid/Timezone"

**Test Steps:**
1. Alert triggered
2. Day bucket calculation fails
3. Falls back to UTC
4. Warning logged: "Invalid timezone 'Invalid/Timezone', falling back to UTC"
5. Alert sent successfully with UTC day bucket

**Expected:** 1 alert sent, warning in logs

## Scenario 8: Race Condition Protection

**Setup:**
- 2 workers processing same rule simultaneously
- Database has unique constraint on dedupeKey

**Test Steps:**
1. Worker A generates dedupeKey = "abc123"
2. Worker B generates same dedupeKey = "abc123"
3. Worker A checks: no existing alert → allowed
4. Worker B checks: no existing alert → allowed
5. Worker A creates alert with dedupeKey = "abc123"
6. Worker B tries to create alert with dedupeKey = "abc123"
7. Database constraint violation
8. Worker B's insert fails gracefully

**Expected:** Only 1 alert created (database enforced)

## Scenario 9: Complex Value Hashing

**Setup:**
- Rule: Monitor JSON field
- Value: `{ products: [{ id: 1, price: 99 }, { id: 2, price: 149 }] }`

**Test Steps:**
1. Complex object extracted
2. JSON.stringify() produces stable string
3. SHA256 hash: first 16 chars = "a3f2b8c1d4e5f6g7"
4. dedupeKey includes this hash
5. Same object extracted later
6. Same JSON string → same hash
7. Same dedupeKey → suppressed

**Expected:** Stable hashing for complex objects

## Scenario 10: Condition Order Independence

**Setup:**
- Rule with conditions: ["cond-2", "cond-3", "cond-1"]

**Test Steps:**
1. Conditions evaluated, triggered in order: [cond-2, cond-3, cond-1]
2. Condition IDs sorted: ["cond-1", "cond-2", "cond-3"]
3. dedupeKey uses sorted order
4. Different evaluation produces: [cond-1, cond-3, cond-2]
5. Condition IDs sorted: ["cond-1", "cond-2", "cond-3"]
6. Same dedupeKey → suppressed

**Expected:** Order-independent deduplication

## Performance Test

**Setup:**
- 1000 alerts per minute
- 50 unique rules
- Average 2 conditions per rule

**Expected Performance:**
- < 5ms per dedupe check
- < 50ms per alert creation
- Database indexes used efficiently
- No memory leaks
- < 1% duplicate alerts in database

## Edge Cases

### Empty Conditions Array
```typescript
conditionIds = []
dedupeKey = hash(rule-1::value-hash:2025-12-27)
// Works correctly
```

### Null/Undefined Values
```typescript
value = null
valueHash = hash("null")
// Handled gracefully
```

### Very Long Strings
```typescript
value = { text: "A".repeat(100000) }
valueHash = hash(longString).substring(0, 16)
// Only hash stored, not full value
```

### Cooldown = 0
```typescript
cooldownSeconds = 0
// Skip cooldown check entirely (optimization)
```

### Future Date Alert
```typescript
// System clock error
dayBucket = "2025-12-30"
// Still works, just unusual dedupe key
```

## Monitoring Metrics

Suggested metrics to track:
1. Alert suppression rate (%)
2. Dedupe key collisions
3. Cooldown suppressions vs dedupe suppressions
4. Average time between alerts per rule
5. Daily alert count per rule
6. Timezone calculation failures
