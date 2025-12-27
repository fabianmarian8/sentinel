// User agent pool for HTTP requests

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/**
 * Get a random user agent from the pool
 */
export function getRandomUserAgent(): string {
  const agent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return agent ?? USER_AGENTS[0]!; // Fallback to first agent
}
