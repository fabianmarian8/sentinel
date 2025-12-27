# Worker Integration Guide

## How to integrate Worker with API

### Step 1: Export Worker Module in API

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { WorkerModule } from '@sentinel/worker';

@Module({
  imports: [
    // ... other modules
    WorkerModule,  // Import worker module
  ],
})
export class AppModule {}
```

### Step 2: Inject QueueService in Controllers/Services

```typescript
// apps/api/src/rules/rules.service.ts
import { Injectable } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';

@Injectable()
export class RulesService {
  constructor(private queueService: QueueService) {}

  async executeRule(ruleId: string) {
    // Add job to queue
    await this.queueService.enqueueRuleRun({
      ruleId,
      trigger: 'manual_test',
      requestedAt: new Date().toISOString(),
    });

    return { message: 'Rule execution queued' };
  }
}
```

### Step 3: Schedule Jobs with Cron (Future)

```typescript
// apps/api/src/scheduler/scheduler.service.ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { QueueService } from '@sentinel/worker';
import { PrismaService } from '@sentinel/storage';

@Injectable()
export class SchedulerService {
  constructor(
    private queueService: QueueService,
    private prisma: PrismaService,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes
  async processScheduledRules() {
    // Find rules that need to run
    const rules = await this.prisma.rule.findMany({
      where: {
        enabled: true,
        // ... scheduling logic
      },
    });

    // Enqueue each rule
    for (const rule of rules) {
      await this.queueService.enqueueRuleRun({
        ruleId: rule.id,
        trigger: 'schedule',
        requestedAt: new Date().toISOString(),
      });
    }
  }
}
```

## Running API and Worker Together

### Development Mode

```bash
# Terminal 1: Start worker
cd apps/worker && pnpm run dev

# Terminal 2: Start API
cd apps/api && pnpm run dev
```

### Production Mode

```bash
# Build all
pnpm run build

# Start worker
cd apps/worker && pnpm run start:prod &

# Start API
cd apps/api && pnpm run start:prod &
```

### Docker Compose (Recommended)

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  worker:
    build: .
    command: pnpm run start:prod --filter @sentinel/worker
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis

  api:
    build: .
    command: pnpm run start:prod --filter @sentinel/api
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
      - worker

volumes:
  redis-data:
```

## Monitoring Queue Health

```typescript
// apps/api/src/health/queue-health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { QueueService } from '@sentinel/worker';

@Controller('health/queues')
export class QueueHealthController {
  constructor(private queueService: QueueService) {}

  @Get()
  async getQueueStats() {
    return await this.queueService.getStats();
  }
}
```

Response:
```json
{
  "rulesRun": {
    "waiting": 5,
    "active": 2,
    "completed": 1234,
    "failed": 12
  },
  "alertsDispatch": {
    "waiting": 0,
    "active": 1,
    "completed": 567,
    "failed": 3
  }
}
```

## Error Handling

Jobs that fail are automatically retried based on retry policies:

- **rules:run**: 2 retries with exponential backoff (30s, 2m)
- **alerts:dispatch**: 5 retries with backoff (10s, 30s, 60s, 120s, 300s)

After max retries, jobs move to "failed" state and are kept for 7 days for debugging.

## Testing Integration

```typescript
// apps/api/src/rules/rules.controller.spec.ts
import { Test } from '@nestjs/testing';
import { QueueService } from '@sentinel/worker';
import { RulesController } from './rules.controller';

describe('RulesController', () => {
  let controller: RulesController;
  let queueService: QueueService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [RulesController],
      providers: [
        {
          provide: QueueService,
          useValue: {
            enqueueRuleRun: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(RulesController);
    queueService = module.get(QueueService);
  });

  it('should enqueue rule execution', async () => {
    await controller.executeRule('rule-123');
    expect(queueService.enqueueRuleRun).toHaveBeenCalledWith({
      ruleId: 'rule-123',
      trigger: 'manual_test',
      requestedAt: expect.any(String),
    });
  });
});
```

## Deployment Checklist

- [ ] Redis instance running and accessible
- [ ] Environment variables configured
- [ ] Worker process started before API
- [ ] Queue health monitoring enabled
- [ ] Failed job alerts configured
- [ ] Graceful shutdown handlers tested
- [ ] Concurrency limits tuned for load
- [ ] Rate limiting configured (if needed)
