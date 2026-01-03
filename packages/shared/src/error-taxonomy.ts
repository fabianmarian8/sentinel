/**
 * Error Taxonomy - Human-readable error messages and recommendations
 *
 * Maps internal error codes to user-friendly messages with actionable suggestions.
 */

import type { ErrorCode } from './domain';

export interface ErrorInfo {
  title: string;
  description: string;
  recommendation: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  retryable: boolean;
}

/**
 * Error taxonomy mapping
 */
export const ERROR_TAXONOMY: Record<ErrorCode, ErrorInfo> = {
  // Fetch errors
  FETCH_TIMEOUT: {
    title: 'Request Timeout',
    description: 'The website took too long to respond.',
    recommendation: 'Try increasing the timeout or check if the website is slow.',
    severity: 'warning',
    retryable: true,
  },
  FETCH_DNS: {
    title: 'DNS Error',
    description: 'Could not resolve the website domain.',
    recommendation: 'Check if the URL is correct and the website exists.',
    severity: 'error',
    retryable: true,
  },
  FETCH_CONNECTION: {
    title: 'Connection Failed',
    description: 'Could not connect to the website.',
    recommendation: 'The website may be down or blocking connections.',
    severity: 'warning',
    retryable: true,
  },
  FETCH_TLS: {
    title: 'SSL/TLS Error',
    description: 'Secure connection could not be established.',
    recommendation: 'The website may have an invalid SSL certificate.',
    severity: 'error',
    retryable: false,
  },
  FETCH_HTTP_4XX: {
    title: 'Client Error',
    description: 'The website returned an error (4xx status).',
    recommendation: 'Check if the URL is correct or if login is required.',
    severity: 'warning',
    retryable: false,
  },
  FETCH_HTTP_5XX: {
    title: 'Server Error',
    description: 'The website is experiencing issues (5xx status).',
    recommendation: 'The website server may be overloaded. Try again later.',
    severity: 'warning',
    retryable: true,
  },

  // Block detection - legacy names
  BLOCK_CAPTCHA_SUSPECTED: {
    title: 'CAPTCHA Detected',
    description: 'Website may require human verification.',
    recommendation: 'Try headless mode or reduce check frequency.',
    severity: 'warning',
    retryable: true,
  },
  BLOCK_CLOUDFLARE_SUSPECTED: {
    title: 'Cloudflare Protection',
    description: 'Website is protected by Cloudflare.',
    recommendation: 'Switch to headless browser mode in fetch settings.',
    severity: 'warning',
    retryable: true,
  },
  BLOCK_FORBIDDEN_403: {
    title: 'Access Forbidden',
    description: 'Website returned 403 Forbidden.',
    recommendation: 'The website may be blocking your access. Try headless mode.',
    severity: 'error',
    retryable: true,
  },
  BLOCK_RATE_LIMIT_429: {
    title: 'Rate Limited',
    description: 'Too many requests to this website.',
    recommendation: 'Reduce check frequency for this domain.',
    severity: 'warning',
    retryable: true,
  },

  // Block detection - new names
  CAPTCHA_BLOCK: {
    title: 'CAPTCHA Required',
    description: 'Website requires human verification.',
    recommendation: 'Try headless mode or reduce check frequency.',
    severity: 'error',
    retryable: false,
  },
  CLOUDFLARE_BLOCK: {
    title: 'Cloudflare Challenge',
    description: 'Website is protected by Cloudflare challenge.',
    recommendation: 'Switch to headless browser mode in fetch settings.',
    severity: 'warning',
    retryable: true,
  },
  RATELIMIT_BLOCK: {
    title: 'Rate Limited',
    description: 'Too many requests to this website.',
    recommendation: 'Reduce check frequency for this domain.',
    severity: 'warning',
    retryable: true,
  },
  GEO_BLOCK: {
    title: 'Geographic Block',
    description: 'Website is not available in your region.',
    recommendation: 'The website restricts access by location.',
    severity: 'error',
    retryable: false,
  },
  BOT_DETECTION: {
    title: 'Bot Detection',
    description: 'Website detected automated access.',
    recommendation: 'Try headless mode with realistic browser settings.',
    severity: 'warning',
    retryable: true,
  },

  // Extraction errors
  EXTRACT_SELECTOR_NOT_FOUND: {
    title: 'Element Not Found',
    description: 'The selector could not find the target element.',
    recommendation: 'The website layout may have changed. Update the selector.',
    severity: 'error',
    retryable: false,
  },
  EXTRACT_EMPTY_VALUE: {
    title: 'Empty Value',
    description: 'The selector found the element but it was empty.',
    recommendation: 'Check if the content loads dynamically. Try headless mode.',
    severity: 'warning',
    retryable: true,
  },
  EXTRACT_PARSE_ERROR: {
    title: 'Parse Error',
    description: 'Could not parse the extracted value.',
    recommendation: 'Check the normalization settings for this rule.',
    severity: 'warning',
    retryable: false,
  },
  EXTRACT_SCHEMA_NOT_FOUND: {
    title: 'No Schema Data',
    description: 'No schema.org JSON-LD or OpenGraph price data found.',
    recommendation: 'The website may not use structured data. Try CSS selector instead.',
    severity: 'error',
    retryable: false,
  },
  EXTRACT_UNSTABLE: {
    title: 'Unstable Extraction',
    description: 'The extracted value changes frequently.',
    recommendation: 'The selector may be matching dynamic content.',
    severity: 'info',
    retryable: false,
  },
  SELECTOR_BROKEN: {
    title: 'Broken Selector',
    description: 'The CSS/XPath selector is invalid or no longer works.',
    recommendation: 'Update the selector to match the current page structure.',
    severity: 'error',
    retryable: false,
  },
  SELECTOR_HEALED: {
    title: 'Selector Auto-Healed',
    description: 'The original selector failed but an alternative was found automatically.',
    recommendation: 'No action needed. The rule is using a backup selector.',
    severity: 'info',
    retryable: false,
  },
  JSON_PATH_BROKEN: {
    title: 'Invalid JSON Path',
    description: 'The JSON path expression is invalid.',
    recommendation: 'Check the JSON structure and update the path.',
    severity: 'error',
    retryable: false,
  },
  PARSE_ERROR: {
    title: 'Parse Error',
    description: 'Could not parse the response data.',
    recommendation: 'The page content format may have changed.',
    severity: 'warning',
    retryable: false,
  },

  // System errors
  SYSTEM_WORKER_CRASH: {
    title: 'System Error',
    description: 'An unexpected error occurred during processing.',
    recommendation: 'This is usually temporary. The system will retry automatically.',
    severity: 'critical',
    retryable: true,
  },
  SYSTEM_QUEUE_DELAY: {
    title: 'Processing Delayed',
    description: 'The job is waiting in queue due to high load.',
    recommendation: 'No action needed. The job will be processed shortly.',
    severity: 'info',
    retryable: true,
  },

  // Unknown
  UNKNOWN: {
    title: 'Unknown Error',
    description: 'An unexpected error occurred.',
    recommendation: 'Please contact support if this persists.',
    severity: 'warning',
    retryable: true,
  },
};

/**
 * Get error info for an error code
 */
export function getErrorInfo(errorCode: string | null): ErrorInfo | null {
  if (!errorCode) return null;
  return ERROR_TAXONOMY[errorCode as ErrorCode] || {
    title: 'Unknown Error',
    description: `Error: ${errorCode}`,
    recommendation: 'Please contact support if this persists.',
    severity: 'warning' as const,
    retryable: true,
  };
}

/**
 * Get user-friendly error message
 */
export function getErrorMessage(errorCode: string | null): string {
  const info = getErrorInfo(errorCode);
  if (!info) return '';
  return `${info.title}: ${info.description}`;
}

/**
 * Get severity color for UI
 */
export function getErrorSeverityColor(severity: ErrorInfo['severity']): string {
  switch (severity) {
    case 'info': return '#3b82f6';     // blue
    case 'warning': return '#f59e0b';  // amber
    case 'error': return '#ef4444';    // red
    case 'critical': return '#dc2626'; // dark red
    default: return '#6b7280';         // gray
  }
}
