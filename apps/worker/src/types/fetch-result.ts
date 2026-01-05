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
  | 'provider_error'
  | 'rate_limited'            // Provider-level rate limit (retry later)
  | 'preferred_unavailable'   // P0: preferredProvider not available (allowPaid=false or disabled)
  | 'interstitial_geo';       // Geo-redirect page (store chooser, ZIP picker) - NOT a provider failure

export type BlockKind =
  | 'cloudflare'
  | 'datadome'
  | 'perimeterx'
  | 'captcha'
  | 'rate_limit'
  | 'interstitial_geo'  // Geo-redirect, store chooser, ZIP picker
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
  // Domain policy: preferred provider for paid-first routing
  preferredProvider?: ProviderId;
  // FlareSolverr wait time after challenge (seconds)
  flareSolverrWaitSeconds?: number;
  // PR4: Domain policy - disabled providers (won't be tried)
  disabledProviders?: ProviderId[];
  // PR4: Stop after preferred provider failure (don't try other providers)
  stopAfterPreferredFailure?: boolean;
  // Geo pinning: ISO 3166-1 alpha-2 country code for BrightData proxy location
  // Use for currency stability (e.g., 'cz' for Czech prices, 'de' for German)
  geoCountry?: string;
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
  /** Geo context used for this fetch (e.g., 'US', 'DE') - critical for currency stability */
  country?: string;
}

export interface IFetchProvider {
  id: ProviderId;
  isPaid: boolean;
  execute(req: FetchRequest): Promise<FetchResult>;
}

/**
 * Cost configuration per provider (PR5: Single source of truth)
 *
 * All provider services should use these values.
 * Prices based on actual provider pricing as of 2026-01.
 */
export const PROVIDER_COSTS: Record<ProviderId, { perRequest: number; description: string }> = {
  http: { perRequest: 0, description: 'Free HTTP fetch' },
  mobile_ua: { perRequest: 0, description: 'Free mobile UA fetch' },
  headless: { perRequest: 0, description: 'Free headless browser' },
  flaresolverr: { perRequest: 0, description: 'Free FlareSolverr' },
  brightdata: { perRequest: 0.0015, description: 'Bright Data Web Unlocker ~$1.50/1000' },
  scraping_browser: { perRequest: 0.01, description: 'Scraping Browser ~$10/1000' },
  twocaptcha_proxy: { perRequest: 0.0007, description: '2captcha proxy ~$0.70/GB' },
  twocaptcha_datadome: { perRequest: 0.00145, description: '2captcha DataDome ~$1.45/1000' },
};
