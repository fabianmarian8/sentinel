# Sentinel Worker

BullMQ background worker for Sentinel change intelligence platform.

## Overview

Processes background jobs for rule execution and alert dispatching using Redis-backed queues.

## Queues

### `rules:run`
- **Purpose**: Execute rules (fetch + extract + persist)
- **Concurrency**: 5 workers
- **Retry Policy**: Max 2 retries with exponential backoff (30s, 2m)
- **Processor**: `RunProcessor` (implementation in M1-013)

### `alerts:dispatch`
- **Purpose**: Send notifications across channels
- **Concurrency**: 10 workers
- **Retry Policy**: Max 5 retries with backoff (10s, 30s, 60s, 120s, 300s)
- **Processor**: `AlertProcessor` (implementation in M2-005)

## Job Payloads

```typescript
// Rule execution
interface RunJobPayload {
  ruleId: string;
  trigger: 'schedule' | 'manual_test' | 'retry';
  requestedAt: string;
  forceMode?: 'http' | 'headless' | null;
  debug?: boolean;
}

// Alert dispatch
interface AlertDispatchPayload {
  alertId: string;
  workspaceId: string;
  ruleId: string;
  channels: string[];
  dedupeKey: string;
}
```

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Configure Redis connection in .env
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Usage

```bash
# Development mode (watch mode)
pnpm run dev

# Build
pnpm run build

# Production
pnpm run start:prod

# Tests
pnpm run test
pnpm run test:watch
pnpm run test:cov
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `REDIS_HOST` | `localhost` | Redis server host |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD` | - | Redis password (optional) |
| `REDIS_DB` | `0` | Redis database number |
| `WORKER_CONCURRENCY_RULES` | `5` | Concurrency for rules:run queue |
| `WORKER_CONCURRENCY_ALERTS` | `10` | Concurrency for alerts:dispatch queue |
| `RATE_LIMITING_ENABLED` | `false` | Enable rate limiting (future) |
| `RATE_LIMIT_PER_DOMAIN` | `3` | Max concurrent requests per domain |

## Project Structure

```
src/
├── main.ts                 # Application bootstrap
├── worker.module.ts        # Main NestJS module
├── types/
│   └── jobs.ts            # Job payload TypeScript types
├── config/
│   ├── config.module.ts   # Configuration module
│   └── config.service.ts  # Configuration service
├── processors/
│   ├── run.processor.ts   # Rules:run queue processor (M1-013)
│   └── alert.processor.ts # Alerts:dispatch queue processor (M2-005)
└── services/
    └── queue.service.ts   # Queue management & job injection
```

## Integration with API

The worker exposes `QueueService` for job injection from the API:

```typescript
// In API module
import { QueueService } from '@sentinel/worker';

// Enqueue rule execution
await queueService.enqueueRuleRun({
  ruleId: 'rule-123',
  trigger: 'schedule',
  requestedAt: new Date().toISOString(),
});

// Enqueue alert dispatch
await queueService.enqueueAlertDispatch({
  alertId: 'alert-456',
  workspaceId: 'workspace-789',
  ruleId: 'rule-123',
  channels: ['slack', 'email'],
  dedupeKey: 'rule-123:2025-12-27',
});
```

## Workspace Dependencies

- `@sentinel/shared` - Shared utilities and types
- `@sentinel/extractor` - Data extraction engine (used in M1-013)
- `@sentinel/notify` - Notification delivery (used in M2-005)

## Job Lifecycle

1. **Enqueued**: Job added to Redis queue
2. **Active**: Worker picks up job for processing
3. **Processing**: Processor executes job logic
4. **Completed**: Job finished successfully
5. **Failed**: Job failed, will retry based on policy
6. **Stalled**: Job stuck in processing, will be retried

## Graceful Shutdown

Worker handles SIGTERM and SIGINT signals:
- Stops accepting new jobs
- Waits for active jobs to complete
- Closes Redis connections
- Exits cleanly

## Future Enhancements

- [ ] Rate limiting per domain (M1-013)
- [ ] Priority queues for urgent rules
- [ ] Job scheduling with cron patterns
- [ ] Dead letter queue for persistent failures
- [ ] Metrics and monitoring integration
- [ ] Distributed tracing support

## License

Proprietary - Sentinel Platform
