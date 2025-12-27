# Scheduler Module

The Scheduler module is responsible for periodically checking for due rules and enqueueing them for execution in BullMQ.

## Architecture

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────┐
│  SchedulerService│─────▶│   Database   │─────▶│   BullMQ    │
│   (tick every 5s)│      │ (find rules) │      │ rules:run   │
└─────────────────┘      └──────────────┘      └─────────────┘
```

## Features

- **Periodic Tick**: Runs every 5 seconds (configurable via `SCHEDULER_TICK_INTERVAL`)
- **Batch Processing**: Processes up to 500 rules per tick (configurable via `SCHEDULER_BATCH_SIZE`)
- **Domain Grouping**: Groups rules by domain for rate limiting
- **Jitter Support**: Adds random jitter to prevent thundering herd
- **Graceful Shutdown**: Waits for current tick to complete before shutting down
- **Overlap Prevention**: Prevents concurrent ticks from running

## Configuration

Environment variables:

```bash
SCHEDULER_ENABLED=true          # Enable/disable scheduler (default: true)
SCHEDULER_TICK_INTERVAL=5000    # Tick interval in milliseconds (default: 5000)
SCHEDULER_BATCH_SIZE=500        # Max rules to process per tick (default: 500)
REDIS_URL=redis://localhost:6379 # Redis connection for BullMQ
```

## Usage

The scheduler is automatically started when the module is initialized if `SCHEDULER_ENABLED=true`.

### Manual Trigger

You can manually trigger the scheduler for testing:

```typescript
import { SchedulerService } from './scheduler/scheduler.service';

// In your test or controller
const processedCount = await schedulerService.triggerNow();
console.log(`Processed ${processedCount} rules`);
```

## How It Works

1. **Tick**: Every 5 seconds (by default), the scheduler runs a tick
2. **Query**: Find all enabled rules where `nextRunAt <= now()`
3. **Group**: Group rules by domain for rate limiting
4. **Enqueue**: For each rule, enqueue a job to BullMQ `rules:run` queue
5. **Update**: Calculate `nextRunAt` based on `schedule.intervalSeconds` + jitter
6. **Persist**: Update rule in database with new `nextRunAt`

## Schedule Format

Rules must have a `schedule` JSON field with the following structure:

```json
{
  "intervalSeconds": 3600,
  "jitterSeconds": 60
}
```

- `intervalSeconds`: How often to run the rule (required)
- `jitterSeconds`: Random jitter to add (optional, 0-N seconds)

## Job Options

Each enqueued job has the following options:

- `jobId`: `rule:{ruleId}:{timestamp}` - Unique job ID
- `attempts`: 3 - Number of retry attempts
- `backoff`: Exponential backoff (2 seconds base)
- `removeOnComplete`: Keep for 24 hours
- `removeOnFail`: Keep failures for 7 days

## Domain Rate Limiting

Currently implemented as a simple delay (100ms) between jobs for the same domain.

**TODO**: Implement proper domain rate limiting:
- Respect domain-specific rate limits
- Use Redis to track domain quotas
- Delay jobs if domain quota exceeded

## Testing

Run unit tests:

```bash
pnpm test scheduler.service.spec.ts
```

The tests cover:
- Initialization and configuration
- Processing due rules
- Next run time calculation with jitter
- Manual triggering
- Domain grouping
- Tick overlap prevention
- Error handling

## Logging

The scheduler logs:

- Startup: `Starting scheduler: tick=5000ms, batch=500`
- Processing: `Processing 10 due rules`
- Completion: `Enqueued 10 rules across 3 domains`
- Errors: `Failed to enqueue rule {ruleId} for domain {domain}`
- Shutdown: `Scheduler stopped gracefully`

## Integration

The scheduler is integrated in `AppModule`:

```typescript
@Module({
  imports: [
    // ...
    SchedulerModule,
  ],
})
export class AppModule {}
```

## Performance

- Tick interval: 5 seconds
- Batch size: 500 rules/tick
- Throughput: ~6,000 rules/minute (with 100ms delay between jobs)
- Memory: Minimal (stateless service)
- CPU: Low (mostly I/O bound - database + Redis)

## Future Improvements

1. **Dynamic Rate Limiting**: Per-domain rate limits from config
2. **Priority Queue**: Support for priority scheduling
3. **Distributed Lock**: Use Redis lock for multi-instance deployments
4. **Metrics**: Export Prometheus metrics (rules processed, queue depth, etc.)
5. **Health Check**: Expose health endpoint for monitoring
6. **Backpressure**: Pause scheduling if queue depth exceeds threshold
