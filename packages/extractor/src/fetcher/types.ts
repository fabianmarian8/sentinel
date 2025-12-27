// HTTP fetcher types
import type { ErrorCode } from '@sentinel/shared';

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
