/**
 * FlareSolverr fetcher for bypassing Cloudflare protection
 *
 * FlareSolverr is a proxy server that uses a real browser to solve
 * Cloudflare challenges and return the page HTML.
 *
 * @see https://github.com/FlareSolverr/FlareSolverr
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { FetchResult, FetchOptions } from './types';

export interface FlareSolverrOptions extends FetchOptions {
  /**
   * FlareSolverr endpoint URL (default: http://localhost:8191/v1)
   */
  flareSolverrUrl?: string;

  /**
   * Maximum timeout for FlareSolverr request in ms (default: 60000)
   */
  maxTimeout?: number;

  /**
   * Request screenshot from FlareSolverr (returns base64 PNG)
   */
  returnScreenshot?: boolean;

  /**
   * Path to save screenshot file (if returnScreenshot is true)
   */
  screenshotPath?: string;

  /**
   * Use persistent session (remembers solved challenges)
   * If true, uses domain-based session name automatically
   */
  useSession?: boolean;

  /**
   * Custom session name (overrides auto-generated domain-based name)
   */
  sessionName?: string;
}

export interface FlareSolverrResponse {
  status: 'ok' | 'error';
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
  solution?: {
    url: string;
    status: number;
    headers: Record<string, string>;
    response: string; // HTML content
    cookies: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: string;
    }>;
    userAgent: string;
    screenshot?: string; // Base64 PNG when returnScreenshot=true
  };
}

const DEFAULT_FLARESOLVERR_URL = 'http://localhost:8191/v1';
const DEFAULT_MAX_TIMEOUT = 120000; // Increased for complex challenges

// Track active sessions to avoid creating duplicates
const activeSessions = new Set<string>();

/**
 * Create or get session name from URL domain
 */
function getSessionName(url: string): string {
  try {
    const domain = new URL(url).hostname.replace(/\./g, '_');
    return `sentinel_${domain}`;
  } catch {
    return 'sentinel_default';
  }
}

/**
 * Ensure FlareSolverr session exists for domain
 */
async function ensureSession(
  sessionName: string,
  flareSolverrUrl: string
): Promise<boolean> {
  // Skip if we already created this session in this process
  if (activeSessions.has(sessionName)) {
    return true;
  }

  try {
    // Try to create session (will fail if exists, but that's ok)
    const response = await fetch(flareSolverrUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'sessions.create',
        session: sessionName,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (data.status === 'ok' || data.message?.includes('already exists')) {
      activeSessions.add(sessionName);
      console.log(`[FlareSolverr] Session ready: ${sessionName}`);
      return true;
    }

    console.log(`[FlareSolverr] Session creation response: ${data.message}`);
    activeSessions.add(sessionName); // Mark as tried
    return true;
  } catch (err) {
    console.error(`[FlareSolverr] Failed to create session: ${err}`);
    return false;
  }
}

/**
 * Fetch URL using FlareSolverr proxy to bypass Cloudflare protection
 */
export async function fetchFlareSolverr(
  options: FlareSolverrOptions
): Promise<FetchResult> {
  const flareSolverrUrl = options.flareSolverrUrl || DEFAULT_FLARESOLVERR_URL;
  const maxTimeout = options.maxTimeout || DEFAULT_MAX_TIMEOUT;
  const startTime = Date.now();

  // Always use sessions for better challenge solving
  const useSession = options.useSession !== false; // Default true
  const sessionName = options.sessionName || getSessionName(options.url);

  console.log(`[FlareSolverr] Fetching ${options.url}${useSession ? ` (session: ${sessionName})` : ''}`);

  try {
    // Ensure session exists if using sessions
    if (useSession) {
      await ensureSession(sessionName, flareSolverrUrl);
    }

    const requestBody: Record<string, unknown> = {
      cmd: 'request.get',
      url: options.url,
      maxTimeout: maxTimeout,
    };

    // Add session if enabled
    if (useSession) {
      requestBody.session = sessionName;
    }

    // Add optional headers
    if (options.headers) {
      requestBody.headers = options.headers;
    }

    // Add cookies if provided
    if (options.cookies) {
      requestBody.cookies = parseCookieString(options.cookies);
    }

    // Request screenshot if enabled
    if (options.returnScreenshot) {
      requestBody.returnScreenshot = true;
    }

    const response = await fetch(flareSolverrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(maxTimeout + 10000), // Extra 10s buffer
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FlareSolverr] HTTP error ${response.status}: ${errorText}`);
      return createErrorResult(
        options.url,
        'FETCH_NETWORK_ERROR',
        `FlareSolverr HTTP error: ${response.status}`,
        Date.now() - startTime
      );
    }

    const data: FlareSolverrResponse = await response.json();

    if (data.status !== 'ok' || !data.solution) {
      console.error(`[FlareSolverr] Error: ${data.message}`);
      return createErrorResult(
        options.url,
        'BLOCK_CLOUDFLARE',
        `FlareSolverr failed: ${data.message}`,
        Date.now() - startTime
      );
    }

    const totalTime = Date.now() - startTime;
    console.log(
      `[FlareSolverr] Success for ${options.url} (${data.solution.response.length} bytes, ${totalTime}ms)`
    );

    // Handle screenshot if present
    let screenshotPath: string | undefined;
    if (data.solution.screenshot && options.screenshotPath) {
      try {
        // Ensure directory exists
        const dir = path.dirname(options.screenshotPath);
        await fs.mkdir(dir, { recursive: true });

        // Decode base64 and save
        const screenshotBuffer = Buffer.from(data.solution.screenshot, 'base64');
        await fs.writeFile(options.screenshotPath, screenshotBuffer);
        screenshotPath = options.screenshotPath;
        console.log(`[FlareSolverr] Screenshot saved to ${options.screenshotPath}`);
      } catch (err) {
        console.error(`[FlareSolverr] Failed to save screenshot: ${err}`);
      }
    }

    // Convert cookies to header format for potential reuse
    const cookieHeader = data.solution.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    return {
      success: true,
      url: options.url,
      finalUrl: data.solution.url,
      httpStatus: data.solution.status,
      contentType: data.solution.headers['content-type'] || null,
      html: data.solution.response,
      errorCode: null,
      errorDetail: null,
      timings: {
        total: totalTime,
        ttfb: data.endTimestamp - data.startTimestamp,
      },
      headers: {
        ...data.solution.headers,
        'x-flaresolverr-cookies': cookieHeader,
        'x-flaresolverr-user-agent': data.solution.userAgent,
      },
      screenshotPath,
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(`[FlareSolverr] Error: ${errorMessage}`);

    // Check if it's a connection error (FlareSolverr not running)
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('fetch failed')) {
      return createErrorResult(
        options.url,
        'FETCH_NETWORK_ERROR',
        'FlareSolverr not available (connection refused)',
        totalTime
      );
    }

    // Timeout error
    if (errorMessage.includes('timeout') || errorMessage.includes('abort')) {
      return createErrorResult(
        options.url,
        'FETCH_TIMEOUT',
        `FlareSolverr timeout after ${maxTimeout}ms`,
        totalTime
      );
    }

    return createErrorResult(
      options.url,
      'FETCH_NETWORK_ERROR',
      `FlareSolverr error: ${errorMessage}`,
      totalTime
    );
  }
}

/**
 * Check if FlareSolverr is available
 */
export async function isFlareSolverrAvailable(
  flareSolverrUrl: string = DEFAULT_FLARESOLVERR_URL
): Promise<boolean> {
  try {
    // Remove /v1 suffix for health check
    const baseUrl = flareSolverrUrl.replace(/\/v1\/?$/, '');
    const response = await fetch(baseUrl, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data.msg === 'FlareSolverr is ready!';
  } catch {
    return false;
  }
}

/**
 * Destroy a FlareSolverr session
 */
export async function destroySession(
  sessionName: string,
  flareSolverrUrl: string = DEFAULT_FLARESOLVERR_URL
): Promise<boolean> {
  try {
    const response = await fetch(flareSolverrUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: 'sessions.destroy',
        session: sessionName,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();
    activeSessions.delete(sessionName);
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * List all active FlareSolverr sessions
 */
export async function listSessions(
  flareSolverrUrl: string = DEFAULT_FLARESOLVERR_URL
): Promise<string[]> {
  try {
    const response = await fetch(flareSolverrUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'sessions.list' }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();
    return data.sessions || [];
  } catch {
    return [];
  }
}

/**
 * Parse cookie string into array format for FlareSolverr
 */
function parseCookieString(
  cookieStr: string
): Array<{ name: string; value: string }> {
  return cookieStr.split(';').map((cookie) => {
    const parts = cookie.trim().split('=');
    const name = parts[0] || '';
    const value = parts.slice(1).join('=');
    return {
      name: name.trim(),
      value: value.trim(),
    };
  });
}

/**
 * Helper to create error result
 */
function createErrorResult(
  url: string,
  errorCode: string,
  errorDetail: string,
  totalTime: number
): FetchResult {
  return {
    success: false,
    url,
    finalUrl: url,
    httpStatus: null,
    contentType: null,
    html: null,
    errorCode: errorCode as any,
    errorDetail,
    timings: { total: totalTime },
    headers: {},
  };
}
