import {
  IsString,
  IsOptional,
  IsEnum,
  IsIn,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum ExtractionMethod {
  CSS_SELECTOR = 'css',
  XPATH = 'xpath',
  REGEX = 'regex',
  // Note: JSON_PATH removed - not implemented, blocked at validation level
}

export enum PostProcessType {
  TRIM = 'trim',
  LOWERCASE = 'lowercase',
  UPPERCASE = 'uppercase',
  REPLACE = 'replace',
  EXTRACT_NUMBER = 'extract_number',
}

export class PostProcessStepDto {
  @ApiProperty({
    description: 'Type of post-processing step',
    enum: PostProcessType,
    example: PostProcessType.TRIM,
  })
  @IsEnum(PostProcessType)
  type!: PostProcessType;

  @ApiPropertyOptional({
    description: 'Additional parameters for the post-process step',
    example: { pattern: '\\s+', replacement: ' ' },
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;
}

export class ExtractionConfigDto {
  @ApiProperty({
    description: 'Extraction method to use',
    enum: ExtractionMethod,
    example: ExtractionMethod.CSS_SELECTOR,
  })
  @IsIn(['css', 'xpath', 'regex'], {
    message: 'Method must be css, xpath, or regex. JSONPath not yet supported.'
  })
  method!: ExtractionMethod;

  @ApiProperty({
    description: 'Selector/path/pattern for extraction',
    example: '.price-value',
  })
  @IsString()
  selector!: string;

  @ApiPropertyOptional({
    description: 'Attribute to extract (for HTML elements)',
    example: 'data-price',
  })
  @IsString()
  @IsOptional()
  attribute?: string;

  @ApiPropertyOptional({
    description: 'Post-processing steps to apply to extracted value',
    type: [PostProcessStepDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostProcessStepDto)
  @IsOptional()
  postProcess?: PostProcessStepDto[];

  @ApiPropertyOptional({
    description: 'Whether to extract all matching elements or just the first',
    example: false,
  })
  @IsOptional()
  extractAll?: boolean;
}
