/**
 * Domain-Aware Circuit Breaker
 *
 * Uses Redis for state persistence across worker instances.
 * Circuit breaker is per (workspaceId, hostname, providerId).
 *
 * Policy:
 * - Open after 3 failures in 10 minutes
 * - Cooldown: 15min (first), 60min (repeat), 6h (hostile)
 * - Success resets failure counter
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ProviderId, FetchOutcome } from '../types/fetch-result';

export interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureAt: number;
  openCount: number; // How many times opened (for escalating cooldown)
}

/**
 * Outcomes that count as failures for circuit breaker purposes.
 *
 * EXCLUDED:
 * - 'ok' - Success, obviously
 * - 'rate_limited' - Provider-level limit, not domain-specific failure
 * - 'preferred_unavailable' - Policy decision (allowPaid=false), not failure
 * - 'interstitial_geo' - Geo-redirect page (store chooser, ZIP picker) - NOT a provider failure,
 *                        the provider successfully fetched the page, it's just geo-blocked content
 */
const FAILURE_OUTCOMES: FetchOutcome[] = ['blocked', 'captcha_required', 'empty', 'timeout', 'provider_error', 'network_error'];

@Injectable()
export class DomainCircuitBreakerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainCircuitBreakerService.name);
  private redis: Redis | null = null;

  // Configuration
  private readonly FAILURE_THRESHOLD = 3;
  private readonly FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private readonly COOLDOWN_TIERS_MS = [
    15 * 60 * 1000,  // 15 minutes (first open)
    60 * 60 * 1000,  // 60 minutes (second open)
    6 * 60 * 60 * 1000, // 6 hours (hostile domain)
  ];
  private readonly KEY_PREFIX = 'cb:';
  private readonly KEY_TTL_SECONDS = 24 * 60 * 60; // 24 hours

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl);
        this.logger.log('Domain Circuit Breaker connected to Redis');
      } catch (error) {
        this.logger.warn('Redis not available, using in-memory fallback');
      }
    } else {
      this.logger.warn('REDIS_URL not set, circuit breaker will use in-memory (not shared across instances)');
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Domain Circuit Breaker disconnected from Redis');
    }
  }

  private getKey(workspaceId: string, hostname: string, providerId: ProviderId): string {
    return `${this.KEY_PREFIX}${workspaceId}:${hostname}:${providerId}`;
  }

  private getCooldownMs(openCount: number): number {
    // openCount is 1-indexed (first open = 1), so subtract 1 for array index
    const tierIndex = Math.min(Math.max(0, openCount - 1), this.COOLDOWN_TIERS_MS.length - 1);
    return this.COOLDOWN_TIERS_MS[tierIndex];
  }

  async getState(workspaceId: string, hostname: string, providerId: ProviderId): Promise<CircuitState> {
    const key = this.getKey(workspaceId, hostname, providerId);

    if (!this.redis) {
      return { state: 'closed', failures: 0, lastFailureAt: 0, openCount: 0 };
    }

    try {
      const data = await this.redis.get(key);
      if (!data) {
        return { state: 'closed', failures: 0, lastFailureAt: 0, openCount: 0 };
      }
      return JSON.parse(data) as CircuitState;
    } catch (error) {
      this.logger.error(`Failed to get circuit state: ${error}`);
      return { state: 'closed', failures: 0, lastFailureAt: 0, openCount: 0 };
    }
  }

  private async setState(workspaceId: string, hostname: string, providerId: ProviderId, state: CircuitState): Promise<void> {
    if (!this.redis) return;

    const key = this.getKey(workspaceId, hostname, providerId);
    try {
      await this.redis.set(key, JSON.stringify(state), 'EX', this.KEY_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Failed to set circuit state: ${error}`);
    }
  }

  async canExecute(workspaceId: string, hostname: string, providerId: ProviderId): Promise<boolean> {
    const state = await this.getState(workspaceId, hostname, providerId);

    if (state.state === 'closed') {
      return true;
    }

    if (state.state === 'open') {
      const cooldownMs = this.getCooldownMs(state.openCount);
      const elapsed = Date.now() - state.lastFailureAt;

      if (elapsed >= cooldownMs) {
        await this.setState(workspaceId, hostname, providerId, {
          ...state,
          state: 'half-open',
        });
        this.logger.log(`[${hostname}:${providerId}] Circuit half-open, allowing test request`);
        return true;
      }

      const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
      this.logger.debug(`[${hostname}:${providerId}] Circuit open, cooldown ${remainingSec}s remaining`);
      return false;
    }

    return true;
  }

  async recordSuccess(workspaceId: string, hostname: string, providerId: ProviderId): Promise<void> {
    const state = await this.getState(workspaceId, hostname, providerId);

    if (state.state === 'half-open') {
      this.logger.log(`[${hostname}:${providerId}] Circuit closed after success in half-open`);
      await this.setState(workspaceId, hostname, providerId, {
        state: 'closed',
        failures: 0,
        lastFailureAt: 0,
        openCount: state.openCount,
      });
    } else if (state.state === 'closed' && state.failures > 0) {
      await this.setState(workspaceId, hostname, providerId, {
        ...state,
        failures: 0,
      });
    }
  }

  async recordFailure(
    workspaceId: string,
    hostname: string,
    providerId: ProviderId,
    outcome: FetchOutcome,
  ): Promise<void> {
    if (!FAILURE_OUTCOMES.includes(outcome)) {
      return;
    }

    const state = await this.getState(workspaceId, hostname, providerId);
    const now = Date.now();

    if (state.state === 'half-open') {
      const newOpenCount = state.openCount + 1;
      this.logger.warn(`[${hostname}:${providerId}] Circuit reopened (attempt ${newOpenCount})`);
      await this.setState(workspaceId, hostname, providerId, {
        state: 'open',
        failures: state.failures + 1,
        lastFailureAt: now,
        openCount: newOpenCount,
      });
      return;
    }

    const withinWindow = now - state.lastFailureAt < this.FAILURE_WINDOW_MS;
    const newFailures = withinWindow ? state.failures + 1 : 1;

    if (newFailures >= this.FAILURE_THRESHOLD) {
      const newOpenCount = state.openCount + 1;
      const cooldownMs = this.getCooldownMs(newOpenCount);
      this.logger.warn(
        `[${hostname}:${providerId}] Circuit opened after ${newFailures} failures, cooldown ${cooldownMs / 1000}s`,
      );
      await this.setState(workspaceId, hostname, providerId, {
        state: 'open',
        failures: newFailures,
        lastFailureAt: now,
        openCount: newOpenCount,
      });
    } else {
      await this.setState(workspaceId, hostname, providerId, {
        ...state,
        failures: newFailures,
        lastFailureAt: now,
      });
    }
  }

  async getStats(
    workspaceId: string,
    hostname: string,
    providerId: ProviderId,
  ): Promise<{ state: string; failures: number; cooldownRemainingMs: number; openCount: number }> {
    const circuitState = await this.getState(workspaceId, hostname, providerId);

    let cooldownRemainingMs = 0;
    if (circuitState.state === 'open') {
      const cooldownMs = this.getCooldownMs(circuitState.openCount);
      cooldownRemainingMs = Math.max(0, cooldownMs - (Date.now() - circuitState.lastFailureAt));
    }

    return {
      state: circuitState.state,
      failures: circuitState.failures,
      cooldownRemainingMs,
      openCount: circuitState.openCount,
    };
  }
}
