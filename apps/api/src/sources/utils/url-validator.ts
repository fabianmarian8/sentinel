import { promises as dns } from 'dns';

/**
 * Result of URL validation
 */
export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  resolvedIps?: string[];
}

/**
 * Private IP ranges that should be blocked (SSRF protection)
 */
const PRIVATE_IP_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255', name: 'Private A (10.x)' },
  { start: '172.16.0.0', end: '172.31.255.255', name: 'Private B (172.16-31.x)' },
  { start: '192.168.0.0', end: '192.168.255.255', name: 'Private C (192.168.x)' },
  { start: '127.0.0.0', end: '127.255.255.255', name: 'Loopback (localhost)' },
  { start: '169.254.0.0', end: '169.254.255.255', name: 'Link-local / AWS metadata' },
  { start: '0.0.0.0', end: '0.255.255.255', name: 'This network' },
  { start: '224.0.0.0', end: '239.255.255.255', name: 'Multicast' },
  { start: '240.0.0.0', end: '255.255.255.255', name: 'Reserved/Broadcast' },
];

/**
 * Blocked hostnames for SSRF protection
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data.ec2.internal',
  'kubernetes.default.svc',
];

/**
 * Allowed URL protocols
 */
const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * Convert IP address string to number for range comparison
 */
function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    (parts[0] || 0) * 16777216 + // 2^24
    (parts[1] || 0) * 65536 + // 2^16
    (parts[2] || 0) * 256 + // 2^8
    (parts[3] || 0)
  );
}

/**
 * Check if IP is in a private range
 */
function isPrivateIp(ip: string): { blocked: boolean; range?: string } {
  const ipNum = ipToNumber(ip);

  for (const range of PRIVATE_IP_RANGES) {
    const startNum = ipToNumber(range.start);
    const endNum = ipToNumber(range.end);

    if (ipNum >= startNum && ipNum <= endNum) {
      return { blocked: true, range: range.name };
    }
  }

  return { blocked: false };
}

/**
 * Check if hostname is blocked
 */
function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return BLOCKED_HOSTNAMES.some((blocked) => h === blocked || h.endsWith('.' + blocked));
}

/**
 * Validate IP address format (basic check)
 */
function isValidIpFormat(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    const num = Number(part);
    return !isNaN(num) && num >= 0 && num <= 255;
  });
}

/**
 * Synchronous basic URL validation (no DNS resolution)
 * Use this for quick checks before async validation
 */
export function isPublicUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(urlObj.protocol)) {
      return false;
    }

    const hostname = urlObj.hostname.toLowerCase();

    // Block IPv6 literals
    if (hostname === '[::1]' || hostname.startsWith('[')) {
      return false;
    }

    // Check blocked hostnames
    if (isBlockedHostname(hostname)) {
      return false;
    }

    // If hostname is an IP, check if it's private
    if (isValidIpFormat(hostname)) {
      const { blocked } = isPrivateIp(hostname);
      return !blocked;
    }

    // Hostname looks OK (but still needs DNS validation)
    return true;
  } catch {
    return false;
  }
}

/**
 * Asynchronous URL validation with DNS resolution
 * This prevents DNS rebinding attacks by resolving the hostname
 * and checking if the resolved IPs are private
 */
export async function validateUrl(url: string): Promise<UrlValidationResult> {
  // Basic URL parsing
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return {
      valid: false,
      reason: 'Invalid URL format',
    };
  }

  // Check protocol
  if (!ALLOWED_PROTOCOLS.includes(urlObj.protocol)) {
    return {
      valid: false,
      reason: `Protocol ${urlObj.protocol} not allowed. Only http: and https: are permitted.`,
    };
  }

  const hostname = urlObj.hostname.toLowerCase();

  // Block IPv6 literals
  if (hostname === '[::1]' || hostname.startsWith('[')) {
    return {
      valid: false,
      reason: 'IPv6 addresses are not supported for security reasons',
    };
  }

  // Check blocked hostnames
  if (isBlockedHostname(hostname)) {
    return {
      valid: false,
      reason: `Hostname "${hostname}" is blocked for security reasons`,
    };
  }

  // If hostname is an IP address, check if it's private
  if (isValidIpFormat(hostname)) {
    const { blocked, range } = isPrivateIp(hostname);
    if (blocked) {
      return {
        valid: false,
        reason: `IP address ${hostname} is in private range: ${range}`,
        resolvedIps: [hostname],
      };
    }
    // Public IP - valid
    return {
      valid: true,
      resolvedIps: [hostname],
    };
  }

  // Resolve hostname to IP addresses (DNS resolution)
  let resolvedIps: string[];
  try {
    // Use dns.resolve4 for IPv4 addresses
    resolvedIps = await dns.resolve4(hostname);
  } catch (error) {
    // DNS resolution failed
    return {
      valid: false,
      reason: `Failed to resolve hostname "${hostname}". The domain may not exist or DNS is unavailable.`,
    };
  }

  // Note: We only use IPv4 (resolve4) for fetching.
  // Having IPv6 records is fine - we simply ignore them and use IPv4.

  // Check if any resolved IP is private
  for (const ip of resolvedIps) {
    const { blocked, range } = isPrivateIp(ip);
    if (blocked) {
      return {
        valid: false,
        reason: `Hostname "${hostname}" resolves to private IP ${ip} (${range}). This is blocked for security reasons.`,
        resolvedIps,
      };
    }
  }

  // All checks passed
  return {
    valid: true,
    resolvedIps,
  };
}
