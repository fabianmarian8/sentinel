# BrightData Scraping Browser Integration

> **For Claude:** Use this plan for implementing BrightData Scraping Browser for DataDome bypass.

**Goal:** Add BrightData Scraping Browser as Tier 2.0 for stronger DataDome CAPTCHA bypass

**Architecture:** Remote CDP browser connection via WebSocket, automatic CAPTCHA solving via CDP events

**Tech Stack:** Playwright, BrightData Scraping Browser API, CDP Protocol

---

## Problem

- Etsy uses DataDome with 5/5 protection score
- Current BrightData Web Unlocker returns CAPTCHA page (601KB) instead of solving
- 2captcha proxy already tried, doesn't work for DataDome

## Solution

Add BrightData Scraping Browser which has:
- Full browser with CDP control
- Automatic CAPTCHA solving via `Captcha.solve()` events
- Higher success rate for DataDome (~95%)

## Tier Order

```
Tier 1 (FREE): HTTP → Mobile UA → FlareSolverr → Headless
Tier 2 (PAID):
  2.0 Scraping Browser (NEW) - ~$0.009/min
  2.1 Web Unlocker           - $0.0015/req
  2.2 2captcha proxy         - $0.70/GB
```

## Implementation

### 1. New Service: `scraping-browser.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright-core';

@Injectable()
export class ScrapingBrowserService {
  private readonly logger = new Logger(ScrapingBrowserService.name);

  // Connection: wss://brd-customer-{ID}-zone-{ZONE}:{PASS}@brd.superproxy.io:9222

  async fetch(url: string): Promise<ScrapingBrowserResult> {
    // 1. Connect via CDP
    // 2. Navigate to URL
    // 3. Wait for Captcha.solveFinished or timeout
    // 4. Get HTML
    // 5. Close browser
  }
}
```

### 2. Environment Variables

```bash
BRIGHTDATA_BROWSER_CUSTOMER_ID=xxx
BRIGHTDATA_BROWSER_ZONE=scraping_browser1
BRIGHTDATA_BROWSER_PASSWORD=xxx
```

### 3. TieredFetch Integration

Add before Web Unlocker:
```typescript
// Tier 2.0: Scraping Browser (strongest for DataDome)
if (hasScrapingBrowser && this.scrapingBrowserCircuit.canExecute()) {
  const result = await this.scrapingBrowser.fetch(url);
  if (result.success) {
    return { ...result, methodUsed: 'scraping_browser' };
  }
}
```

## Cost Analysis

| Method | Cost | Monthly (1x/day) |
|--------|------|------------------|
| Scraping Browser | ~$0.02-0.05/page | ~$1.50 |
| Web Unlocker | $0.0015/req | N/A (fails) |

## Testing

1. Deploy to server
2. Set Etsy rule to `next_run_at = NOW()`
3. Monitor logs for `[ScrapingBrowser]` entries
4. Verify HTML contains product price, not CAPTCHA
