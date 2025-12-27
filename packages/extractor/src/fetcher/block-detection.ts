// Block detection logic for identifying when websites block our requests
import type { ErrorCode } from '@sentinel/shared';
import {
  CAPTCHA_PATTERNS,
  CLOUDFLARE_PATTERNS,
  BOT_DETECTION_PATTERNS,
  GEO_BLOCK_PATTERNS,
  RATE_LIMIT_PATTERNS,
  MIN_NORMAL_HTML_SIZE,
  CLOUDFLARE_HEADERS,
  PROTECTION_HEADERS,
} from './block-patterns';

export type BlockType =
  | 'captcha'
  | 'cloudflare'
  | 'rate_limit'
  | 'forbidden'
  | 'bot_detection'
  | 'geo_block';

export interface BlockDetectionResult {
  blocked: boolean;
  blockType: BlockType | null;
  confidence: 'high' | 'medium' | 'low';
  recommendation: string | null;
}

/**
 * Detect if a website is blocking our request based on HTTP status, HTML content, and headers
 */
export function detectBlock(
  httpStatus: number | null,
  html: string | null,
  headers: Record<string, string>
): BlockDetectionResult {
  // Check HTTP status-based detection first (highest confidence)
  const statusDetection = detectByStatus(httpStatus, headers);
  if (statusDetection.blocked) {
    return statusDetection;
  }

  // Check content-based detection
  if (html) {
    const contentDetection = detectByContent(html, headers);
    if (contentDetection.blocked) {
      return contentDetection;
    }
  }

  // No block detected
  return {
    blocked: false,
    blockType: null,
    confidence: 'high',
    recommendation: null,
  };
}

/**
 * Detect blocks based on HTTP status code
 */
function detectByStatus(
  httpStatus: number | null,
  headers: Record<string, string>
): BlockDetectionResult {
  if (httpStatus === null) {
    return { blocked: false, blockType: null, confidence: 'high', recommendation: null };
  }

  // 429 - Rate limit (high confidence)
  if (httpStatus === 429) {
    return {
      blocked: true,
      blockType: 'rate_limit',
      confidence: 'high',
      recommendation: getRecommendation('rate_limit'),
    };
  }

  // 403 - Forbidden (high confidence, but check if it's Cloudflare)
  if (httpStatus === 403) {
    const isCloudflare = hasCloudflareHeaders(headers);
    return {
      blocked: true,
      blockType: isCloudflare ? 'cloudflare' : 'forbidden',
      confidence: 'high',
      recommendation: getRecommendation(isCloudflare ? 'cloudflare' : 'forbidden'),
    };
  }

  // 503 - Service unavailable (check if Cloudflare)
  if (httpStatus === 503) {
    const isCloudflare = hasCloudflareHeaders(headers);
    if (isCloudflare) {
      return {
        blocked: true,
        blockType: 'cloudflare',
        confidence: 'high',
        recommendation: getRecommendation('cloudflare'),
      };
    }
  }

  return { blocked: false, blockType: null, confidence: 'high', recommendation: null };
}

/**
 * Detect blocks based on HTML content
 */
function detectByContent(
  html: string,
  headers: Record<string, string>
): BlockDetectionResult {
  const htmlSize = Buffer.byteLength(html, 'utf8');

  // Check for Cloudflare patterns (highest priority)
  if (matchesPatterns(html, CLOUDFLARE_PATTERNS)) {
    return {
      blocked: true,
      blockType: 'cloudflare',
      confidence: hasCloudflareHeaders(headers) ? 'high' : 'medium',
      recommendation: getRecommendation('cloudflare'),
    };
  }

  // Check for CAPTCHA patterns
  if (matchesPatterns(html, CAPTCHA_PATTERNS)) {
    return {
      blocked: true,
      blockType: 'captcha',
      confidence: 'high',
      recommendation: getRecommendation('captcha'),
    };
  }

  // Check for rate limit patterns
  if (matchesPatterns(html, RATE_LIMIT_PATTERNS)) {
    return {
      blocked: true,
      blockType: 'rate_limit',
      confidence: 'medium',
      recommendation: getRecommendation('rate_limit'),
    };
  }

  // Check for geo-block patterns
  if (matchesPatterns(html, GEO_BLOCK_PATTERNS)) {
    return {
      blocked: true,
      blockType: 'geo_block',
      confidence: 'high',
      recommendation: getRecommendation('geo_block'),
    };
  }

  // Check for bot detection patterns (only if HTML is small)
  if (htmlSize < MIN_NORMAL_HTML_SIZE && matchesPatterns(html, BOT_DETECTION_PATTERNS)) {
    return {
      blocked: true,
      blockType: 'bot_detection',
      confidence: 'medium',
      recommendation: getRecommendation('bot_detection'),
    };
  }

  // Small HTML with protection headers suggests blocking
  if (htmlSize < MIN_NORMAL_HTML_SIZE && hasProtectionHeaders(headers)) {
    return {
      blocked: true,
      blockType: hasCloudflareHeaders(headers) ? 'cloudflare' : 'bot_detection',
      confidence: 'low',
      recommendation: getRecommendation('bot_detection'),
    };
  }

  return { blocked: false, blockType: null, confidence: 'high', recommendation: null };
}

/**
 * Check if headers contain Cloudflare signatures
 */
function hasCloudflareHeaders(headers: Record<string, string>): boolean {
  const lowerHeaders = Object.keys(headers).map(k => k.toLowerCase());
  return CLOUDFLARE_HEADERS.some(header => lowerHeaders.includes(header));
}

/**
 * Check if headers contain any protection service signatures
 */
function hasProtectionHeaders(headers: Record<string, string>): boolean {
  const lowerHeaders = Object.keys(headers).map(k => k.toLowerCase());
  return [...CLOUDFLARE_HEADERS, ...PROTECTION_HEADERS].some(header =>
    lowerHeaders.includes(header)
  );
}

/**
 * Check if HTML matches any of the provided patterns
 */
function matchesPatterns(html: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(html));
}

/**
 * Get recommendation based on block type
 */
function getRecommendation(blockType: BlockType): string {
  switch (blockType) {
    case 'captcha':
      return 'Switch to headless mode with longer wait times';
    case 'cloudflare':
      return 'Use headless mode or reduce request frequency';
    case 'rate_limit':
      return 'Reduce check frequency for this domain';
    case 'forbidden':
      return 'Check if URL requires authentication or try headless mode';
    case 'bot_detection':
      return 'Use headless mode with realistic browser fingerprint';
    case 'geo_block':
      return 'Consider using a proxy from allowed region';
  }
}

/**
 * Map block type to ErrorCode
 */
export function blockTypeToErrorCode(blockType: BlockType): ErrorCode {
  switch (blockType) {
    case 'captcha':
      return 'BLOCK_CAPTCHA_SUSPECTED';
    case 'cloudflare':
      return 'BLOCK_CLOUDFLARE_SUSPECTED';
    case 'rate_limit':
      return 'BLOCK_RATE_LIMIT_429';
    case 'forbidden':
      return 'BLOCK_FORBIDDEN_403';
    case 'bot_detection':
      return 'BLOCK_CAPTCHA_SUSPECTED'; // generic fallback
    case 'geo_block':
      return 'BLOCK_FORBIDDEN_403'; // closest match
  }
}
