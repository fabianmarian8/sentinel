import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { extract, detectBlock, smartFetch } from '@sentinel/extractor';
import type { ExtractionConfig, FetchMode } from '@sentinel/shared';
import { LlmExtractionService } from '../extraction/llm-extraction.service';

export interface RuleTestResult {
  success: boolean;
  timing: {
    fetchMs: number;
    extractMs: number;
    totalMs: number;
  };
  fetch: {
    mode: FetchMode;
    httpStatus: number | null;
    finalUrl: string | null;
    contentLength: number | null;
    blockDetected: boolean;
    blockType: string | null;
    errorCode: string | null;
    errorDetail: string | null;
  };
  extraction: {
    success: boolean;
    rawValue: string | null;
    errorMessage: string | null;
    selectorUsed: string | null;
    fallbackUsed: boolean;
    llmUsed: boolean;
  };
  html?: {
    sample: string;
    totalLength: number;
  };
  errors: string[];
  warnings: string[];
}

@Injectable()
export class RuleTestService {
  private readonly logger = new Logger(RuleTestService.name);

  constructor(
    private prisma: PrismaService,
    private llmExtraction: LlmExtractionService,
  ) {}

  /**
   * Test a rule by executing fetch + extract without persisting results
   */
  async testRule(ruleId: string): Promise<RuleTestResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];

    // Get rule with source and fetch profile
    const rule = await this.prisma.rule.findUnique({
      where: { id: ruleId },
      include: {
        source: {
          include: {
            fetchProfile: true,
          },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException('Rule not found');
    }

    const url = rule.source.url;
    const fetchMode = rule.source.fetchProfile?.mode ?? 'auto';  // 'auto' enables FlareSolverr fallback
    const extraction = rule.extraction as unknown as ExtractionConfig;

    // Step 1: Fetch
    const fetchStartTime = Date.now();
    let fetchResult;

    try {
      fetchResult = await smartFetch({
        url,
        timeout: 120000, // 2 minutes for FlareSolverr challenges
        userAgent: rule.source.fetchProfile?.userAgent ?? undefined,
        headers: rule.source.fetchProfile?.headers
          ? (rule.source.fetchProfile.headers as Record<string, string>)
          : undefined,
        preferredMode: fetchMode,
        renderWaitMs: rule.source.fetchProfile?.renderWaitMs ?? 2000,
      });
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        timing: {
          fetchMs: Date.now() - fetchStartTime,
          extractMs: 0,
          totalMs: Date.now() - startTime,
        },
        fetch: {
          mode: (fetchMode === 'auto' ? 'http' : fetchMode) as FetchMode,
          httpStatus: null,
          finalUrl: null,
          contentLength: null,
          blockDetected: false,
          blockType: null,
          errorCode: 'FETCH_ERROR',
          errorDetail: err.message,
        },
        extraction: {
          success: false,
          rawValue: null,
          errorMessage: 'Fetch failed, cannot extract',
          selectorUsed: null,
          fallbackUsed: false,
          llmUsed: false,
        },
        errors: [`Fetch failed: ${err.message}`],
        warnings,
      };
    }

    const fetchEndTime = Date.now();
    const fetchMs = fetchEndTime - fetchStartTime;

    // Check for blocks
    const blockResult = fetchResult.html
      ? detectBlock(fetchResult.httpStatus ?? 200, fetchResult.html, fetchResult.headers ?? {})
      : null;
    const blockType = blockResult?.blockType ?? null;

    if (!fetchResult.success) {
      errors.push(`Fetch failed: ${fetchResult.errorCode} - ${fetchResult.errorDetail}`);
    }

    if (blockType) {
      warnings.push(`Block detected: ${blockType}`);
    }

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

        // LLM FALLBACK: If CSS extraction failed, try LLM for price rules
        if (!result.success && rule.ruleType === 'price') {
          this.logger.log(`CSS extraction failed, trying LLM fallback for ${url}`);
          warnings.push('CSS selector failed, attempting LLM extraction');

          try {
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
              warnings.push(
                `LLM extracted: ${llmResult.price} (confidence: ${llmResult.confidence})`,
              );
            } else {
              errors.push(`LLM extraction also failed: ${llmResult.error}`);
            }
          } catch (llmError) {
            const llmErr = llmError as Error;
            this.logger.error(`LLM fallback error: ${llmErr.message}`);
            errors.push(`LLM fallback error: ${llmErr.message}`);
          }
        }

        if (!extractResult.success) {
          errors.push(`Extraction failed: ${extractResult.error}`);
        }

        if (extractResult.fallbackUsed && !extractResult.llmUsed) {
          warnings.push(`Primary selector failed, using fallback selector`);
        }
      } catch (error) {
        const err = error as Error;
        extractResult = {
          success: false,
          value: null,
          error: err.message,
          fallbackUsed: false,
          llmUsed: false,
        };
        errors.push(`Extraction error: ${err.message}`);
      }
    }

    const extractEndTime = Date.now();
    const extractMs = extractEndTime - extractStartTime;

    // Prepare HTML sample
    let htmlSample: { sample: string; totalLength: number } | undefined;
    if (fetchResult.html) {
      const sampleLength = 500;
      htmlSample = {
        sample: fetchResult.html.substring(0, sampleLength) +
          (fetchResult.html.length > sampleLength ? '...' : ''),
        totalLength: fetchResult.html.length,
      };
    }

    const response = {
      success: fetchResult.success && extractResult.success,
      timing: {
        fetchMs,
        extractMs,
        totalMs: Date.now() - startTime,
      },
      fetch: {
        mode: (fetchResult.modeUsed ?? (fetchMode === 'auto' ? 'http' : fetchMode)) as FetchMode,
        httpStatus: fetchResult.httpStatus,
        finalUrl: fetchResult.finalUrl,
        contentLength: fetchResult.html?.length ?? null,
        blockDetected: !!blockType,
        blockType,
        errorCode: fetchResult.errorCode,
        errorDetail: fetchResult.errorDetail,
      },
      extraction: {
        success: extractResult.success,
        rawValue: extractResult.value,
        errorMessage: extractResult.error,
        selectorUsed: extraction.selector,
        fallbackUsed: extractResult.fallbackUsed,
        llmUsed: extractResult.llmUsed,
      },
      html: htmlSample,
      errors,
      warnings,
    };

    console.log('[RuleTestService] Full response:', JSON.stringify(response));
    return response;
  }
}
