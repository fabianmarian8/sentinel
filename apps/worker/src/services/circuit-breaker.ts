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
