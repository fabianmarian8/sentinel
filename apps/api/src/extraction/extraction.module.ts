import { Module } from '@nestjs/common';
import { LlmExtractionService } from './llm-extraction.service';

@Module({
  providers: [LlmExtractionService],
  exports: [LlmExtractionService],
})
export class ExtractionModule {}
