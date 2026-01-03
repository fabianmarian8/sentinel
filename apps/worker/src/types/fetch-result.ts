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
  // Domain policy: preferred provider for paid-first routing
  preferredProvider?: ProviderId;
  // FlareSolverr wait time after challenge (seconds)
  flareSolverrWaitSeconds?: number;
  // PR4: Domain policy - disabled providers (won't be tried)
  disabledProviders?: ProviderId[];
  // PR4: Stop after preferred provider failure (don't try other providers)
  stopAfterPreferredFailure?: boolean;
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
