# N8N AI Extraction Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LLM-powered extraction fallback when CSS selectors fail, using N8N + Crawl4AI

**Architecture:** Sentinel API detects SELECTOR_BROKEN → calls N8N webhook → N8N uses Crawl4AI + LLM to extract price → returns JSON → Sentinel saves value

**Tech Stack:** N8N, n8n-nodes-crawl4ai, Anthropic Claude API, NestJS

---

## Task 1: Install n8n-nodes-crawl4ai on Server

**Files:**
- Server: `/root/n8n/` (Docker environment)

**Step 1: SSH to server and check N8N custom nodes directory**

```bash
ssh root@135.181.99.192 "docker exec n8n-n8n-1 ls -la /home/node/.n8n/custom/"
```

Expected: Directory listing or "No such file" (we'll create it)

**Step 2: Clone n8n-nodes-crawl4ai into N8N container**

```bash
ssh root@135.181.99.192 "docker exec n8n-n8n-1 mkdir -p /home/node/.n8n/custom && docker exec n8n-n8n-1 sh -c 'cd /home/node/.n8n/custom && git clone https://github.com/cderamos-2ct/n8n-nodes-crawl4ai.git'"
```

Expected: Cloning message, success

**Step 3: Install dependencies and build**

```bash
ssh root@135.181.99.192 "docker exec n8n-n8n-1 sh -c 'cd /home/node/.n8n/custom/n8n-nodes-crawl4ai && npm install && npm run build'"
```

Expected: npm install output, build success

**Step 4: Restart N8N container**

```bash
ssh root@135.181.99.192 "cd /root/n8n && docker compose restart n8n"
```

Expected: "n8n-n8n-1 restarted"

**Step 5: Verify node is available**

```bash
ssh root@135.181.99.192 "docker exec n8n-n8n-1 n8n list:nodes | grep -i crawl"
```

Expected: crawl4ai nodes listed

**Step 6: Commit progress note**

```bash
echo "N8N nodes installed" >> /tmp/n8n-install.log
```

---

## Task 2: Create N8N Workflow for LLM Extraction

**Files:**
- N8N UI: https://n8n.taxinearme.sk

**Step 1: Open N8N and create new workflow**

Navigate to: https://n8n.taxinearme.sk
Click: "New Workflow"
Name: "Sentinel AI Price Extraction"

**Step 2: Add Webhook trigger node**

Add node: "Webhook"
Configure:
- HTTP Method: POST
- Path: `sentinel-extract`
- Authentication: None (internal only)
- Response Mode: "Last Node"

**Step 3: Add Crawl4AI Fetch node**

Add node: "Crawl4AI" (from custom nodes)
Configure:
- URL: `{{ $json.url }}`
- Crawler Type: Simple
- Wait for JavaScript: Yes
- Timeout: 60000

**Step 4: Add LLM Extraction node**

Add node: "Crawl4AI LLM Extract" or use "HTTP Request" to Anthropic API
Configure extraction prompt:

```
Extract the main product price from this e-commerce page HTML.
Return JSON: {"price": "XX.XX €", "currency": "EUR", "confidence": 0.0-1.0}
If multiple prices, return the primary/main product price.
If no price found, return {"price": null, "error": "no price found"}
```

**Step 5: Add Response node**

Add node: "Respond to Webhook"
Configure:
- Response Body: `{{ $json }}`
- Content-Type: application/json

**Step 6: Save and activate workflow**

Click: "Save"
Toggle: "Active" = ON
Copy webhook URL (will be like: `https://n8n.taxinearme.sk/webhook/sentinel-extract`)

**Step 7: Test workflow manually**

```bash
curl -X POST "https://n8n.taxinearme.sk/webhook/sentinel-extract" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.reifen.com/en-de", "ruleType": "price"}'
```

Expected: JSON with extracted price

---

## Task 3: Add LLM Extraction Service to Sentinel API

**Files:**
- Create: `apps/api/src/extraction/llm-extraction.service.ts`
- Modify: `apps/api/src/extraction/extraction.module.ts`
- Test: `apps/api/src/extraction/llm-extraction.service.spec.ts`

**Step 1: Write the failing test**

Create file: `apps/api/src/extraction/llm-extraction.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { LlmExtractionService } from './llm-extraction.service';
import { HttpService } from '@nestjs/axios';

describe('LlmExtractionService', () => {
  let service: LlmExtractionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmExtractionService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LlmExtractionService>(LlmExtractionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call N8N webhook with correct payload', async () => {
    // This will fail until we implement the service
    const result = await service.extractWithLlm({
      url: 'https://example.com',
      ruleType: 'price',
    });
    expect(result).toHaveProperty('price');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npm test -- --testPathPattern=llm-extraction
```

Expected: FAIL - Cannot find module './llm-extraction.service'

**Step 3: Implement LlmExtractionService**

Create file: `apps/api/src/extraction/llm-extraction.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface LlmExtractionRequest {
  url: string;
  ruleType: 'price' | 'availability' | 'text';
  html?: string; // Optional: send pre-fetched HTML
}

export interface LlmExtractionResult {
  success: boolean;
  price?: string;
  currency?: string;
  confidence?: number;
  error?: string;
  rawResponse?: unknown;
}

@Injectable()
export class LlmExtractionService {
  private readonly logger = new Logger(LlmExtractionService.name);
  private readonly n8nWebhookUrl: string;

  constructor(private readonly httpService: HttpService) {
    this.n8nWebhookUrl = process.env.N8N_EXTRACTION_WEBHOOK_URL
      || 'https://n8n.taxinearme.sk/webhook/sentinel-extract';
  }

  async extractWithLlm(request: LlmExtractionRequest): Promise<LlmExtractionResult> {
    this.logger.log(`LLM extraction requested for ${request.url}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post(this.n8nWebhookUrl, {
          url: request.url,
          ruleType: request.ruleType,
          html: request.html,
        }, {
          timeout: 120000, // 2 minutes for LLM processing
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );

      const data = response.data;
      this.logger.log(`LLM extraction result: ${JSON.stringify(data)}`);

      if (data.price) {
        return {
          success: true,
          price: data.price,
          currency: data.currency || 'EUR',
          confidence: data.confidence || 0.8,
          rawResponse: data,
        };
      }

      return {
        success: false,
        error: data.error || 'No price extracted',
        rawResponse: data,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`LLM extraction failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
      };
    }
  }
}
```

**Step 4: Create extraction module if not exists**

Create/modify: `apps/api/src/extraction/extraction.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LlmExtractionService } from './llm-extraction.service';

@Module({
  imports: [HttpModule],
  providers: [LlmExtractionService],
  exports: [LlmExtractionService],
})
export class ExtractionModule {}
```

**Step 5: Run tests to verify they pass**

```bash
cd apps/api && npm test -- --testPathPattern=llm-extraction
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/extraction/
git commit -m "feat(api): add LLM extraction service for N8N integration"
```

---

## Task 4: Integrate LLM Fallback into RuleTestService

**Files:**
- Modify: `apps/api/src/rules/rule-test.service.ts:142-169`
- Modify: `apps/api/src/rules/rules.module.ts`

**Step 1: Import LlmExtractionService in rules module**

Modify: `apps/api/src/rules/rules.module.ts`

Add import:
```typescript
import { ExtractionModule } from '../extraction/extraction.module';
```

Add to imports array:
```typescript
imports: [ExtractionModule, ...],
```

**Step 2: Inject LlmExtractionService into RuleTestService**

Modify: `apps/api/src/rules/rule-test.service.ts`

Add import:
```typescript
import { LlmExtractionService } from '../extraction/llm-extraction.service';
```

Modify constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private llmExtraction: LlmExtractionService,
) {}
```

**Step 3: Add LLM fallback after extraction fails**

Modify extraction section (after line 168):

```typescript
// Step 2: Extract (only if fetch successful)
const extractStartTime = Date.now();
let extractResult = {
  success: false,
  value: null as string | null,
  error: null as string | null,
  fallbackUsed: false,
  llmUsed: false,
};

if (fetchResult.success && fetchResult.html) {
  try {
    const result = extract(fetchResult.html, extraction);
    extractResult = {
      success: result.success,
      value: result.value ?? null,
      error: result.error ?? null,
      fallbackUsed: result.fallbackUsed,
      llmUsed: false,
    };

    // LLM FALLBACK: If CSS extraction failed, try LLM
    if (!result.success && rule.ruleType === 'price') {
      this.logger.log(`CSS extraction failed, trying LLM fallback for ${url}`);
      warnings.push('CSS selector failed, attempting LLM extraction');

      const llmResult = await this.llmExtraction.extractWithLlm({
        url,
        ruleType: 'price',
        html: fetchResult.html,
      });

      if (llmResult.success && llmResult.price) {
        extractResult = {
          success: true,
          value: llmResult.price,
          error: null,
          fallbackUsed: true,
          llmUsed: true,
        };
        warnings.push(`LLM extracted: ${llmResult.price} (confidence: ${llmResult.confidence})`);
      } else {
        errors.push(`LLM extraction also failed: ${llmResult.error}`);
      }
    }

    if (!extractResult.success) {
      errors.push(`Extraction failed: ${extractResult.error}`);
    }
  } catch (error) {
    // ... existing error handling
  }
}
```

**Step 4: Update RuleTestResult interface**

Add to `extraction` object in interface:
```typescript
extraction: {
  success: boolean;
  rawValue: string | null;
  errorMessage: string | null;
  selectorUsed: string | null;
  fallbackUsed: boolean;
  llmUsed: boolean; // NEW
};
```

**Step 5: Build and test**

```bash
cd apps/api && npm run build && npm test
```

Expected: Build success, tests pass

**Step 6: Commit**

```bash
git add apps/api/src/rules/ apps/api/src/extraction/
git commit -m "feat(api): add LLM fallback when CSS selector fails"
```

---

## Task 5: Add Environment Variable and Deploy

**Files:**
- Modify: `apps/api/.env`
- Server: Deploy to Hetzner

**Step 1: Add N8N webhook URL to .env**

```bash
echo 'N8N_EXTRACTION_WEBHOOK_URL=https://n8n.taxinearme.sk/webhook/sentinel-extract' >> apps/api/.env
```

**Step 2: Add to .env.example**

```bash
echo 'N8N_EXTRACTION_WEBHOOK_URL=https://n8n.taxinearme.sk/webhook/sentinel-extract' >> apps/api/.env.example
```

**Step 3: Build for production**

```bash
cd apps/api && npm run build
```

**Step 4: Deploy to server**

```bash
rsync -avz --exclude node_modules apps/api/ root@135.181.99.192:/root/sentinel/apps/api/
ssh root@135.181.99.192 "cd /root/sentinel/apps/api && npm install --production && pm2 restart sentinel-api"
```

**Step 5: Verify deployment**

```bash
curl https://sentinel.taxinearme.sk/api/health
```

Expected: {"status": "ok"}

**Step 6: Test LLM extraction on live rule**

Navigate to: https://sentinel-app.pages.dev
Open: reifen.com rule
Click: "Testovať"
Expected: Price extracted (via CSS or LLM fallback)

**Step 7: Commit deployment notes**

```bash
git add apps/api/.env.example
git commit -m "docs: add N8N webhook URL to env example"
```

---

## Task 6: End-to-End Test with Broken Selector

**Files:**
- None (manual testing)

**Step 1: Temporarily break a selector**

```bash
ssh root@135.181.99.192 "PGPASSWORD=vMd5OH8cO0jJLBbhoAEEmuPBlNkDmL6 psql -h localhost -U n8n -d sentinel -c \"UPDATE rules SET extraction = '{\\\"method\\\": \\\"css\\\", \\\"selector\\\": \\\".nonexistent-selector-xyz\\\", \\\"attribute\\\": \\\"text\\\"}' WHERE id = 'cmjvb9ufg0005yonwckevpjbo';\""
```

**Step 2: Test the rule via API**

```bash
curl -X POST "https://sentinel.taxinearme.sk/api/rules/cmjvb9ufg0005yonwckevpjbo/test" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq
```

Expected:
- `extraction.llmUsed: true`
- `extraction.rawValue: "94.80 €"` (or similar)
- `warnings` contains "LLM extraction"

**Step 3: Restore correct selector**

```bash
ssh root@135.181.99.192 "PGPASSWORD=vMd5OH8cO0jJLBbhoAEEmuPBlNkDmL6 psql -h localhost -U n8n -d sentinel -c \"UPDATE rules SET extraction = '{\\\"method\\\": \\\"css\\\", \\\"selector\\\": \\\".-price\\\", \\\"attribute\\\": \\\"text\\\"}' WHERE id = 'cmjvb9ufg0005yonwckevpjbo';\""
```

**Step 4: Document test results**

Create: `docs/testing/2026-01-01-llm-extraction-test.md`

```markdown
# LLM Extraction Test Results

## Date: 2026-01-01

### Test: Broken selector fallback to LLM

- Rule: reifen.com price monitor
- Original selector: `.-price`
- Broken selector: `.nonexistent-selector-xyz`
- LLM result: SUCCESS
- Extracted value: 94.80 €
- Confidence: 0.85

### Conclusion
LLM fallback working correctly.
```

---

## Summary

| Task | Description | Time Est. |
|------|-------------|-----------|
| 1 | Install n8n-nodes-crawl4ai | 10 min |
| 2 | Create N8N workflow | 15 min |
| 3 | Add LlmExtractionService | 15 min |
| 4 | Integrate fallback | 20 min |
| 5 | Deploy | 10 min |
| 6 | E2E test | 10 min |

**Total: ~80 minutes**

---

## Rollback Plan

If issues occur:
1. Disable LLM fallback by setting `N8N_EXTRACTION_WEBHOOK_URL=""`
2. Redeploy API
3. LLM extraction skipped, CSS-only mode restored
