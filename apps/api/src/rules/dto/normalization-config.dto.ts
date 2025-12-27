import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum NormalizationType {
  PRICE = 'price',
  NUMBER = 'number',
  TEXT = 'text',
  BOOLEAN = 'boolean',
  DATE = 'date',
}

export class NormalizationConfigDto {
  @ApiProperty({
    description: 'Type of normalization to apply',
    enum: NormalizationType,
    example: NormalizationType.PRICE,
  })
  @IsEnum(NormalizationType)
  type!: NormalizationType;

  @ApiPropertyOptional({
    description: 'Currency code (for price normalization)',
    example: 'EUR',
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Locale for number/currency parsing',
    example: 'sk-SK',
  })
  @IsString()
  @IsOptional()
  locale?: string;

  @ApiPropertyOptional({
    description: 'Unit for number normalization',
    example: 'kg',
  })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional({
    description: 'Decimal places to round to',
    example: 2,
  })
  @IsNumber()
  @IsOptional()
  decimalPlaces?: number;

  @ApiPropertyOptional({
    description: 'Additional normalization parameters',
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, any>;
}
