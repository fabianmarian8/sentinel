import { Injectable, Logger } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

/**
 * Configuration service for worker app
 * Centralizes environment variable access and validation
 */
@Injectable()
export class WorkerConfigService {
  private readonly logger = new Logger(WorkerConfigService.name);

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

  /**
   * Feature flags for safe rollout
   */
  get featureFlags() {
    return {
      /**
       * TIER_POLICY_ENABLED - controls tier policy enforcement
       * When false: uses legacy behavior (autoThrottleDisabled check)
       * When true: uses TierPolicyResolver (tier defaults + overrides)
       *
       * Rollout strategy:
       * - staging: TIER_POLICY_ENABLED=true
       * - production: TIER_POLICY_ENABLED=false (default), then canary → global
       *
       * IMPORTANT: Before enabling in production:
       * 1. Run backfill SQL to set correct domain_tier for existing profiles
       * 2. Enable for internal workspace only (canary)
       * 3. Monitor SLO for 24h before global rollout
       */
      tierPolicyEnabled: this.configService.get<boolean>('TIER_POLICY_ENABLED', false),

      /**
       * CANARY_WORKSPACE_IDS - comma-separated list of workspace IDs for canary rollout
       * When set: tier policy only applies to these workspaces (true canary)
       * When empty/unset: tier policy applies to all workspaces (global rollout)
       *
       * Example: CANARY_WORKSPACE_IDS=11111111-1111-4111-8111-111111111111,other-workspace-id
       */
      canaryWorkspaceIds: this.parseCanaryWorkspaceIds(),
    };
  }

  /**
   * Parse CANARY_WORKSPACE_IDS env variable into array
   *
   * Edge case handling:
   * - Whitespace: " uuid1 , uuid2 " → ["uuid1", "uuid2"]
   * - Trailing comma: "uuid1,uuid2," → ["uuid1", "uuid2"]
   * - Only whitespace: "  " → []
   * - Only commas: ",,," → []
   *
   * UUID format validation: warns but doesn't reject (allows any string ID)
   */
  private parseCanaryWorkspaceIds(): string[] {
    const raw = this.configService.get<string>('CANARY_WORKSPACE_IDS', '');
    if (!raw || raw.trim() === '') {
      return [];
    }

    const ids = raw.split(',').map(id => id.trim()).filter(id => id.length > 0);

    // Validate UUID format (warn only, don't reject)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const id of ids) {
      if (!uuidRegex.test(id)) {
        this.logger.warn(
          `CANARY_WORKSPACE_IDS contains non-UUID value: "${id}" - ` +
          `this may be intentional, but verify it matches actual workspace IDs`,
        );
      }
    }

    return ids;
  }

  /**
   * Check if a workspace is in the canary group
   *
   * SEMANTICS (critical for correct rollout):
   * - CANARY_WORKSPACE_IDS not set / empty → returns TRUE for ALL workspaces (global rollout)
   * - CANARY_WORKSPACE_IDS has values → returns TRUE only for listed workspaces (true canary)
   *
   * WARNING: Empty list means GLOBAL rollout, not "apply to none".
   * If you want tier policy disabled, set TIER_POLICY_ENABLED=false instead.
   */
  isCanaryWorkspace(workspaceId: string): boolean {
    const canaryIds = this.featureFlags.canaryWorkspaceIds;
    // Empty list = global rollout (all workspaces enabled)
    // This is intentional: allows removing CANARY_WORKSPACE_IDS for global rollout
    if (canaryIds.length === 0) {
      return true;
    }
    return canaryIds.includes(workspaceId);
  }
}
