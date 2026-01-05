/**
 * Tier Policy Types
 *
 * Defines the structure for domain tier policy resolution.
 * Used by TierPolicyResolver to convert DomainTier into concrete fetch policy.
 */

import { FetchProvider, DomainTier } from '@prisma/client';

/**
 * Provider IDs used in policy configuration
 */
export type ProviderId = FetchProvider;

/**
 * Per-provider timeout configuration
 */
export interface ProviderTimeouts {
  http?: number;
  mobile_ua?: number;
  headless?: number;
  flaresolverr?: number;
  brightdata?: number;
  scraping_browser?: number;
  twocaptcha_proxy?: number;
  twocaptcha_datadome?: number;
}

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
  /** Per-provider timeout overrides */
  timeouts?: ProviderTimeouts;
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
  /** Per-provider timeouts in milliseconds */
  timeouts: Required<ProviderTimeouts>;
  /** Expected SLO target for this tier (0.0-1.0) */
  sloTarget: number;
  /** Whether paid providers are allowed */
  allowPaid: boolean;
}

/**
 * Default timeouts per provider (in milliseconds)
 */
export const DEFAULT_PROVIDER_TIMEOUTS: Required<ProviderTimeouts> = {
  http: 25000,
  mobile_ua: 25000,
  headless: 60000,
  flaresolverr: 60000,
  brightdata: 90000,
  scraping_browser: 120000,
  twocaptcha_proxy: 180000,
  twocaptcha_datadome: 180000,
};

/**
 * Tier defaults - base policies for each tier
 */
export const TIER_DEFAULTS: Record<DomainTier, Omit<TierPolicy, 'timeouts'> & { timeouts: ProviderTimeouts }> = {
  tier_a: {
    disabledProviders: [],
    stopAfterPreferredFailure: false,
    sloTarget: 0.95,
    allowPaid: false,
    timeouts: {
      http: 25000,
      headless: 60000,
      flaresolverr: 60000,
    },
  },
  tier_b: {
    preferredProvider: 'brightdata',
    disabledProviders: ['http', 'mobile_ua', 'headless', 'flaresolverr'],
    stopAfterPreferredFailure: true,
    sloTarget: 0.95,
    allowPaid: true,
    timeouts: {
      brightdata: 90000,
      scraping_browser: 120000,
    },
  },
  tier_c: {
    preferredProvider: 'brightdata',
    disabledProviders: ['http', 'mobile_ua', 'headless', 'flaresolverr'],
    stopAfterPreferredFailure: false, // Try other paid providers
    sloTarget: 0.80, // Best-effort
    allowPaid: true,
    timeouts: {
      brightdata: 120000,
      scraping_browser: 120000,
      twocaptcha_datadome: 180000,
    },
  },
  unknown: {
    // Fallback to tier_a behavior
    disabledProviders: [],
    stopAfterPreferredFailure: false,
    sloTarget: 0.95,
    allowPaid: false,
    timeouts: {
      http: 25000,
      headless: 60000,
      flaresolverr: 60000,
    },
  },
};
