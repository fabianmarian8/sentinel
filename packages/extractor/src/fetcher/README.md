# Fetcher Module

High-performance fetching system with HTTP-first approach and automatic headless browser fallback.

## Overview

The fetcher module provides three levels of fetching:

1. **`fetchHttp`** - Fast HTTP-only fetching using undici
2. **`fetchHeadless`** - Headless browser fetching using Playwright
3. **`smartFetch`** - Intelligent fetcher that tries HTTP first and falls back to headless when needed (RECOMMENDED)

## Quick Start

```typescript
import { smartFetch } from '@sentinel/extractor';

const result = await smartFetch({
  url: 'https://example.com',
});

console.log('Mode used:', result.modeUsed); // 'http' or 'headless'
console.log('Fallback triggered:', result.fallbackTriggered);
console.log('HTML:', result.html);
```

---

# Smart Fetch (Recommended)

Intelligent fetcher with automatic HTTP-to-headless fallback.

## When to Use

- **Default choice** for most fetching needs
- Automatically handles:
  - JavaScript-rendered pages (SPAs)
  - Cloudflare challenges
  - Bot detection
  - Rate limiting
  - CAPTCHA detection

## Features

- HTTP-first for speed
- Automatic fallback to headless on:
  - Fetch failures
  - Block detection (Cloudflare, CAPTCHA, rate limits)
  - JavaScript-required pages (React, Vue, Angular apps)
- Configurable behavior
- Detailed fallback reasoning

## Usage

### Basic Usage

```typescript
import { smartFetch } from '@sentinel/extractor';

const result = await smartFetch({
  url: 'https://example.com',
});

if (result.success) {
  console.log('HTML:', result.html);
  console.log('Used:', result.modeUsed); // 'http' or 'headless'

  if (result.fallbackTriggered) {
    console.log('Why fallback:', result.fallbackReason);
  }
}
```

### Force Headless Mode

For sites you know require JavaScript:

```typescript
const result = await smartFetch({
  url: 'https://react-app.example.com',
  preferredMode: 'headless', // Skip HTTP entirely
  renderWaitMs: 3000,
});
```

### Disable Fallback (HTTP-only)

```typescript
const result = await smartFetch({
  url: 'https://example.com',
  fallbackToHeadless: false, // Never fallback
});
```

### Custom Headless Options

```typescript
const result = await smartFetch({
  url: 'https://example.com',
  // These only apply if headless is used
  renderWaitMs: 5000,
  waitForSelector: '.main-content',
  screenshotOnChange: true,
  screenshotPath: '/tmp/screenshot.png',
});
```

## Fallback Triggers

Smart fetch automatically falls back to headless when:

1. **HTTP fetch fails** - timeout, DNS, connection errors
2. **Block detected** - Cloudflare, CAPTCHA, rate limit, bot detection
3. **JavaScript required** - SPA frameworks (React, Vue, Angular)

## API

### SmartFetchOptions

```typescript
interface SmartFetchOptions extends FetchOptions {
  // Fallback behavior
  fallbackToHeadless?: boolean;  // default: true
  preferredMode?: 'http' | 'headless' | 'auto';  // default: 'auto'

  // Headless options (used if fallback triggered)
  renderWaitMs?: number;
  waitForSelector?: string;
  screenshotOnChange?: boolean;
  screenshotPath?: string;
}
```

### SmartFetchResult

```typescript
interface SmartFetchResult extends FetchResult {
  modeUsed: 'http' | 'headless';
  fallbackTriggered: boolean;
  fallbackReason?: string;
}
```

---

# Headless Browser Fetcher

Playwright-based headless browser fetcher for JavaScript-rendered pages and anti-bot protection.

## When to Use

- **JavaScript-rendered pages** - React, Vue, Angular, Next.js apps
- **Anti-bot protection** - Cloudflare, bot detection requiring real browser
- **Client-side rendering** - Pages that need JavaScript execution
- **Screenshots needed** - Capture visual state of pages
- **Cookie-based sessions** - Complex authentication flows

## Features

- Singleton browser instance for performance
- Automatic resource blocking (images, fonts, stylesheets)
- Screenshot capture on demand
- Cookie support
- Custom selector wait
- Configurable render wait times
- Comprehensive error handling

## Usage

### Basic Usage

```typescript
import { fetchHeadless } from '@sentinel/extractor';

const result = await fetchHeadless({
  url: 'https://react-app.example.com',
});

if (result.success) {
  console.log('HTML:', result.html);
  console.log('Final URL:', result.finalUrl);
  console.log('Timing:', result.timings.total);
}
```

### With Render Wait

Wait for JavaScript to finish rendering:

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  renderWaitMs: 3000,  // Wait 3s after page load
});
```

### Wait for Specific Element

Wait for a specific element to appear:

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  waitForSelector: '.product-details',  // Wait for this element
  renderWaitMs: 2000,
});
```

### Block Resources for Speed

Block images, stylesheets, fonts, and media to speed up fetching:

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  blockResources: ['image', 'stylesheet', 'font', 'media'],
});
```

### Capture Screenshot

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  screenshotOnChange: true,
  screenshotPath: '/tmp/screenshot.png',
  renderWaitMs: 2000,
});

if (result.success && result.screenshotPath) {
  console.log('Screenshot saved to:', result.screenshotPath);
}
```

### Set Cookies

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  cookies: [
    { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
    { name: 'auth_token', value: 'xyz789', domain: '.example.com', path: '/' }
  ],
});
```

### Custom User Agent

```typescript
import { fetchHeadless, getRandomUserAgent } from '@sentinel/extractor';

const result = await fetchHeadless({
  url: 'https://example.com',
  userAgent: getRandomUserAgent(),
});
```

### Full Configuration

```typescript
const result = await fetchHeadless({
  url: 'https://example.com/product',
  timeout: 30000,                    // 30s timeout (default)
  userAgent: 'CustomBot/1.0',
  renderWaitMs: 3000,                // Wait 3s after load
  waitForSelector: '.main-content',  // Wait for element
  screenshotOnChange: true,
  screenshotPath: '/tmp/capture.png',
  blockResources: ['image', 'font'], // Block images and fonts
  cookies: [
    { name: 'session', value: 'abc', domain: '.example.com', path: '/' }
  ],
});
```

## API

### HeadlessFetchOptions

```typescript
interface HeadlessFetchOptions extends Omit<FetchOptions, 'cookies'> {
  renderWaitMs?: number;      // Wait after page load (default 2000ms)
  waitForSelector?: string;   // Wait for specific element
  screenshotOnChange?: boolean;
  screenshotPath?: string;
  blockResources?: ('image' | 'stylesheet' | 'font' | 'media')[];
  cookies?: {
    name: string;
    value: string;
    domain: string;
    path?: string;
  }[];
}
```

## Browser Lifecycle

The headless fetcher uses a **singleton browser instance** for performance:

- Browser is launched on first use
- Shared across all requests in the same process
- Each request gets a fresh browser context
- Automatically cleaned up on process exit

### Manual Cleanup

```typescript
import { closeBrowser } from '@sentinel/extractor';

// Clean up browser manually if needed
await closeBrowser();
```

## Error Codes

Same as HTTP fetcher:

- `FETCH_TIMEOUT` - Page load timeout
- `FETCH_DNS` - DNS resolution failed
- `FETCH_CONNECTION` - Connection failed

## Performance Tips

1. **Block Resources** - Use `blockResources` to skip images/fonts/media
2. **Minimize Wait Time** - Only use `renderWaitMs` when necessary
3. **Specific Selectors** - Use `waitForSelector` instead of fixed waits when possible
4. **Reuse Browser** - The singleton pattern already handles this

## Examples

### SPA Fetching

```typescript
const result = await fetchHeadless({
  url: 'https://react-app.example.com',
  renderWaitMs: 2000,
  blockResources: ['image', 'font', 'media'],
});
```

### With Screenshot on Error

```typescript
const result = await fetchHeadless({
  url: 'https://example.com',
  screenshotOnChange: true,
  screenshotPath: '/tmp/error-screenshot.png',
});

if (!result.success) {
  console.log('Error occurred, screenshot saved to:', result.screenshotPath);
}
```

### Authenticated Session

```typescript
const result = await fetchHeadless({
  url: 'https://example.com/dashboard',
  cookies: [
    { name: 'session', value: 'session-token', domain: '.example.com', path: '/' }
  ],
  renderWaitMs: 3000,
  waitForSelector: '.dashboard-content',
});
```

## Browser Configuration

The browser is launched with these flags for optimal performance and compatibility:

- `--no-sandbox` - Disable sandbox for containerized environments
- `--disable-setuid-sandbox` - Disable setuid sandbox
- `--disable-dev-shm-usage` - Use /tmp instead of /dev/shm
- `--disable-accelerated-2d-canvas` - Disable 2D canvas acceleration
- `--disable-gpu` - Disable GPU acceleration

Default viewport: 1920x1080

---

# HTTP Fetcher

High-performance HTTP fetcher using undici with comprehensive error handling and timing capture.

## Features

- Fast HTTP requests using undici
- Automatic redirect handling (max 5 redirects)
- Compression support (gzip, deflate, brotli)
- User-Agent rotation
- Detailed timing information (DNS, connect, TTFB, total)
- Comprehensive error classification
- Custom headers and cookies support

## Usage

### Basic usage

```typescript
import { fetchHttp } from '@sentinel/extractor';

const result = await fetchHttp({
  url: 'https://example.com',
});

if (result.success) {
  console.log('HTML:', result.html);
  console.log('Status:', result.httpStatus);
  console.log('Final URL:', result.finalUrl);
  console.log('Timing:', result.timings);
} else {
  console.error('Error:', result.errorCode, result.errorDetail);
}
```

### Custom options

```typescript
const result = await fetchHttp({
  url: 'https://example.com/product',
  timeout: 10000,  // 10s timeout
  userAgent: 'CustomBot/1.0',
  headers: {
    'Accept-Language': 'en-US',
  },
  cookies: 'session=abc123; token=xyz789',
  followRedirects: true,
  acceptEncoding: true,
});
```

### With random User-Agent

```typescript
import { fetchHttp, getRandomUserAgent } from '@sentinel/extractor';

const result = await fetchHttp({
  url: 'https://example.com',
  userAgent: getRandomUserAgent(),
});
```

## Error Codes

The fetcher returns specific error codes for different failure scenarios:

- `FETCH_TIMEOUT` - Request exceeded timeout limit
- `FETCH_DNS` - DNS resolution failed
- `FETCH_CONNECTION` - Connection failed (refused, reset, unreachable)
- `FETCH_HTTP_4XX` - HTTP 4xx client error
- `FETCH_HTTP_5XX` - HTTP 5xx server error

## Response Structure

```typescript
interface FetchResult {
  success: boolean;
  url: string;                    // Original URL
  finalUrl: string;               // After redirects
  httpStatus: number | null;      // HTTP status code
  contentType: string | null;     // Content-Type header
  html: string | null;            // Response body
  errorCode: ErrorCode | null;    // Error classification
  errorDetail: string | null;     // Human-readable error
  timings: {
    dnsLookup?: number;           // DNS lookup time (ms)
    connect?: number;             // Connection time (ms)
    ttfb?: number;                // Time to first byte (ms)
    total: number;                // Total request time (ms)
  };
  headers: Record<string, string>; // Response headers
}
```

## Timing Information

The fetcher captures detailed timing information:

- `total` - Always available, end-to-end request time
- `dnsLookup` - Time spent on DNS resolution (if applicable)
- `connect` - Time spent establishing connection (if applicable)
- `ttfb` - Time to first byte (if applicable)

Note: Some timing details may not be available depending on the request flow and undici's internal handling.

## User-Agent Pool

By default, the fetcher rotates through these User-Agents:

- Chrome on Windows 10
- Chrome on macOS
- Firefox on Windows 10

Use `getRandomUserAgent()` to get a random one, or provide your own.

## Performance

- Uses undici for optimal HTTP performance
- Automatic connection pooling
- Efficient memory usage
- Supports HTTP/1.1 and HTTP/2

## Examples

### Handling errors

```typescript
const result = await fetchHttp({ url: 'https://example.com' });

switch (result.errorCode) {
  case 'FETCH_TIMEOUT':
    console.log('Request timed out, retry later');
    break;
  case 'FETCH_DNS':
    console.log('Invalid domain or DNS issue');
    break;
  case 'FETCH_CONNECTION':
    console.log('Connection failed, check network');
    break;
  case 'FETCH_HTTP_4XX':
    console.log('Client error:', result.httpStatus);
    break;
  case 'FETCH_HTTP_5XX':
    console.log('Server error:', result.httpStatus);
    break;
  case null:
    console.log('Success!');
    break;
}
```

### With retry logic

```typescript
async function fetchWithRetry(url: string, maxRetries = 3): Promise<FetchResult> {
  for (let i = 0; i < maxRetries; i++) {
    const result = await fetchHttp({ url });

    if (result.success) {
      return result;
    }

    // Retry only on transient errors
    if (result.errorCode === 'FETCH_TIMEOUT' ||
        result.errorCode === 'FETCH_CONNECTION' ||
        result.errorCode === 'FETCH_HTTP_5XX') {
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      continue;
    }

    // Don't retry on client errors or DNS failures
    return result;
  }

  return await fetchHttp({ url });
}
```
