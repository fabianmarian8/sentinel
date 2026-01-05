import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from './config/config.module';
import { WorkerConfigService } from './config/config.service';
import { PrismaService } from './prisma/prisma.service';
import { QueueService } from './services/queue.service';
import { DedupeService } from './services/dedupe.service';
import { ConditionEvaluatorService } from './services/condition-evaluator.service';
import { AlertGeneratorService } from './services/alert-generator.service';
import { RateLimiterService } from './services/rate-limiter.service';
import { HealthScoreService } from './services/health-score.service';
import { TwoCaptchaService } from './services/twocaptcha.service';
import { BrightDataService } from './services/brightdata.service';
import { ScrapingBrowserService } from './services/scraping-browser.service';
import { TieredFetchService } from './services/tiered-fetch.service';
import { DomainCircuitBreakerService } from './services/domain-circuit-breaker.service';
import { BudgetGuardService } from './services/budget-guard.service';
import { FetchAttemptLoggerService } from './services/fetch-attempt-logger.service';
import { FetchOrchestratorService } from './services/fetch-orchestrator.service';
import { ConcurrencySemaphoreService } from './services/concurrency-semaphore.service';
import { TierPolicyResolverService } from './services/tier-policy-resolver.service';
import { RunProcessor } from './processors/run.processor';
import { AlertProcessor } from './processors/alert.processor';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { QUEUE_NAMES } from './types/jobs';

/**
 * Main worker module
 * Configures BullMQ queues and processors
 */
@Module({
  imports: [
    ConfigModule,

    // BullMQ root configuration with Redis connection
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [WorkerConfigService],
      useFactory: (config: WorkerConfigService) => ({
        connection: {
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          maxRetriesPerRequest: null, // Required for BullMQ
        },
      }),
    }),

    // Register rules:run queue
    BullModule.registerQueue({
      name: QUEUE_NAMES.RULES_RUN,
      defaultJobOptions: {
        removeOnComplete: {
          age: 86400, // 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 604800, // 7 days
        },
      },
    }),

    // Register alerts:dispatch queue
    BullModule.registerQueue({
      name: QUEUE_NAMES.ALERTS_DISPATCH,
      defaultJobOptions: {
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    }),

    // Register maintenance queue
    BullModule.registerQueue({
      name: QUEUE_NAMES.MAINTENANCE,
      defaultJobOptions: {
        removeOnComplete: {
          count: 100,
        },
        removeOnFail: {
          count: 100,
        },
      },
    }),
  ],
  providers: [
    PrismaService,
    QueueService,
    DedupeService,
    ConditionEvaluatorService,
    AlertGeneratorService,
    RateLimiterService,
    HealthScoreService,
    TwoCaptchaService,
    BrightDataService,
    ScrapingBrowserService,
    TieredFetchService,
    DomainCircuitBreakerService,
    BudgetGuardService,
    FetchAttemptLoggerService,
    FetchOrchestratorService,
    ConcurrencySemaphoreService,
    TierPolicyResolverService,
    RunProcessor,
    AlertProcessor,
    MaintenanceProcessor,
  ],
  exports: [QueueService, PrismaService, DedupeService, ConditionEvaluatorService, AlertGeneratorService, RateLimiterService, HealthScoreService],
})
export class WorkerModule {}
