// HTTP fetcher types
import type { ErrorCode } from '@sentinel/shared';

/**
 * Screenshot validation result - indicates if content is readable
 */
export interface ScreenshotValidationResult {
  isReadable: boolean;
  issues: string[];
  cookieBannerDetected: boolean;
  overlayDetected: boolean;
  contentBlocked: boolean;
}

export interface FetchResult {
  success: boolean;
  url: string;
  finalUrl: string;  // after redirects
  httpStatus: number | null;
  contentType: string | null;
  html: string | null;
  errorCode: ErrorCode | null;
  errorDetail: string | null;
  timings: {
    dnsLookup?: number;
    connect?: number;
    ttfb?: number;
    total: number;
  };
  headers: Record<string, string>;
  screenshotPath?: string | null;
  // FlareSolverr specific - indicates if CAPTCHA was solved (paid service)
  flareSolverrMessage?: string;
  // Screenshot validation - indicates if screenshot is readable
  screenshotValidation?: ScreenshotValidationResult;
}

export interface FetchOptions {
  url: string;
  timeout?: number;  // default 15000ms
  userAgent?: string;
  headers?: Record<string, string>;
  cookies?: string;
  followRedirects?: boolean;  // default true, max 5
  acceptEncoding?: boolean;  // gzip, deflate, br
}
