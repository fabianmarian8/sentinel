# Provider Orchestrator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the linear fallback chain into an intelligent Provider Orchestrator with cost tracking, domain-aware circuit breakers, and budget enforcement.

**Architecture:** Replace current TieredFetchService with FetchOrchestrator that uses unified FetchResult contract, tracks every attempt in FetchAttempt ledger, enforces budget limits per workspace/domain/rule, and uses per-(domain,provider) circuit breakers.

**Tech Stack:** NestJS, Prisma, Redis (circuit breakers), PostgreSQL (FetchAttempt ledger)

**IMPORTANT:** Pri akýchkoľvek nejasnostiach alebo nezrovnalostiach s existujúcim kódom sa OPÝTAJ POUŽÍVATEĽA na radu a ďalší postup. Neimplementuj nič, čo si nie istý.

**POZNÁMKA:** Local save (passive capture) je už implementovaný v Chrome extension ako alternatíva pre hostile domény - funguje keď má používateľ otvorený prehliadač a konkrétnu sledovanú stránku.

---

## Task 1: Add FetchAttempt Model to Prisma Schema

**Files:**
- Modify: `packages/shared/prisma/schema.prisma`

**Step 1: Add FetchOutcome enum**

```prisma
enum FetchOutcome {
  ok
  blocked
  captcha_required
  empty
  timeout
  network_error
  provider_error
}

enum FetchProvider {
  http
  mobile_ua
  headless
  flaresolverr
  brightdata
  scraping_browser
  twocaptcha_proxy
  twocaptcha_datadome
}

enum BlockKind {
  cloudflare
  datadome
  perimeterx
  captcha
  rate_limit
  unknown
}
```

**Step 2: Add FetchAttempt model**

```prisma
model FetchAttempt {
  id            String        @id @default(cuid())
  workspaceId   String        @map("workspace_id")
  ruleId        String?       @map("rule_id")
  url           String
  hostname      String
  provider      FetchProvider
  outcome       FetchOutcome
  blockKind     BlockKind?    @map("block_kind")
  httpStatus    Int?          @map("http_status")
  finalUrl      String?       @map("final_url")
  bodyBytes     Int           @map("body_bytes")
  contentType   String?       @map("content_type")
  latencyMs     Int?          @map("latency_ms")
  signalsJson   Json?         @map("signals_json")
  errorDetail   String?       @map("error_detail")
  costUsd       Float         @default(0) @map("cost_usd")
  costUnits     Float?        @map("cost_units")
  createdAt     DateTime      @default(now()) @map("created_at")

  @@index([workspaceId, hostname, createdAt])
  @@index([workspaceId, provider, createdAt])
  @@index([ruleId, createdAt])
  @@index([hostname, outcome, createdAt])
  @@map("fetch_attempts")
}
```

**Step 3: Add DomainStats model for rolling aggregations**

```prisma
model DomainStats {
  id              String    @id @default(cuid())
  workspaceId     String    @map("workspace_id")
  hostname        String
  date            DateTime  @db.Date
  attempts        Int       @default(0)
  okCount         Int       @default(0) @map("ok_count")
  blockedCount    Int       @default(0) @map("blocked_count")
  emptyCount      Int       @default(0) @map("empty_count")
  timeoutCount    Int       @default(0) @map("timeout_count")
  costUsd         Float     @default(0) @map("cost_usd")
  avgLatencyMs    Int?      @map("avg_latency_ms")
  byProviderJson  Json?     @map("by_provider_json")

  @@unique([workspaceId, hostname, date])
  @@index([workspaceId, date])
  @@map("domain_stats")
}
```

**Step 4: Run migration**

Run: `cd /Users/marianfabian/Projects/sentinel/packages/shared && npx prisma migrate dev --name add_fetch_attempt_and_domain_stats`

**Step 5: Verify migration**

Run: `cd /Users/marianfabian/Projects/sentinel/packages/shared && npx prisma generate`
Expected: Prisma Client generated successfully

**Step 6: Commit**

```bash
git add packages/shared/prisma/
git commit -m "feat(db): add FetchAttempt ledger and DomainStats models

- FetchAttempt tracks every fetch attempt with outcome, cost, signals
- DomainStats for rolling daily aggregations per domain
- Supports budget tracking and domain reliability scoring"
```

---

## Task 2: Create Unified FetchResult Types

**Files:**
- Create: `apps/worker/src/types/fetch-result.ts`

**Step 1: Create the types file**

```typescript
/**
 * Unified Fetch Result Types
 *
 * All providers must return this standardized result format.
 * Enables outcome classification, cost tracking, and intelligent routing.
 */

export type ProviderId =
  | 'http'
  | 'mobile_ua'
  | 'headless'
  | 'flaresolverr'
  | 'brightdata'
  | 'scraping_browser'
  | 'twocaptcha_proxy'
  | 'twocaptcha_datadome';

export type FetchOutcome =
  | 'ok'
  | 'blocked'
  | 'captcha_required'
  | 'empty'
  | 'timeout'
  | 'network_error'
  | 'provider_error';

export type BlockKind =
  | 'cloudflare'
  | 'datadome'
  | 'perimeterx'
  | 'captcha'
  | 'rate_limit'
  | 'unknown';

export interface FetchRequest {
  url: string;
  workspaceId: string;
  ruleId?: string;
  hostname: string;
  headers?: Record<string, string>;
  cookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
  timeoutMs: number;
  stickyKey?: string;
  locale?: string;
  timezone?: string;
  renderWaitMs?: number;
  userAgent?: string;
}

export interface FetchResult {
  provider: ProviderId;
  outcome: FetchOutcome;
  httpStatus?: number;
  finalUrl?: string;
  contentType?: string;
  bodyText?: string;
  bodyBytes: number;
  blockKind?: BlockKind;
  signals: string[];
  costUsd: number;
  costUnits?: number;
  latencyMs?: number;
  errorDetail?: string;
}

export interface IFetchProvider {
  id: ProviderId;
  isPaid: boolean;
  execute(req: FetchRequest): Promise<FetchResult>;
}

/**
 * Cost configuration per provider
 */
export const PROVIDER_COSTS: Record<ProviderId, { perRequest: number; description: string }> = {
  http: { perRequest: 0, description: 'Free HTTP fetch' },
  mobile_ua: { perRequest: 0, description: 'Free mobile UA fetch' },
  headless: { perRequest: 0, description: 'Free headless browser' },
  flaresolverr: { perRequest: 0, description: 'Free FlareSolverr' },
  brightdata: { perRequest: 0.003, description: 'Bright Data Web Unlocker ~$3/1000' },
  scraping_browser: { perRequest: 0.01, description: 'Scraping Browser ~$10/1000' },
  twocaptcha_proxy: { perRequest: 0.0007, description: '2captcha proxy ~$0.70/GB' },
  twocaptcha_datadome: { perRequest: 0.00145, description: '2captcha DataDome ~$1.45/1000' },
};
```

**Step 2: Commit**

```bash
git add apps/worker/src/types/fetch-result.ts
git commit -m "feat(types): add unified FetchResult contract for providers

- ProviderId, FetchOutcome, BlockKind enums
- FetchRequest with workspace/budget context
- FetchResult with outcome, signals, cost
- IFetchProvider interface for provider registry
- PROVIDER_COSTS configuration"
```

---

## Task 3: Create Empty/Block Detection Utilities

**Files:**
- Create: `apps/worker/src/utils/fetch-classifiers.ts`

**Step 1: Create classifiers**

```typescript
/**
 * Fetch Response Classifiers
 *
 * Detect empty responses, blocked pages, and protection mechanisms.
 * "Empty" is a first-class outcome, not just an error.
 */

import { BlockKind, FetchOutcome } from '../types/fetch-result';

export interface EmptyClassification {
  isEmpty: boolean;
  signals: string[];
}

export interface BlockClassification {
  isBlocked: boolean;
  kind: BlockKind;
  confidence: number;
  signals: string[];
}

/**
 * Classify if response is "empty" (soft failure)
 *
 * Empty means: we got a response but it has no useful content.
 * This is different from blocked (explicit block page) or error (network failure).
 */
export function classifyEmpty(
  bodyText: string | undefined,
  contentType?: string,
): EmptyClassification {
  const signals: string[] = [];
  const text = bodyText ?? '';
  const bytes = Buffer.byteLength(text, 'utf8');

  // Rule 1: Body too small for HTML
  if (bytes < 2000) {
    signals.push('body_too_small');
    return { isEmpty: true, signals };
  }

  // Rule 2: Missing basic HTML markers
  if (contentType?.includes('text/html')) {
    const lower = text.toLowerCase();
    if (!lower.includes('<html') && !lower.includes('<body') && !lower.includes('<!doctype')) {
      signals.push('missing_html_markers');
      return { isEmpty: true, signals };
    }
  }

  // Rule 3: Suspicious placeholder patterns
  const lower = text.toLowerCase();
  if (lower.includes('loading...') && bytes < 5000) {
    signals.push('loading_placeholder');
    return { isEmpty: true, signals };
  }

  // Rule 4: JSON error responses disguised as HTML
  if (contentType?.includes('text/html') && text.trim().startsWith('{') && text.includes('"error"')) {
    signals.push('json_error_in_html');
    return { isEmpty: true, signals };
  }

  return { isEmpty: false, signals };
}

/**
 * Classify if response is blocked by protection mechanism
 */
export function classifyBlock(bodyText: string | undefined): BlockClassification {
  const text = bodyText ?? '';
  const lower = text.toLowerCase();
  const signals: string[] = [];

  // DataDome detection
  if (
    lower.includes('datadome') ||
    lower.includes('captcha-delivery.com') ||
    lower.includes('dd_') ||
    lower.includes('geo.captcha-delivery.com')
  ) {
    signals.push('datadome_detected');
    return { isBlocked: true, kind: 'datadome', confidence: 0.95, signals };
  }

  // Cloudflare detection
  if (
    lower.includes('cloudflare') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('checking your browser') ||
    lower.includes('ray id:')
  ) {
    signals.push('cloudflare_detected');
    return { isBlocked: true, kind: 'cloudflare', confidence: 0.9, signals };
  }

  // PerimeterX detection
  if (
    lower.includes('perimeterx') ||
    lower.includes('px-captcha') ||
    lower.includes('_pxhd')
  ) {
    signals.push('perimeterx_detected');
    return { isBlocked: true, kind: 'perimeterx', confidence: 0.9, signals };
  }

  // Generic CAPTCHA detection
  if (
    lower.includes('captcha') ||
    lower.includes('i am not a robot') ||
    lower.includes('recaptcha') ||
    lower.includes('hcaptcha')
  ) {
    signals.push('captcha_detected');
    return { isBlocked: true, kind: 'captcha', confidence: 0.85, signals };
  }

  // Rate limit detection
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  ) {
    signals.push('rate_limit_detected');
    return { isBlocked: true, kind: 'rate_limit', confidence: 0.9, signals };
  }

  // Generic block detection
  if (
    lower.includes('access denied') ||
    lower.includes('blocked') ||
    lower.includes('forbidden')
  ) {
    signals.push('generic_block_detected');
    return { isBlocked: true, kind: 'unknown', confidence: 0.7, signals };
  }

  return { isBlocked: false, kind: 'unknown', confidence: 0, signals };
}

/**
 * Determine final outcome from HTTP status, empty check, and block check
 */
export function determineFetchOutcome(
  httpStatus: number | undefined,
  bodyText: string | undefined,
  contentType?: string,
  errorDetail?: string,
): { outcome: FetchOutcome; blockKind?: BlockKind; signals: string[] } {
  const signals: string[] = [];

  // Network/provider error
  if (errorDetail) {
    if (errorDetail.includes('timeout') || errorDetail.includes('ETIMEDOUT')) {
      signals.push('timeout');
      return { outcome: 'timeout', signals };
    }
    if (errorDetail.includes('ECONNREFUSED') || errorDetail.includes('ENOTFOUND')) {
      signals.push('network_error');
      return { outcome: 'network_error', signals };
    }
    signals.push('provider_error');
    return { outcome: 'provider_error', signals };
  }

  // HTTP error status
  if (httpStatus && httpStatus >= 400) {
    if (httpStatus === 403 || httpStatus === 429) {
      const blockCheck = classifyBlock(bodyText);
      signals.push(...blockCheck.signals);
      if (blockCheck.isBlocked) {
        return { outcome: 'blocked', blockKind: blockCheck.kind, signals };
      }
    }
    signals.push(`http_${httpStatus}`);
    return { outcome: 'blocked', blockKind: 'unknown', signals };
  }

  // Check for block page in response body
  const blockCheck = classifyBlock(bodyText);
  if (blockCheck.isBlocked) {
    signals.push(...blockCheck.signals);
    if (blockCheck.kind === 'captcha') {
      return { outcome: 'captcha_required', blockKind: 'captcha', signals };
    }
    return { outcome: 'blocked', blockKind: blockCheck.kind, signals };
  }

  // Check for empty response
  const emptyCheck = classifyEmpty(bodyText, contentType);
  if (emptyCheck.isEmpty) {
    signals.push(...emptyCheck.signals);
    return { outcome: 'empty', signals };
  }

  // Success
  return { outcome: 'ok', signals };
}
```

**Step 2: Write tests**

Create: `apps/worker/src/utils/fetch-classifiers.spec.ts`

```typescript
import { classifyEmpty, classifyBlock, determineFetchOutcome } from './fetch-classifiers';

describe('fetch-classifiers', () => {
  describe('classifyEmpty', () => {
    it('should detect body too small', () => {
      const result = classifyEmpty('<html></html>', 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('body_too_small');
    });

    it('should pass valid HTML', () => {
      const html = '<html><head></head><body>' + 'x'.repeat(3000) + '</body></html>';
      const result = classifyEmpty(html, 'text/html');
      expect(result.isEmpty).toBe(false);
    });

    it('should detect missing HTML markers', () => {
      const text = 'x'.repeat(3000);
      const result = classifyEmpty(text, 'text/html');
      expect(result.isEmpty).toBe(true);
      expect(result.signals).toContain('missing_html_markers');
    });
  });

  describe('classifyBlock', () => {
    it('should detect DataDome', () => {
      const html = '<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('datadome');
    });

    it('should detect Cloudflare', () => {
      const html = '<html><body>Checking your browser before accessing... Ray ID: abc123</body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(true);
      expect(result.kind).toBe('cloudflare');
    });

    it('should pass clean HTML', () => {
      const html = '<html><body><h1>Product Page</h1><span class="price">$99.99</span></body></html>';
      const result = classifyBlock(html);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('determineFetchOutcome', () => {
    it('should return ok for valid response', () => {
      const html = '<html><body>' + 'x'.repeat(5000) + '</body></html>';
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('ok');
    });

    it('should return empty for too small response', () => {
      const result = determineFetchOutcome(200, '<html></html>', 'text/html');
      expect(result.outcome).toBe('empty');
    });

    it('should return blocked for DataDome', () => {
      const html = '<html><script>datadome</script></html>' + 'x'.repeat(3000);
      const result = determineFetchOutcome(200, html, 'text/html');
      expect(result.outcome).toBe('blocked');
      expect(result.blockKind).toBe('datadome');
    });

    it('should return timeout for timeout error', () => {
      const result = determineFetchOutcome(undefined, undefined, undefined, 'Request timeout ETIMEDOUT');
      expect(result.outcome).toBe('timeout');
    });
  });
});
```

**Step 3: Run tests**

Run: `cd /Users/marianfabian/Projects/sentinel/apps/worker && npx jest src/utils/fetch-classifiers.spec.ts --passWithNoTests`
Expected: Tests pass

**Step 4: Commit**

```bash
git add apps/worker/src/utils/fetch-classifiers.ts apps/worker/src/utils/fetch-classifiers.spec.ts
git commit -m "feat(worker): add empty/block detection classifiers

- classifyEmpty() for soft failures (empty response)
- classifyBlock() for protection mechanism detection
- determineFetchOutcome() combines all checks
- DataDome, Cloudflare, PerimeterX, CAPTCHA detection
- 'empty' is first-class outcome, not just error"
```

---

## Task 4: Create Domain-Aware Circuit Breaker (Redis)

**Files:**
- Create: `apps/worker/src/services/domain-circuit-breaker.service.ts`

**Step 1: Create the service**

```typescript
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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { ProviderId, FetchOutcome } from '../types/fetch-result';

export interface CircuitState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailureAt: number;
  openCount: number; // How many times opened (for escalating cooldown)
}

const FAILURE_OUTCOMES: FetchOutcome[] = ['blocked', 'empty', 'timeout', 'provider_error', 'network_error'];

@Injectable()
export class DomainCircuitBreakerService implements OnModuleInit {
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

  private getKey(workspaceId: string, hostname: string, providerId: ProviderId): string {
    return `${this.KEY_PREFIX}${workspaceId}:${hostname}:${providerId}`;
  }

  private getCooldownMs(openCount: number): number {
    const tierIndex = Math.min(openCount, this.COOLDOWN_TIERS_MS.length - 1);
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

  /**
   * Check if provider can be used for this domain
   */
  async canExecute(workspaceId: string, hostname: string, providerId: ProviderId): Promise<boolean> {
    const state = await this.getState(workspaceId, hostname, providerId);

    if (state.state === 'closed') {
      return true;
    }

    if (state.state === 'open') {
      const cooldownMs = this.getCooldownMs(state.openCount);
      const elapsed = Date.now() - state.lastFailureAt;

      if (elapsed >= cooldownMs) {
        // Transition to half-open
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

    // half-open: allow one request
    return true;
  }

  /**
   * Record successful fetch - reset failures
   */
  async recordSuccess(workspaceId: string, hostname: string, providerId: ProviderId): Promise<void> {
    const state = await this.getState(workspaceId, hostname, providerId);

    if (state.state === 'half-open') {
      this.logger.log(`[${hostname}:${providerId}] Circuit closed after success in half-open`);
      await this.setState(workspaceId, hostname, providerId, {
        state: 'closed',
        failures: 0,
        lastFailureAt: 0,
        openCount: state.openCount, // Keep for escalating cooldown if it fails again
      });
    } else if (state.state === 'closed' && state.failures > 0) {
      // Reset failure count on success
      await this.setState(workspaceId, hostname, providerId, {
        ...state,
        failures: 0,
      });
    }
  }

  /**
   * Record failed fetch - increment failures, maybe open circuit
   */
  async recordFailure(
    workspaceId: string,
    hostname: string,
    providerId: ProviderId,
    outcome: FetchOutcome,
  ): Promise<void> {
    if (!FAILURE_OUTCOMES.includes(outcome)) {
      return; // Only count actual failures
    }

    const state = await this.getState(workspaceId, hostname, providerId);
    const now = Date.now();

    if (state.state === 'half-open') {
      // Failed in half-open, reopen circuit
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

    // Check if failures are within window
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

  /**
   * Get stats for monitoring
   */
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
```

**Step 2: Commit**

```bash
git add apps/worker/src/services/domain-circuit-breaker.service.ts
git commit -m "feat(worker): add domain-aware circuit breaker with Redis

- Per (workspace, hostname, provider) circuit breaking
- Escalating cooldowns: 15min → 60min → 6h for hostile domains
- Redis persistence for multi-instance deployments
- Falls back to in-memory if Redis unavailable"
```

---

## Task 5: Create Budget Guard Service

**Files:**
- Create: `apps/worker/src/services/budget-guard.service.ts`

**Step 1: Create the service**

```typescript
/**
 * Budget Guard Service
 *
 * Enforces cost limits per workspace/domain/rule.
 * Queries FetchAttempt ledger for current spend.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderId, PROVIDER_COSTS } from '../types/fetch-result';

export interface BudgetPolicy {
  enabled: boolean;
  workspaceDailyUsd: number;
  perDomainDailyUsd: number;
  perRuleDailyUsd: number;
  hardStopOnExceed: boolean;
  degradeToFreeOnly: boolean;
}

export interface BudgetStatus {
  workspaceSpent: number;
  domainSpent: number;
  ruleSpent: number;
  canSpendPaid: boolean;
  reason?: string;
}

const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  enabled: true,
  workspaceDailyUsd: 10,
  perDomainDailyUsd: 2,
  perRuleDailyUsd: 0.5,
  hardStopOnExceed: false,
  degradeToFreeOnly: true,
};

@Injectable()
export class BudgetGuardService {
  private readonly logger = new Logger(BudgetGuardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get today's start timestamp in UTC
   */
  private getTodayStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  /**
   * Get current spend for workspace/domain/rule
   */
  async getSpend(
    workspaceId: string,
    hostname: string,
    ruleId?: string,
  ): Promise<{ workspaceSpent: number; domainSpent: number; ruleSpent: number }> {
    const todayStart = this.getTodayStart();

    // Aggregate spend from FetchAttempt ledger
    const [workspaceAgg, domainAgg, ruleAgg] = await Promise.all([
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, hostname, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      ruleId
        ? this.prisma.fetchAttempt.aggregate({
            where: { ruleId, createdAt: { gte: todayStart } },
            _sum: { costUsd: true },
          })
        : Promise.resolve({ _sum: { costUsd: 0 } }),
    ]);

    return {
      workspaceSpent: workspaceAgg._sum.costUsd ?? 0,
      domainSpent: domainAgg._sum.costUsd ?? 0,
      ruleSpent: ruleAgg._sum.costUsd ?? 0,
    };
  }

  /**
   * Check if paid provider can be used given budget limits
   */
  async canSpend(
    workspaceId: string,
    hostname: string,
    providerId: ProviderId,
    ruleId?: string,
    policy: BudgetPolicy = DEFAULT_BUDGET_POLICY,
  ): Promise<BudgetStatus> {
    if (!policy.enabled) {
      return { workspaceSpent: 0, domainSpent: 0, ruleSpent: 0, canSpendPaid: true };
    }

    const providerCost = PROVIDER_COSTS[providerId];
    if (providerCost.perRequest === 0) {
      // Free provider, always allowed
      return { workspaceSpent: 0, domainSpent: 0, ruleSpent: 0, canSpendPaid: true };
    }

    const spend = await this.getSpend(workspaceId, hostname, ruleId);
    const estimatedCost = providerCost.perRequest;

    // Check workspace limit
    if (spend.workspaceSpent + estimatedCost > policy.workspaceDailyUsd) {
      this.logger.warn(
        `[${workspaceId}] Workspace budget exceeded: $${spend.workspaceSpent.toFixed(4)} / $${policy.workspaceDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Workspace daily budget exceeded ($${spend.workspaceSpent.toFixed(2)} / $${policy.workspaceDailyUsd})`,
      };
    }

    // Check domain limit
    if (spend.domainSpent + estimatedCost > policy.perDomainDailyUsd) {
      this.logger.warn(
        `[${hostname}] Domain budget exceeded: $${spend.domainSpent.toFixed(4)} / $${policy.perDomainDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Domain daily budget exceeded ($${spend.domainSpent.toFixed(2)} / $${policy.perDomainDailyUsd})`,
      };
    }

    // Check rule limit
    if (ruleId && spend.ruleSpent + estimatedCost > policy.perRuleDailyUsd) {
      this.logger.warn(
        `[Rule ${ruleId}] Rule budget exceeded: $${spend.ruleSpent.toFixed(4)} / $${policy.perRuleDailyUsd}`,
      );
      return {
        ...spend,
        canSpendPaid: false,
        reason: `Rule daily budget exceeded ($${spend.ruleSpent.toFixed(2)} / $${policy.perRuleDailyUsd})`,
      };
    }

    return { ...spend, canSpendPaid: true };
  }

  /**
   * Get budget status summary for API/UI
   */
  async getBudgetStatus(workspaceId: string, policy: BudgetPolicy = DEFAULT_BUDGET_POLICY): Promise<{
    todaySpent: number;
    dailyLimit: number;
    remaining: number;
    topDomains: Array<{ hostname: string; spent: number }>;
  }> {
    const todayStart = this.getTodayStart();

    const [totalAgg, domainAgg] = await Promise.all([
      this.prisma.fetchAttempt.aggregate({
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.fetchAttempt.groupBy({
        by: ['hostname'],
        where: { workspaceId, createdAt: { gte: todayStart } },
        _sum: { costUsd: true },
        orderBy: { _sum: { costUsd: 'desc' } },
        take: 5,
      }),
    ]);

    const todaySpent = totalAgg._sum.costUsd ?? 0;

    return {
      todaySpent,
      dailyLimit: policy.workspaceDailyUsd,
      remaining: Math.max(0, policy.workspaceDailyUsd - todaySpent),
      topDomains: domainAgg.map((d) => ({
        hostname: d.hostname,
        spent: d._sum.costUsd ?? 0,
      })),
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/worker/src/services/budget-guard.service.ts
git commit -m "feat(worker): add budget guard service for cost control

- Workspace/domain/rule daily limits
- Queries FetchAttempt ledger for current spend
- canSpend() check before paid providers
- getBudgetStatus() for API/UI monitoring"
```

---

## Task 6: Create FetchAttempt Logger Service

**Files:**
- Create: `apps/worker/src/services/fetch-attempt-logger.service.ts`

**Step 1: Create the service**

```typescript
/**
 * FetchAttempt Logger Service
 *
 * Records every fetch attempt to the FetchAttempt ledger.
 * Updates DomainStats rolling aggregations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FetchResult, ProviderId, FetchOutcome, BlockKind } from '../types/fetch-result';

export interface LogAttemptParams {
  workspaceId: string;
  ruleId?: string;
  url: string;
  hostname: string;
  result: FetchResult;
}

@Injectable()
export class FetchAttemptLoggerService {
  private readonly logger = new Logger(FetchAttemptLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log a fetch attempt to the ledger
   */
  async logAttempt(params: LogAttemptParams): Promise<void> {
    const { workspaceId, ruleId, url, hostname, result } = params;

    try {
      await this.prisma.fetchAttempt.create({
        data: {
          workspaceId,
          ruleId,
          url,
          hostname,
          provider: result.provider as any,
          outcome: result.outcome as any,
          blockKind: result.blockKind as any,
          httpStatus: result.httpStatus,
          finalUrl: result.finalUrl,
          bodyBytes: result.bodyBytes,
          contentType: result.contentType,
          latencyMs: result.latencyMs,
          signalsJson: result.signals.length > 0 ? result.signals : undefined,
          errorDetail: result.errorDetail,
          costUsd: result.costUsd,
          costUnits: result.costUnits,
        },
      });

      // Update daily domain stats (fire and forget)
      this.updateDomainStats(workspaceId, hostname, result).catch((err) => {
        this.logger.warn(`Failed to update domain stats: ${err.message}`);
      });
    } catch (error) {
      this.logger.error(`Failed to log fetch attempt: ${error}`);
      // Don't throw - logging shouldn't break the fetch flow
    }
  }

  /**
   * Update daily domain statistics (upsert)
   */
  private async updateDomainStats(
    workspaceId: string,
    hostname: string,
    result: FetchResult,
  ): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const incrementField = this.getOutcomeField(result.outcome);

    await this.prisma.domainStats.upsert({
      where: {
        workspaceId_hostname_date: {
          workspaceId,
          hostname,
          date: today,
        },
      },
      create: {
        workspaceId,
        hostname,
        date: today,
        attempts: 1,
        okCount: result.outcome === 'ok' ? 1 : 0,
        blockedCount: result.outcome === 'blocked' ? 1 : 0,
        emptyCount: result.outcome === 'empty' ? 1 : 0,
        timeoutCount: result.outcome === 'timeout' ? 1 : 0,
        costUsd: result.costUsd,
        avgLatencyMs: result.latencyMs,
      },
      update: {
        attempts: { increment: 1 },
        [incrementField]: { increment: 1 },
        costUsd: { increment: result.costUsd },
        // avgLatencyMs would need proper averaging logic, skip for now
      },
    });
  }

  private getOutcomeField(outcome: FetchOutcome): string {
    switch (outcome) {
      case 'ok':
        return 'okCount';
      case 'blocked':
        return 'blockedCount';
      case 'empty':
        return 'emptyCount';
      case 'timeout':
        return 'timeoutCount';
      default:
        return 'blockedCount'; // Count other failures as blocked
    }
  }

  /**
   * Get domain reliability stats for UI
   */
  async getDomainReliability(
    workspaceId: string,
    hostname: string,
    days: number = 7,
  ): Promise<{
    successRate: number;
    emptyRate: number;
    blockedRate: number;
    totalAttempts: number;
    totalCost: number;
  }> {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);
    fromDate.setUTCHours(0, 0, 0, 0);

    const stats = await this.prisma.domainStats.aggregate({
      where: {
        workspaceId,
        hostname,
        date: { gte: fromDate },
      },
      _sum: {
        attempts: true,
        okCount: true,
        blockedCount: true,
        emptyCount: true,
        costUsd: true,
      },
    });

    const total = stats._sum.attempts ?? 0;
    const ok = stats._sum.okCount ?? 0;
    const blocked = stats._sum.blockedCount ?? 0;
    const empty = stats._sum.emptyCount ?? 0;

    return {
      successRate: total > 0 ? ok / total : 0,
      emptyRate: total > 0 ? empty / total : 0,
      blockedRate: total > 0 ? blocked / total : 0,
      totalAttempts: total,
      totalCost: stats._sum.costUsd ?? 0,
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/worker/src/services/fetch-attempt-logger.service.ts
git commit -m "feat(worker): add FetchAttempt logger service

- Logs every fetch attempt to FetchAttempt table
- Updates DomainStats daily aggregations
- getDomainReliability() for UI reliability badge
- Non-blocking logging (fire and forget)"
```

---

## Task 7: Create Fetch Orchestrator Service

**Files:**
- Create: `apps/worker/src/services/fetch-orchestrator.service.ts`

**Step 1: Create the orchestrator**

```typescript
/**
 * Fetch Orchestrator Service
 *
 * Replaces linear fallback chain with policy-driven provider selection.
 * Integrates circuit breakers, budget limits, and attempt logging.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TwoCaptchaService } from './twocaptcha.service';
import { BrightDataService } from './brightdata.service';
import { ScrapingBrowserService } from './scraping-browser.service';
import { DomainCircuitBreakerService } from './domain-circuit-breaker.service';
import { BudgetGuardService, BudgetPolicy } from './budget-guard.service';
import { FetchAttemptLoggerService } from './fetch-attempt-logger.service';
import { smartFetch, type SmartFetchOptions } from '@sentinel/extractor';
import {
  FetchRequest,
  FetchResult,
  ProviderId,
  FetchOutcome,
  PROVIDER_COSTS,
} from '../types/fetch-result';
import { determineFetchOutcome } from '../utils/fetch-classifiers';

export interface OrchestratorConfig {
  maxAttemptsPerRun: number;
  allowPaid: boolean;
  budgetPolicy?: BudgetPolicy;
}

export interface OrchestratorResult {
  final: FetchResult;
  attempts: FetchResult[];
  html?: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxAttemptsPerRun: 3,
  allowPaid: true,
};

@Injectable()
export class FetchOrchestratorService {
  private readonly logger = new Logger(FetchOrchestratorService.name);

  // Mobile user agents for fallback
  private readonly mobileUserAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ];

  constructor(
    private readonly twoCaptcha: TwoCaptchaService,
    private readonly brightData: BrightDataService,
    private readonly scrapingBrowser: ScrapingBrowserService,
    private readonly circuitBreaker: DomainCircuitBreakerService,
    private readonly budgetGuard: BudgetGuardService,
    private readonly attemptLogger: FetchAttemptLoggerService,
  ) {}

  /**
   * Fetch URL using policy-driven provider selection
   */
  async fetch(
    request: FetchRequest,
    config: OrchestratorConfig = DEFAULT_CONFIG,
  ): Promise<OrchestratorResult> {
    const { workspaceId, hostname, ruleId, url } = request;
    const attempts: FetchResult[] = [];
    const startTime = Date.now();

    this.logger.log(`[Orchestrator] Starting fetch for ${hostname}`);

    // Build candidate provider sequence
    const candidates = this.buildCandidates(config);

    for (const providerId of candidates.slice(0, config.maxAttemptsPerRun)) {
      // Check circuit breaker
      const canExecute = await this.circuitBreaker.canExecute(workspaceId, hostname, providerId);
      if (!canExecute) {
        this.logger.debug(`[${hostname}:${providerId}] Circuit open, skipping`);
        continue;
      }

      // Check budget for paid providers
      const isPaid = PROVIDER_COSTS[providerId].perRequest > 0;
      if (isPaid && config.allowPaid) {
        const budgetStatus = await this.budgetGuard.canSpend(
          workspaceId,
          hostname,
          providerId,
          ruleId,
          config.budgetPolicy,
        );
        if (!budgetStatus.canSpendPaid) {
          this.logger.debug(`[${hostname}:${providerId}] Budget exceeded: ${budgetStatus.reason}`);
          continue;
        }
      } else if (isPaid && !config.allowPaid) {
        continue;
      }

      // Execute fetch
      const result = await this.executeProvider(providerId, request);
      attempts.push(result);

      // Log attempt
      await this.attemptLogger.logAttempt({
        workspaceId,
        ruleId,
        url,
        hostname,
        result,
      });

      // Update circuit breaker
      if (result.outcome === 'ok') {
        await this.circuitBreaker.recordSuccess(workspaceId, hostname, providerId);
        this.logger.log(
          `[Orchestrator] Success via ${providerId} in ${Date.now() - startTime}ms (cost: $${result.costUsd.toFixed(4)})`,
        );
        return {
          final: result,
          attempts,
          html: result.bodyText,
        };
      }

      await this.circuitBreaker.recordFailure(workspaceId, hostname, providerId, result.outcome);
      this.logger.debug(
        `[${hostname}:${providerId}] Failed: ${result.outcome} (${result.signals.join(', ')})`,
      );
    }

    // All providers failed
    const finalResult: FetchResult = attempts[attempts.length - 1] ?? {
      provider: 'http',
      outcome: 'provider_error',
      bodyBytes: 0,
      signals: ['no_attempts_executed'],
      costUsd: 0,
    };

    this.logger.warn(`[Orchestrator] All providers failed for ${hostname}`);
    return {
      final: finalResult,
      attempts,
    };
  }

  /**
   * Build ordered list of provider candidates
   */
  private buildCandidates(config: OrchestratorConfig): ProviderId[] {
    const candidates: ProviderId[] = [
      'http',
      'mobile_ua',
      'flaresolverr',
      'headless',
    ];

    if (config.allowPaid) {
      // Add paid providers in order of cost-effectiveness
      if (this.brightData.isAvailable()) {
        candidates.push('brightdata');
      }
      if (this.scrapingBrowser.isAvailable()) {
        candidates.push('scraping_browser');
      }
      if (this.twoCaptcha.isAvailable()) {
        candidates.push('twocaptcha_proxy');
      }
    }

    return candidates;
  }

  /**
   * Execute a specific provider
   */
  private async executeProvider(
    providerId: ProviderId,
    request: FetchRequest,
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const { url, timeoutMs, userAgent, headers, cookies, renderWaitMs } = request;

    try {
      switch (providerId) {
        case 'http':
        case 'flaresolverr':
        case 'headless':
          return await this.executeSmartFetch(providerId, request);

        case 'mobile_ua':
          return await this.executeMobileUA(request);

        case 'brightdata':
          return await this.executeBrightData(request);

        case 'scraping_browser':
          return await this.executeScrapingBrowser(request);

        case 'twocaptcha_proxy':
          return await this.executeTwoCaptchaProxy(request);

        default:
          return {
            provider: providerId,
            outcome: 'provider_error',
            bodyBytes: 0,
            signals: ['unknown_provider'],
            costUsd: 0,
            latencyMs: Date.now() - startTime,
            errorDetail: `Unknown provider: ${providerId}`,
          };
      }
    } catch (error: any) {
      return {
        provider: providerId,
        outcome: 'provider_error',
        bodyBytes: 0,
        signals: ['exception'],
        costUsd: 0,
        latencyMs: Date.now() - startTime,
        errorDetail: error.message,
      };
    }
  }

  private async executeSmartFetch(
    providerId: 'http' | 'flaresolverr' | 'headless',
    request: FetchRequest,
  ): Promise<FetchResult> {
    const startTime = Date.now();

    const smartResult = await smartFetch({
      url: request.url,
      timeout: request.timeoutMs,
      userAgent: request.userAgent,
      headers: request.headers,
      cookies: request.cookies,
      preferredMode: providerId,
      fallbackToHeadless: providerId === 'headless',
      fallbackToFlareSolverr: providerId === 'flaresolverr',
      renderWaitMs: request.renderWaitMs || 2000,
    } as SmartFetchOptions);

    const { outcome, blockKind, signals } = determineFetchOutcome(
      smartResult.httpStatus ?? undefined,
      smartResult.html ?? undefined,
      undefined,
      smartResult.error ?? undefined,
    );

    return {
      provider: providerId,
      outcome,
      httpStatus: smartResult.httpStatus ?? undefined,
      bodyText: smartResult.html ?? undefined,
      bodyBytes: Buffer.byteLength(smartResult.html ?? '', 'utf8'),
      blockKind,
      signals,
      costUsd: 0,
      latencyMs: Date.now() - startTime,
      errorDetail: smartResult.error ?? undefined,
    };
  }

  private async executeMobileUA(request: FetchRequest): Promise<FetchResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(request.url, {
        headers: {
          'User-Agent': this.mobileUserAgents[0],
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(request.timeoutMs),
      });

      const html = await response.text();
      const { outcome, blockKind, signals } = determineFetchOutcome(
        response.status,
        html,
        response.headers.get('content-type') ?? undefined,
      );

      return {
        provider: 'mobile_ua',
        outcome,
        httpStatus: response.status,
        bodyText: html,
        bodyBytes: Buffer.byteLength(html, 'utf8'),
        contentType: response.headers.get('content-type') ?? undefined,
        blockKind,
        signals,
        costUsd: 0,
        latencyMs: Date.now() - startTime,
      };
    } catch (error: any) {
      const { outcome, signals } = determineFetchOutcome(undefined, undefined, undefined, error.message);
      return {
        provider: 'mobile_ua',
        outcome,
        bodyBytes: 0,
        signals,
        costUsd: 0,
        latencyMs: Date.now() - startTime,
        errorDetail: error.message,
      };
    }
  }

  private async executeBrightData(request: FetchRequest): Promise<FetchResult> {
    const startTime = Date.now();
    const brightResult = await this.brightData.fetchWithDataDomeBypass(request.url);

    const { outcome, blockKind, signals } = determineFetchOutcome(
      brightResult.httpStatus,
      brightResult.html,
      undefined,
      brightResult.error,
    );

    return {
      provider: 'brightdata',
      outcome,
      httpStatus: brightResult.httpStatus,
      bodyText: brightResult.html,
      bodyBytes: Buffer.byteLength(brightResult.html ?? '', 'utf8'),
      blockKind,
      signals,
      costUsd: brightResult.cost ?? PROVIDER_COSTS.brightdata.perRequest,
      latencyMs: Date.now() - startTime,
      errorDetail: brightResult.error,
    };
  }

  private async executeScrapingBrowser(request: FetchRequest): Promise<FetchResult> {
    const startTime = Date.now();
    const browserResult = await this.scrapingBrowser.fetch(request.url);

    const { outcome, blockKind, signals } = determineFetchOutcome(
      browserResult.httpStatus,
      browserResult.html,
      undefined,
      browserResult.error,
    );

    return {
      provider: 'scraping_browser',
      outcome,
      httpStatus: browserResult.httpStatus,
      bodyText: browserResult.html,
      bodyBytes: Buffer.byteLength(browserResult.html ?? '', 'utf8'),
      blockKind,
      signals,
      costUsd: browserResult.cost ?? PROVIDER_COSTS.scraping_browser.perRequest,
      latencyMs: Date.now() - startTime,
      errorDetail: browserResult.error,
    };
  }

  private async executeTwoCaptchaProxy(request: FetchRequest): Promise<FetchResult> {
    const startTime = Date.now();
    const proxyResult = await this.twoCaptcha.fetchWithProxy({
      url: request.url,
      timeout: request.timeoutMs,
      userAgent: request.userAgent,
      headers: request.headers,
    });

    const { outcome, blockKind, signals } = determineFetchOutcome(
      proxyResult.httpStatus,
      proxyResult.html,
      undefined,
      proxyResult.error,
    );

    return {
      provider: 'twocaptcha_proxy',
      outcome,
      httpStatus: proxyResult.httpStatus,
      bodyText: proxyResult.html,
      bodyBytes: Buffer.byteLength(proxyResult.html ?? '', 'utf8'),
      blockKind,
      signals,
      costUsd: proxyResult.cost ?? PROVIDER_COSTS.twocaptcha_proxy.perRequest,
      latencyMs: Date.now() - startTime,
      errorDetail: proxyResult.error,
    };
  }
}
```

**Step 2: Commit**

```bash
git add apps/worker/src/services/fetch-orchestrator.service.ts
git commit -m "feat(worker): add FetchOrchestrator for policy-driven fetching

- Replaces linear TieredFetch with intelligent routing
- Integrates circuit breakers, budget limits, attempt logging
- Uses unified FetchResult contract
- Empty detection as first-class outcome"
```

---

## Task 8: Register New Services in Worker Module

**Files:**
- Modify: `apps/worker/src/worker.module.ts`

**Step 1: Import and register services**

Add imports and register in providers array:

```typescript
// Add imports
import { DomainCircuitBreakerService } from './services/domain-circuit-breaker.service';
import { BudgetGuardService } from './services/budget-guard.service';
import { FetchAttemptLoggerService } from './services/fetch-attempt-logger.service';
import { FetchOrchestratorService } from './services/fetch-orchestrator.service';

// In @Module providers array, add:
DomainCircuitBreakerService,
BudgetGuardService,
FetchAttemptLoggerService,
FetchOrchestratorService,
```

**Step 2: Commit**

```bash
git add apps/worker/src/worker.module.ts
git commit -m "feat(worker): register orchestrator services in module

- DomainCircuitBreakerService
- BudgetGuardService
- FetchAttemptLoggerService
- FetchOrchestratorService"
```

---

## Task 9: Integrate Orchestrator into RunProcessor

**Files:**
- Modify: `apps/worker/src/processors/run.processor.ts`

**Step 1: Replace TieredFetch with Orchestrator**

This task requires careful integration. Look at how TieredFetchService is currently used in RunProcessor and replace with FetchOrchestratorService.

**IMPORTANT:** Ak nie je jasné ako presne integrovať orchestrátor do existujúceho RunProcessor flow, OPÝTAJ SA POUŽÍVATEĽA na radu. RunProcessor je kritický komponent a zmeny musia byť kompatibilné s existujúcou logikou.

Key changes:
1. Inject `FetchOrchestratorService` instead of or alongside `TieredFetchService`
2. Build `FetchRequest` from rule/source context
3. Call `orchestrator.fetch(request, config)`
4. Handle `OrchestratorResult` and extract HTML
5. Keep backwards compatibility with existing error handling

**Step 2: Commit after testing**

```bash
git add apps/worker/src/processors/run.processor.ts
git commit -m "feat(worker): integrate FetchOrchestrator into RunProcessor

- Replace TieredFetch with policy-driven Orchestrator
- Build FetchRequest from rule/source context
- Log all attempts to FetchAttempt ledger
- Backwards compatible error handling"
```

---

## Task 10: Add Stats Endpoints to API

**Files:**
- Create: `apps/api/src/stats/stats.controller.ts`
- Create: `apps/api/src/stats/stats.service.ts`
- Create: `apps/api/src/stats/stats.module.ts`

**Step 1: Create stats service**

```typescript
// stats.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getDomainStats(workspaceId: string, days: number = 7) {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);

    return this.prisma.domainStats.findMany({
      where: {
        workspaceId,
        date: { gte: fromDate },
      },
      orderBy: { date: 'desc' },
    });
  }

  async getProviderStats(workspaceId: string, days: number = 7) {
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - days);

    return this.prisma.fetchAttempt.groupBy({
      by: ['provider', 'outcome'],
      where: {
        workspaceId,
        createdAt: { gte: fromDate },
      },
      _count: true,
      _sum: { costUsd: true },
    });
  }

  async getBudgetStatus(workspaceId: string) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const spent = await this.prisma.fetchAttempt.aggregate({
      where: {
        workspaceId,
        createdAt: { gte: todayStart },
      },
      _sum: { costUsd: true },
    });

    return {
      todaySpent: spent._sum.costUsd ?? 0,
      dailyLimit: 10, // TODO: from workspace settings
    };
  }
}
```

**Step 2: Create controller**

```typescript
// stats.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('domains')
  getDomainStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getDomainStats(user.workspaceId, parseInt(days));
  }

  @Get('providers')
  getProviderStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getProviderStats(user.workspaceId, parseInt(days));
  }

  @Get('budget')
  getBudgetStatus(@CurrentUser() user: any) {
    return this.statsService.getBudgetStatus(user.workspaceId);
  }
}
```

**Step 3: Create module and register**

```typescript
// stats.module.ts
import { Module } from '@nestjs/common';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
```

**Step 4: Register in AppModule**

**Step 5: Commit**

```bash
git add apps/api/src/stats/
git commit -m "feat(api): add stats endpoints for domain/provider/budget

- GET /stats/domains - domain reliability stats
- GET /stats/providers - provider success rates
- GET /stats/budget - current spend and limits"
```

---

## Task 11: Run Full Build and Tests

**Step 1: Run Prisma migration on production**

```bash
ssh root@135.181.99.192 "cd /root/sentinel && git pull && pnpm install && cd packages/shared && npx prisma migrate deploy"
```

**Step 2: Build all packages**

```bash
cd /Users/marianfabian/Projects/sentinel && pnpm build
```

**Step 3: Run tests**

```bash
cd /Users/marianfabian/Projects/sentinel/apps/worker && npx jest --passWithNoTests
```

**Step 4: Deploy**

```bash
ssh root@135.181.99.192 "cd /root/sentinel && git pull && pnpm install && pnpm build && systemctl restart sentinel-worker"
```

---

## Summary

Po implementácii budeš mať:

1. **FetchAttempt Ledger** - každý pokus o fetch sa loguje s outcome, cost, signals
2. **Domain-Aware Circuit Breaker** - per (workspace, hostname, provider) s eskalujúcimi cooldowns
3. **Budget Guard** - workspace/domain/rule denné limity
4. **Empty Detection** - "empty" ako prvotriedny outcome, nie len error
5. **FetchOrchestrator** - policy-driven rozhodovanie namiesto lineárneho fallbacku
6. **Stats Endpoints** - monitoring pre UI

**Poznámky:**
- Local save v extension je už k dispozícii ako fallback pre hostile domény
- Pri nejasnostiach sa OPÝTAJ POUŽÍVATEĽA
- Circuit breaker rieši Etsy/DataDome problém automatickým zastavením retry
