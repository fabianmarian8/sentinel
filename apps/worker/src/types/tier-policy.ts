/**
 * Tier Policy Types
 *
 * Defines the structure for domain tier policy resolution.
 * Used by TierPolicyResolver to convert DomainTier into concrete fetch policy.
 *
 * NOTE: Per-provider timeouts removed (2026-01-05)
 * The orchestrator uses a single timeoutMs from FetchRequest.
 * Per-provider timeouts can be added later when orchestrator supports them.
 */

import { FetchProvider, DomainTier } from '@prisma/client';

/**
 * Provider IDs used in policy configuration
 */
export type ProviderId = FetchProvider;

/**
 * Explicit tier policy overrides stored in FetchProfile.tierPolicyOverrides JSONB
 * Only fields present here are considered "explicitly set" and override tier defaults
 */
export interface TierPolicyOverrides {
  /** Explicit list of disabled providers (if present, overrides tier default) */
  disabledProviders?: ProviderId[];
  /** Explicit stop-after-preferred flag (if present, overrides tier default) */
  stopAfterPreferredFailure?: boolean;
  /** Explicit preferred provider (if present, overrides tier default) */
  preferredProvider?: ProviderId;
  /** Explicit geo country (if present, overrides tier default) */
  geoCountry?: string;
  // NOTE: Per-provider timeouts removed - orchestrator uses single timeoutMs
  // Can be added back when FetchOrchestrator supports per-provider timeouts
}

/**
 * Resolved tier policy - the final policy used by the orchestrator
 * All fields are defined (no undefined) after resolution
 */
export interface TierPolicy {
  /** Preferred provider for this tier (undefined = no preference, use fallback order) */
  preferredProvider?: ProviderId;
  /** Providers that should not be tried */
  disabledProviders: ProviderId[];
  /** Stop trying other providers after preferred fails */
  stopAfterPreferredFailure: boolean;
  /** Geo country for proxy routing */
  geoCountry?: string;
  /** Expected SLO target for this tier (0.0-1.0) */
  sloTarget: number;
  /** Whether paid providers are allowed */
  allowPaid: boolean;
  /**
   * Timeout for fetch requests in milliseconds
   * Tier-specific to match provider capabilities:
   * - tier_a (free): 30s - fast fail for free providers
   * - tier_b (paid-first): 60s - allow paid provider time
   * - tier_c (hostile): 120s - DataDome/heavy bypass needs time
   */
  timeoutMs: number;
}

/**
 * Tier defaults - base policies for each tier
 *
 * Timeout rationale:
 * - tier_a: 30s - free providers (http/headless) should fail fast
 * - tier_b: 60s - paid providers need time for bypass but shouldn't hang
 * - tier_c: 120s - hostile sites (DataDome) need extended time for heavy bypass
 * - unknown: 30s - conservative, same as tier_a
 *
 * These timeouts must be < semaphore TTL to prevent lease expiry during request
 */
export const TIER_DEFAULTS: Record<DomainTier, TierPolicy> = {
  tier_a: {
    disabledProviders: [],
    stopAfterPreferredFailure: false,
    sloTarget: 0.95,
    allowPaid: false,
    timeoutMs: 30000, // 30s - fast fail for free providers
  },
  tier_b: {
    preferredProvider: 'brightdata',
    disabledProviders: ['http', 'mobile_ua', 'headless', 'flaresolverr'],
    stopAfterPreferredFailure: true,
    sloTarget: 0.95,
    allowPaid: true,
    timeoutMs: 60000, // 60s - paid provider time
  },
  tier_c: {
    preferredProvider: 'brightdata',
    disabledProviders: ['http', 'mobile_ua', 'headless', 'flaresolverr'],
    stopAfterPreferredFailure: false, // Try other paid providers
    sloTarget: 0.80, // Best-effort
    allowPaid: true,
    timeoutMs: 120000, // 120s - DataDome/heavy bypass
  },
  unknown: {
    // Fallback to tier_a behavior
    disabledProviders: [],
    stopAfterPreferredFailure: false,
    sloTarget: 0.95,
    allowPaid: false,
    timeoutMs: 30000, // 30s - conservative default
  },
};
