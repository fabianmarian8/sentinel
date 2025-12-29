import {
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ParentContextDto {
  @ApiProperty({ description: 'HTML tag name', example: 'div' })
  @IsString()
  tag!: string;

  @ApiProperty({ description: 'CSS classes', example: ['product', 'container'] })
  @IsArray()
  @IsString({ each: true })
  classes!: string[];

  @ApiPropertyOptional({ description: 'Element ID', example: 'product-info' })
  @IsString()
  @IsOptional()
  id?: string;
}

export class SelectorFingerprintDto {
  @ApiProperty({
    description: 'Primary CSS selector',
    example: '.price-current',
  })
  @IsString()
  selector!: string;

  @ApiPropertyOptional({
    description: 'Alternative selectors for auto-healing',
    example: ['[data-price]', '.product-price'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  alternativeSelectors?: string[];

  @ApiPropertyOptional({
    description: 'Text anchor for validation',
    example: '$99.99',
  })
  @IsString()
  @IsOptional()
  textAnchor?: string;

  @ApiPropertyOptional({
    description: 'Parent element context for validation',
    type: [ParentContextDto],
  })
  @ValidateNested({ each: true })
  @Type(() => ParentContextDto)
  @IsOptional()
  parentContext?: ParentContextDto[];

  @ApiPropertyOptional({
    description: 'Element attributes for validation',
    example: { 'data-testid': 'price-display' },
  })
  @IsOptional()
  attributes?: Record<string, string>;
}
