# M2-006: Alert Deduplication - Implementation Summary

## Overview
Implemented alert deduplication service to prevent alert spam using two-level protection:
1. **Dedupe key uniqueness** - Prevents exact duplicate alerts
2. **Cooldown period** - Rate limits alerts for the same rule

## Implementation

### 1. DedupeService (`apps/worker/src/services/dedupe.service.ts`)

#### Key Methods

**`generateDedupeKey()`**
- Generates SHA256 hash from: ruleId + conditionIds + valueHash + dayBucket
- Day bucket uses workspace timezone (YYYY-MM-DD format)
- Condition IDs are sorted for stability
- Value is hashed for privacy and size reduction

**`shouldCreateAlert()`**
- Returns `{ allowed: boolean, reason?: string }`
- First checks dedupe key uniqueness (database constraint)
- Then checks cooldown period if configured
- Returns detailed reason for suppression

**`getDayBucket()`**
- Private helper to get YYYY-MM-DD in workspace timezone
- Falls back to UTC if timezone is invalid
- Uses `toLocaleDateString('en-CA')` for consistent format

### 2. Integration (`apps/worker/src/processors/run.processor.ts`)

#### Changes in `triggerAlerts()` method:
1. Fetch rule with workspace data (needed for timezone)
2. Evaluate alert conditions using ConditionEvaluatorService
3. Generate dedupe key with workspace timezone
4. Check if alert should be created (deduplication + cooldown)
5. Create alert record with dedupeKey
6. Enqueue dispatch job

#### Database Query:
```typescript
const rule = await this.prisma.rule.findUnique({
  where: { id: ruleId },
  include: {
    source: {
      include: {
        fetchProfile: true,
        workspace: true,  // Added for timezone
      },
    },
    state: true,
  },
});
```

### 3. Module Registration (`apps/worker/src/worker.module.ts`)

Added DedupeService to providers and exports:
```typescript
providers: [
  PrismaService,
  QueueService,
  DedupeService,  // Added
  ConditionEvaluatorService,
  AlertGeneratorService,
  RunProcessor,
  AlertProcessor,
],
```

### 4. Tests (`apps/worker/src/services/dedupe.service.spec.ts`)

**Test Coverage (19 tests):**

**generateDedupeKey:**
- ✓ Consistent hash for same inputs
- ✓ Sort condition IDs for stability
- ✓ Different keys for different rules
- ✓ Different keys for different values
- ✓ Different keys for different condition sets
- ✓ Handle empty condition arrays
- ✓ Handle complex nested values
- ✓ Handle invalid timezone gracefully

**shouldCreateAlert - dedupe key check:**
- ✓ Allow if dedupe key does not exist
- ✓ Block if dedupe key exists
- ✓ Include age in seconds for duplicates

**shouldCreateAlert - cooldown check:**
- ✓ Allow if cooldown disabled (0 seconds)
- ✓ Allow if no recent alerts within cooldown
- ✓ Block if within cooldown period
- ✓ Calculate remaining cooldown correctly
- ✓ Allow if cooldown period has passed
- ✓ Use correct cooldown window in query

**shouldCreateAlert - combined checks:**
- ✓ Check dedupe key before cooldown (short-circuit)
- ✓ Check cooldown only if dedupe key passes

## Database Schema

Alert model already has dedupeKey field with unique constraint:
```prisma
model Alert {
  // ...
  dedupeKey    String        @unique @map("dedupe_key")
  // ...
}
```

## Example Flow

1. Price changes from €100 to €90
2. Condition `price_below: 95` is triggered
3. Generate dedupe key:
   - ruleId: `rule-abc123`
   - conditionIds: `["cond-1"]`
   - value: `{ value: 90, currency: "EUR" }`
   - timezone: `"Europe/Bratislava"`
   - dayBucket: `"2025-12-27"`
   - → SHA256 hash: `a3f2b8...`

4. Check dedupe key uniqueness:
   - Query: `SELECT * FROM alerts WHERE dedupe_key = 'a3f2b8...'`
   - Result: null → allowed

5. Check cooldown (e.g., 3600 seconds):
   - Query: `SELECT * FROM alerts WHERE rule_id = 'rule-abc123' AND triggered_at >= NOW() - INTERVAL '3600 seconds'`
   - Result: null → allowed

6. Create alert with dedupeKey
7. Enqueue dispatch job

## Benefits

1. **No duplicate alerts**: Same condition + value + day = blocked
2. **Rate limiting**: Cooldown prevents spam for same rule
3. **Day-based reset**: Dedupe key includes day bucket, allows daily notifications
4. **Timezone-aware**: Uses workspace timezone for day boundaries
5. **Detailed logging**: Reason for suppression is logged
6. **Database-enforced**: Unique constraint on dedupeKey prevents race conditions

## Configuration

Alert policy in rule:
```json
{
  "requireConsecutive": 2,
  "cooldownSeconds": 3600,  // 1 hour
  "conditions": [
    {
      "id": "cond-1",
      "type": "price_below",
      "value": 95,
      "severity": "warning"
    }
  ],
  "channels": ["slack", "email"]
}
```

## Files Created/Modified

### Created:
- `apps/worker/src/services/dedupe.service.ts` (145 lines)
- `apps/worker/src/services/dedupe.service.spec.ts` (390 lines)

### Modified:
- `apps/worker/src/worker.module.ts` (added DedupeService)
- `apps/worker/src/processors/run.processor.ts` (integrated deduplication)
- `packages/shared/src/domain.ts` (fixed ChangeKind type)

## Performance Considerations

- Dedupe key generation: O(1) - simple hashing
- Database queries:
  - 1 unique lookup (indexed)
  - 1 range query with limit 1 (indexed)
- No additional tables needed
- Minimal memory footprint

## Future Enhancements

1. Add metrics for suppression rate
2. Support custom dedupe key TTL
3. Add admin endpoint to view suppressed alerts
4. Support multiple timezone-based day buckets per workspace
