# Alert Condition Evaluation - Implementation Summary

## Overview

Implementation of M2-005: Alert condition evaluation and notification dispatching for Sentinel - Change Intelligence Platform.

## Implemented Components

### 1. ConditionEvaluatorService (`services/condition-evaluator.service.ts`)

Service responsible for evaluating alert conditions against observed values.

**Supported Condition Types:**

| Condition Type | Description | Rule Types |
|----------------|-------------|------------|
| `price_below` | Triggers when price < threshold | price |
| `price_above` | Triggers when price > threshold | price |
| `price_drop_percent` | Triggers when price dropped by X% | price |
| `availability_is` | Triggers when status matches value | availability |
| `text_changed` | Triggers on any text change | text |
| `number_changed` | Triggers on any number change | number |
| `number_below` | Triggers when number < threshold | number |
| `number_above` | Triggers when number > threshold | number |

**Key Methods:**
- `evaluateConditions()` - Main entry point, evaluates all conditions
- `evaluateSingleCondition()` - Evaluates individual condition
- Private methods for each condition type

**Error Handling:**
- Individual condition evaluation errors are logged but don't stop evaluation
- Failed conditions are skipped, successful ones are returned

**Tests:** 9 passing tests in `condition-evaluator.service.spec.ts`

### 2. AlertGeneratorService (`services/alert-generator.service.ts`)

Service responsible for generating alert metadata: titles, bodies, severity, dedupe keys.

**Key Methods:**
- `getHighestSeverity()` - Determines alert severity from triggered conditions
- `generateAlertTitle()` - Creates concise alert title based on condition types
- `generateAlertBody()` - Creates detailed alert message with change info
- `generateDedupeKey()` - Creates SHA-256 hash for deduplication (5-min window)
- `mapSeverityToAlertSeverity()` - Maps Severity to AlertSeverity enum

**Severity Hierarchy:**
1. critical (highest)
2. warning
3. info (lowest)

**Deduplication:**
- Based on: rule ID + condition types + value + 5-minute time window
- Uses SHA-256 hash truncated to 16 chars
- Prevents duplicate alerts for same change

**Tests:** 18 passing tests in `alert-generator.service.spec.ts`

### 3. RunProcessor Updates (`processors/run.processor.ts`)

Enhanced `triggerAlerts()` method with full condition evaluation pipeline:

**Pipeline Steps:**
1. Validate alert policy (channels, conditions)
2. Evaluate conditions using ConditionEvaluatorService
3. Skip if no conditions triggered
4. Calculate highest severity
5. Generate alert title and body
6. Generate dedupe key
7. Check deduplication (skip if duplicate)
8. Create alert record in database
9. Mark dedupe key as used
10. Enqueue alert dispatch job

**Dependencies Added:**
- ConditionEvaluatorService
- AlertGeneratorService
- DedupeService (existing)

### 4. AlertProcessor Updates (`processors/alert.processor.ts`)

Full implementation of notification dispatching:

**Pipeline Steps:**
1. Fetch alert with rule and source info
2. For each notification channel:
   - Fetch channel configuration
   - Validate channel (exists, enabled, correct workspace)
   - Dispatch based on channel type
   - Log result
3. Update alert with delivery status

**Supported Channels:**
- ✅ Email (via @sentinel/notify)
- ⏳ Slack (TODO)
- ⏳ Telegram (TODO)
- ⏳ Webhook (TODO)

**Email Integration:**
- Uses `sendEmailAlert()` from @sentinel/notify
- SMTP config from environment variables
- Supports encrypted channel configuration
- Maps AlertSeverity to email severity format

**Error Handling:**
- Per-channel error logging
- Failed channels logged with error message
- Delivery status stored in alert record
- Failed jobs update alert with error info

### 5. Module Registration (`worker.module.ts`)

Both services registered as providers and exported:

```typescript
providers: [
  // ... existing providers
  ConditionEvaluatorService,
  AlertGeneratorService,
  // ... processors
]
```

## Database Schema Usage

### Alert Table Fields:
- `id` - Unique alert identifier
- `ruleId` - Associated rule
- `triggeredAt` - When alert was triggered
- `severity` - AlertSeverity enum (low/medium/high/critical)
- `title` - Generated alert title
- `body` - Generated alert body (Text)
- `dedupeKey` - Unique dedupe key (unique constraint)
- `channelsSent` - JSON array of delivery results

### AlertPolicy JSON Structure:
```typescript
{
  requireConsecutive: number,      // Anti-flap threshold
  cooldownSeconds: number,         // Cooldown between alerts
  conditions: AlertCondition[],    // Conditions to evaluate
  channels: string[]               // Channel IDs to notify
}
```

### AlertCondition Structure:
```typescript
{
  id: string,                      // Unique condition ID
  type: AlertConditionType,        // Condition type
  value: number | string | boolean,// Threshold/expected value
  severity: Severity               // info/warning/critical
}
```

## Test Coverage

**Total Tests:** 50 passing
- ConditionEvaluatorService: 9 tests
- AlertGeneratorService: 18 tests
- DedupeService: 10 tests (existing)
- QueueService: 13 tests (existing)

**Test Scenarios Covered:**
- Price threshold conditions (below, above, drop percent)
- Availability status matching
- Number threshold conditions
- Multiple condition evaluation
- Severity calculation
- Title/body generation
- Dedupe key consistency
- Severity mapping

## Environment Variables

Required for email notifications:

```env
SMTP_HOST=localhost
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=alerts@sentinel.app
```

## Example Alert Flow

1. **Rule Execution** (RunProcessor):
   - Fetch detects price change: $100 → $75 (25% drop)
   - Anti-flap confirms change
   - Alert policy has conditions:
     - `price_drop_percent: 10%` (severity: critical)
     - `price_below: 80` (severity: warning)

2. **Condition Evaluation**:
   - Both conditions triggered
   - Highest severity: critical

3. **Alert Generation**:
   - Title: "Price Alert: iPhone Monitor - Significant Drop"
   - Body: Full details with URL, change summary, triggered conditions
   - Dedupe key: SHA-256 hash based on rule + conditions + value

4. **Deduplication Check**:
   - Check if dedupe key seen in last 5 minutes
   - If yes: skip alert
   - If no: proceed

5. **Alert Record Creation**:
   - Insert into `alerts` table
   - Mark dedupe key as used

6. **Dispatch Job Enqueued**:
   - Job payload: alertId, channels, workspaceId, etc.
   - Queue: `alerts:dispatch`

7. **Alert Dispatch** (AlertProcessor):
   - Fetch alert details
   - For each channel (e.g., email):
     - Fetch channel config
     - Send email via @sentinel/notify
     - Log result
   - Update alert with delivery status

## Performance Considerations

**Condition Evaluation:**
- O(n) where n = number of conditions
- Short-circuit evaluation per condition
- Error in one condition doesn't affect others

**Deduplication:**
- In-memory cache (Redis via DedupeService)
- 5-minute time window
- Prevents alert floods

**Alert Dispatch:**
- Asynchronous job queue
- Configurable concurrency (default: 10)
- Retry with exponential backoff
- Failed channels don't block others

## Future Enhancements

1. **Additional Channels:**
   - Slack integration
   - Telegram bot
   - Generic webhooks
   - SMS notifications

2. **Advanced Conditions:**
   - Regex patterns for text
   - JSON path conditions
   - Composite conditions (AND/OR)
   - Time-based conditions (only during business hours)

3. **Alert Management:**
   - Alert acknowledgment
   - Alert resolution
   - Alert comments/notes
   - Alert escalation

4. **Analytics:**
   - Alert frequency tracking
   - Channel delivery success rates
   - Condition trigger frequency
   - False positive detection

## Related Files

**Core Implementation:**
- `apps/worker/src/services/condition-evaluator.service.ts`
- `apps/worker/src/services/alert-generator.service.ts`
- `apps/worker/src/processors/run.processor.ts`
- `apps/worker/src/processors/alert.processor.ts`

**Tests:**
- `apps/worker/src/services/condition-evaluator.service.spec.ts`
- `apps/worker/src/services/alert-generator.service.spec.ts`

**Dependencies:**
- `packages/shared/src/domain.ts` - Type definitions
- `packages/notify/src/email/email.ts` - Email sending
- `apps/worker/src/utils/change-detection.ts` - Change detection
- `apps/worker/src/services/dedupe.service.ts` - Deduplication

**Configuration:**
- `apps/worker/src/worker.module.ts` - Module registration
- `packages/shared/prisma/schema.prisma` - Database schema

## Implementation Date

**Completed:** December 27, 2024
**Agent:** eng-backend (Loki Mode)
**Task:** M2-005
