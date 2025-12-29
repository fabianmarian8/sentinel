import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

/**
 * Configuration service for worker app
 * Centralizes environment variable access and validation
 */
@Injectable()
export class WorkerConfigService {
  constructor(private configService: NestConfigService) {}

  /**
   * Database connection URL
   */
  get databaseUrl() {
    return this.configService.get<string>('DATABASE_URL')!;
  }

  /**
   * Redis connection configuration
   */
  get redis() {
    return {
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      db: this.configService.get<number>('REDIS_DB', 0),
    };
  }

  /**
   * Worker concurrency settings
   */
  get concurrency() {
    return {
      rulesRun: this.configService.get<number>('WORKER_CONCURRENCY_RULES', 5),
      alertsDispatch: this.configService.get<number>(
        'WORKER_CONCURRENCY_ALERTS',
        10,
      ),
    };
  }

  /**
   * Job retry configuration
   */
  get retryPolicies() {
    return {
      rulesRun: {
        maxAttempts: 2,
        backoffDelays: [30000, 120000], // 30s, 2m
      },
      alertsDispatch: {
        maxAttempts: 5,
        backoffDelays: [10000, 30000, 60000, 120000, 300000], // 10s, 30s, 60s, 120s, 300s
      },
    };
  }

  /**
   * Environment info
   */
  get environment() {
    return {
      nodeEnv: this.configService.get<string>('NODE_ENV', 'development'),
      isDevelopment: this.configService.get<string>('NODE_ENV') !== 'production',
      isProduction: this.configService.get<string>('NODE_ENV') === 'production',
    };
  }

  /**
   * Rate limiting (placeholder for future implementation)
   */
  get rateLimiting() {
    return {
      enabled: this.configService.get<boolean>('RATE_LIMITING_ENABLED', false),
      maxConcurrentPerDomain: this.configService.get<number>(
        'RATE_LIMIT_PER_DOMAIN',
        3,
      ),
    };
  }

  /**
   * Encryption key for sensitive data (notification channel configs)
   * CRITICAL: Must be set in environment, no fallback allowed
   */
  get encryptionKey(): string {
    return this.configService.get<string>('ENCRYPTION_KEY')!;
  }
}
