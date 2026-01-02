import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

export interface LlmExtractionRequest {
  url: string;
  ruleType: 'price' | 'availability' | 'text';
  html?: string;
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

  async extractWithLlm(
    request: LlmExtractionRequest,
  ): Promise<LlmExtractionResult> {
    this.logger.log(`LLM extraction requested for ${request.url}`);

    try {
      // Prepare HTML snippet (first 12000 chars to fit context)
      const htmlSnippet = request.html
        ? request.html.substring(0, 12000)
        : 'No HTML provided';

      const prompt = `Extract the main product price from this e-commerce page. Return ONLY a JSON object like: {"price": "XX.XX", "currency": "EUR", "confidence": 0.95}

If no price found: {"price": null, "error": "reason"}

URL: ${request.url}

HTML snippet:
${htmlSnippet}`;

      // Call Claude CLI using stdin (avoids shell escaping issues)
      const response = await this.runClaudeCli(prompt);
      this.logger.log(`Claude CLI response length: ${response.length}`);

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[^}]+\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);

        if (result.price !== null && result.price !== undefined) {
          return {
            success: true,
            price: String(result.price),
            currency: result.currency || 'EUR',
            confidence: result.confidence || 0.8,
            rawResponse: response,
          };
        }

        return {
          success: false,
          error: result.error || 'No price found',
          rawResponse: response,
        };
      }

      return {
        success: false,
        error: 'Could not parse JSON from response',
        rawResponse: response,
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

  private runClaudeCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const claude = spawn('claude', ['-p'], {
        cwd: '/tmp',
        timeout: 90000,
      });

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        }
      });

      claude.on('error', (err) => {
        reject(err);
      });

      // Send prompt via stdin
      claude.stdin.write(prompt);
      claude.stdin.end();
    });
  }
}
