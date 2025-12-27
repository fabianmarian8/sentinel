# Block Detection Module

## Overview

The block detection module identifies when websites are blocking our requests through various anti-bot measures. It analyzes HTTP status codes, HTML content, and response headers to determine if access is being restricted.

## Features

- **Multi-layered Detection:** Combines HTTP status, HTML patterns, and header analysis
- **Confidence Scoring:** Returns high/medium/low confidence levels
- **Actionable Recommendations:** Provides specific guidance for each block type
- **ErrorCode Mapping:** Converts block types to standardized error codes

## Block Types

| Block Type | Description | ErrorCode |
|------------|-------------|-----------|
| `captcha` | CAPTCHA challenge detected (reCAPTCHA, hCaptcha) | `BLOCK_CAPTCHA_SUSPECTED` |
| `cloudflare` | Cloudflare browser verification | `BLOCK_CLOUDFLARE_SUSPECTED` |
| `rate_limit` | Rate limiting (429 or content-based) | `BLOCK_RATE_LIMIT_429` |
| `forbidden` | Access forbidden (403) | `BLOCK_FORBIDDEN_403` |
| `bot_detection` | Generic bot detection service | `BLOCK_CAPTCHA_SUSPECTED` |
| `geo_block` | Geographic restriction | `BLOCK_FORBIDDEN_403` |

## Usage

```typescript
import { detectBlock, blockTypeToErrorCode } from '@sentinel/extractor/fetcher';

// Detect blocks from fetch result
const result = fetchHttp({ url: 'https://example.com' });
const blockDetection = detectBlock(
  result.httpStatus,
  result.html,
  result.headers
);

if (blockDetection.blocked) {
  console.log(`Blocked: ${blockDetection.blockType}`);
  console.log(`Confidence: ${blockDetection.confidence}`);
  console.log(`Recommendation: ${blockDetection.recommendation}`);
  
  const errorCode = blockTypeToErrorCode(blockDetection.blockType!);
  // Store errorCode in database
}
```

## Detection Logic

### 1. HTTP Status Detection (Highest Priority)

- **429:** Immediate rate_limit detection (high confidence)
- **403:** Forbidden or Cloudflare (high confidence)
  - Checks for Cloudflare headers (`cf-ray`, `cf-cache-status`)
- **503:** Cloudflare if headers present

### 2. HTML Content Detection

Executes in priority order:

1. **Cloudflare patterns** (highest priority)
   - "checking your browser"
   - "cloudflare"
   - "ray id"
   - "just a moment"

2. **CAPTCHA patterns**
   - "recaptcha", "hcaptcha", "captcha"
   - "verify.*human"
   - "are you a robot"

3. **Rate limit patterns**
   - "too many requests"
   - "rate limit exceeded"

4. **Geo-block patterns**
   - "not available in your country"
   - "geographic restriction"

5. **Bot detection patterns** (only if HTML < 5KB)
   - "access denied"
   - "automated access"
   - "bot detected"

6. **Small HTML + protection headers** (low confidence)
   - HTML < 5KB with Cloudflare/protection headers

### 3. Header Analysis

- **Cloudflare headers:** `cf-ray`, `cf-cache-status`, `cf-request-id`
- **Protection headers:** `x-amz-cf-id`, `x-sucuri-id`, `x-akamai-transformed`

## Recommendations

Each block type provides actionable recommendations:

```typescript
{
  captcha: 'Switch to headless mode with longer wait times',
  cloudflare: 'Use headless mode or reduce request frequency',
  rate_limit: 'Reduce check frequency for this domain',
  forbidden: 'Check if URL requires authentication or try headless mode',
  bot_detection: 'Use headless mode with realistic browser fingerprint',
  geo_block: 'Consider using a proxy from allowed region'
}
```

## Integration with Smart Fetch

The block detection is designed to integrate with the smart fetch layer:

```typescript
// smart-fetch.ts integration example
const httpResult = await fetchHttp(options);
const blockDetection = detectBlock(
  httpResult.httpStatus,
  httpResult.html,
  httpResult.headers
);

if (blockDetection.blocked) {
  if (blockDetection.blockType === 'captcha' || blockDetection.blockType === 'cloudflare') {
    // Automatically retry with headless mode
    return await fetchHeadless({ url: options.url });
  }
  
  // Set appropriate error code
  httpResult.errorCode = blockTypeToErrorCode(blockDetection.blockType);
}
```

## Testing

Comprehensive test coverage (26 tests):

```bash
npm test -- --testPathPattern=block-detection
```

Test categories:
- HTTP status-based detection (6 tests)
- HTML content-based detection (8 tests)
- Priority of detection methods (2 tests)
- Edge cases (4 tests)
- ErrorCode mapping (6 tests)

## Files

```
packages/extractor/src/fetcher/
  block-detection.ts       # Main detection logic (243 lines)
  block-patterns.ts        # Pattern constants (60 lines)
  block-detection.test.ts  # Unit tests (26 tests)
```

## Future Enhancements

- [ ] Machine learning-based block detection
- [ ] Domain-specific heuristics (e.g., Amazon, Google)
- [ ] Historical block rate tracking
- [ ] Automatic strategy adjustment based on block patterns
- [ ] WebDriver detection fingerprinting
