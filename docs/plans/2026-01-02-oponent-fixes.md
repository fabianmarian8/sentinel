# Oponent P0/P1 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical issues identified by Oponent analysis - JSONPath extraction, circuit breaker, error code consolidation, dead code removal.

**Architecture:** Block JSONPath at validation level (not worth implementing for MVP). Add circuit breaker to tiered-fetch with failure threshold. Consolidate error codes to single source of truth. Remove disabled LLM service.

**Tech Stack:** NestJS, TypeScript, class-validator, Prisma

---

## Task 1: Block JSONPath Rule Creation (P0)

**Files:**
- Modify: `packages/shared/src/domain.ts:32`
- Modify: `apps/api/src/rules/dto/create-rule.dto.ts`
- Modify: `packages/extractor/src/extraction/extract.ts:75-77`

**Step 1: Update SelectorMethod type to exclude jsonpath**

In `packages/shared/src/domain.ts:32`, change:
```typescript
// FROM:
export type SelectorMethod = "css" | "xpath" | "regex" | "jsonpath";

// TO:
export type SelectorMethod = "css" | "xpath" | "regex";
// Note: jsonpath removed - not implemented, blocked at API level
```

**Step 2: Run TypeScript compiler to find all jsonpath references**

Run: `cd /Users/marianfabian/Projects/sentinel && npx tsc --noEmit 2>&1 | grep -i jsonpath`
Expected: Type errors showing where jsonpath is referenced

**Step 3: Update extract.ts to remove dead jsonpath case**

In `packages/extractor/src/extraction/extract.ts:75-77`, change:
```typescript
// FROM:
    case 'jsonpath':
      // JSONPath not implemented yet
      throw new Error('JSONPath extraction not implemented');

// TO:
    // jsonpath removed - blocked at API validation level
```

**Step 4: Add validation message to CreateRuleDto**

In `apps/api/src/rules/dto/create-rule.dto.ts`, ensure extraction.method validation:
```typescript
@IsIn(['css', 'xpath', 'regex'], { message: 'Method must be css, xpath, or regex. JSONPath not yet supported.' })
method: 'css' | 'xpath' | 'regex';
```

**Step 5: Run build to verify no errors**

Run: `cd /Users/marianfabian/Projects/sentinel && npm run build`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add packages/shared/src/domain.ts packages/extractor/src/extraction/extract.ts apps/api/src/rules/dto/
git commit -m "fix(P0): block JSONPath rule creation - not implemented"
```

---

## Task 2: Add Circuit Breaker to TieredFetchService (P1)

**Files:**
- Create: `apps/worker/src/services/circuit-breaker.ts`
- Modify: `apps/worker/src/services/tiered-fetch.service.ts`

**Step 1: Create CircuitBreaker utility class**

Create `apps/worker/src/services/circuit-breaker.ts`:
```typescript
import { Logger } from '@nestjs/common';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;      // Number of failures before opening
  successThreshold: number;      // Number of successes to close from half-open
  cooldownMs: number;            // Time before trying again after open
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private readonly logger = new Logger(CircuitBreaker.name);
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  get currentState(): CircuitState {
    return this.state;
  }

  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.options.cooldownMs) {
        this.logger.log(`[${this.options.name}] Circuit half-open, allowing test request`);
        this.state = 'half-open';
        return true;
      }
      return false;
    }

    // half-open: allow one request at a time
    return true;
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.options.successThreshold) {
        this.logger.log(`[${this.options.name}] Circuit closed after ${this.successes} successes`);
        this.state = 'closed';
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === 'closed') {
      this.failures = 0; // Reset on success
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.logger.warn(`[${this.options.name}] Circuit reopened after failure in half-open state`);
      this.state = 'open';
      this.successes = 0;
    } else if (this.state === 'closed' && this.failures >= this.options.failureThreshold) {
      this.logger.warn(`[${this.options.name}] Circuit opened after ${this.failures} failures`);
      this.state = 'open';
    }
  }

  getStats(): { state: CircuitState; failures: number; cooldownRemaining: number } {
    const cooldownRemaining =
      this.state === 'open'
        ? Math.max(0, this.options.cooldownMs - (Date.now() - this.lastFailureTime))
        : 0;
    return { state: this.state, failures: this.failures, cooldownRemaining };
  }
}
```

**Step 2: Run TypeScript check on new file**

Run: `cd /Users/marianfabian/Projects/sentinel && npx tsc --noEmit apps/worker/src/services/circuit-breaker.ts`
Expected: No errors

**Step 3: Add circuit breakers to TieredFetchService**

In `apps/worker/src/services/tiered-fetch.service.ts`, add after imports:
```typescript
import { CircuitBreaker } from './circuit-breaker';
```

Add to class properties after `mobileUserAgents`:
```typescript
  // Circuit breakers for paid services
  private readonly brightDataCircuit = new CircuitBreaker({
    name: 'BrightData',
    failureThreshold: 3,
    successThreshold: 1,
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  });

  private readonly twoCaptchaCircuit = new CircuitBreaker({
    name: '2captcha',
    failureThreshold: 3,
    successThreshold: 1,
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  });
```

**Step 4: Wrap BrightData call with circuit breaker**

In `tiered-fetch.service.ts`, replace the BrightData block (~line 196-219):
```typescript
    // Step 3: Try Bright Data first (more reliable for DataDome)
    if (hasBrightData && this.brightDataCircuit.canExecute()) {
      this.logger.debug(`[Tier 2.1] Trying Bright Data Web Unlocker`);
      const brightResult = await this.brightData.fetchWithDataDomeBypass(url);

      if (brightResult.success && !this.isBlocked(brightResult.html || '')) {
        this.brightDataCircuit.recordSuccess();
        this.logger.log(
          `[Tier 2] Success via Bright Data (~$${brightResult.cost?.toFixed(4) || '0'})`,
        );
        return {
          success: true,
          html: brightResult.html,
          httpStatus: brightResult.httpStatus,
          tierUsed: 'paid',
          methodUsed: 'brightdata',
          paidServiceUsed: true,
          estimatedCost: brightResult.cost,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      this.brightDataCircuit.recordFailure();
      this.logger.warn(
        `[Tier 2.1] Bright Data failed: ${brightResult.error || 'Unknown'}`,
      );
    } else if (hasBrightData && !this.brightDataCircuit.canExecute()) {
      const stats = this.brightDataCircuit.getStats();
      this.logger.warn(`[Tier 2.1] Bright Data circuit OPEN (cooldown: ${Math.round(stats.cooldownRemaining / 1000)}s)`);
    }
```

**Step 5: Wrap 2captcha calls with circuit breaker**

In `tiered-fetch.service.ts`, wrap 2captcha proxy call (~line 236-258):
```typescript
    // Step 5: Try 2captcha proxy (fallback)
    if (this.twoCaptchaCircuit.canExecute()) {
      this.logger.debug(`[Tier 2.2] Trying 2captcha residential proxy`);
      const proxyResult = await this.twoCaptcha.fetchWithProxy({
        url,
        timeout,
        userAgent: options.userAgent,
        headers: options.headers,
      });

      if (proxyResult.success && !this.isBlocked(proxyResult.html || '')) {
        this.twoCaptchaCircuit.recordSuccess();
        this.logger.log(
          `[Tier 2] Success via 2captcha proxy (~$${proxyResult.cost?.toFixed(6) || '0'})`,
        );
        return {
          success: true,
          html: proxyResult.html,
          httpStatus: proxyResult.httpStatus,
          tierUsed: 'paid',
          methodUsed: 'proxy',
          paidServiceUsed: true,
          estimatedCost: proxyResult.cost,
          timings: { totalMs: Date.now() - startTime },
        };
      }

      this.twoCaptchaCircuit.recordFailure();
      // Continue to DataDome bypass...
    } else {
      const stats = this.twoCaptchaCircuit.getStats();
      this.logger.warn(`[Tier 2.2] 2captcha circuit OPEN (cooldown: ${Math.round(stats.cooldownRemaining / 1000)}s)`);
    }
```

**Step 6: Run build to verify**

Run: `cd /Users/marianfabian/Projects/sentinel && npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add apps/worker/src/services/circuit-breaker.ts apps/worker/src/services/tiered-fetch.service.ts
git commit -m "feat(P1): add circuit breaker for paid fetch services"
```

---

## Task 3: Consolidate Error Codes (P1)

**Files:**
- Modify: `packages/shared/src/domain.ts:8-20`

**Step 1: Add JSDoc deprecation note to ErrorCode type**

In `packages/shared/src/domain.ts:8-20`, add comment:
```typescript
/**
 * Error codes for Sentinel run failures
 *
 * Categories:
 * - FETCH_*: Network/HTTP errors
 * - BLOCK_*: Bot detection/blocking
 * - EXTRACT_*: Selector/parsing errors
 * - SYSTEM_*: Internal errors
 *
 * @deprecated Legacy codes (without prefix) will be removed in v2.0
 * Use prefixed versions: BLOCK_CAPTCHA_SUSPECTED instead of CAPTCHA_BLOCK
 */
export type ErrorCode =
  // Fetch errors
  | "FETCH_TIMEOUT" | "FETCH_DNS" | "FETCH_CONNECTION" | "FETCH_TLS" | "FETCH_HTTP_4XX" | "FETCH_HTTP_5XX"
  // Block detection (preferred)
  | "BLOCK_CAPTCHA_SUSPECTED" | "BLOCK_CLOUDFLARE_SUSPECTED" | "BLOCK_FORBIDDEN_403" | "BLOCK_RATE_LIMIT_429"
  // Block detection (legacy - deprecated)
  | "CAPTCHA_BLOCK" | "CLOUDFLARE_BLOCK" | "RATELIMIT_BLOCK" | "GEO_BLOCK" | "BOT_DETECTION"
  // Extraction errors
  | "EXTRACT_SELECTOR_NOT_FOUND" | "EXTRACT_EMPTY_VALUE" | "EXTRACT_PARSE_ERROR" | "EXTRACT_UNSTABLE"
  // Extraction (legacy - deprecated)
  | "SELECTOR_BROKEN" | "SELECTOR_HEALED" | "JSON_PATH_BROKEN" | "PARSE_ERROR"
  // System errors
  | "SYSTEM_WORKER_CRASH" | "SYSTEM_QUEUE_DELAY"
  // Unknown
  | "UNKNOWN";
```

**Step 2: Run build to verify**

Run: `cd /Users/marianfabian/Projects/sentinel && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/shared/src/domain.ts
git commit -m "docs(P1): document error codes, mark legacy as deprecated"
```

---

## Task 4: Remove Disabled LlmExtractionService (P1)

**Files:**
- Delete: `apps/worker/src/services/llm-extraction.service.ts`
- Modify: `apps/worker/src/worker.module.ts`

**Step 1: Find all imports of LlmExtractionService**

Run: `cd /Users/marianfabian/Projects/sentinel && grep -r "LlmExtractionService" --include="*.ts" | grep -v node_modules | grep -v dist`
Expected: List of files importing the service

**Step 2: Remove from worker.module.ts providers**

Find and remove LlmExtractionService from providers array in `apps/worker/src/worker.module.ts`

**Step 3: Remove any usage in processors**

Check run.processor.ts and other processors for LlmExtractionService usage and remove

**Step 4: Delete the service file**

Run: `rm /Users/marianfabian/Projects/sentinel/apps/worker/src/services/llm-extraction.service.ts`

**Step 5: Run build to verify no broken imports**

Run: `cd /Users/marianfabian/Projects/sentinel && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(P1): remove disabled LlmExtractionService"
```

---

## Summary

| Task | Priority | Impact |
|------|----------|--------|
| 1. Block JSONPath | P0 | Prevents user confusion, API throws clear error |
| 2. Circuit Breaker | P1 | Prevents cost runaway during service outages |
| 3. Error Code Docs | P1 | Clarifies deprecation path for error codes |
| 4. Remove LLM Service | P1 | Removes dead code, cleaner codebase |

**Estimated time:** 30-45 minutes total

---

*Generated by Claude using superpowers:writing-plans - 02.01.2026*
