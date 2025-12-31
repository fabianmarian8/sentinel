import {
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  ValidateNested,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ExtractionConfigDto } from './extraction-config.dto';
import { NormalizationConfigDto } from './normalization-config.dto';
import { ScheduleConfigDto } from './schedule-config.dto';
import { AlertPolicyDto } from './alert-policy.dto';
import { SelectorFingerprintDto } from './selector-fingerprint.dto';

export enum RuleType {
  PRICE = 'price',
  AVAILABILITY = 'availability',
  TEXT = 'text',
  NUMBER = 'number',
}

export class CreateRuleDto {
  @ApiProperty({
    description: 'ID of the source to monitor (CUID format)',
    example: 'clh1234567890abcdefg',
  })
  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  @ApiProperty({
    description: 'Name of the monitoring rule',
    example: 'Monitor product price',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description: 'Type of rule to create',
    enum: RuleType,
    example: RuleType.PRICE,
  })
  @IsEnum(RuleType)
  ruleType!: RuleType;

  @ApiProperty({
    description: 'Configuration for data extraction',
    type: ExtractionConfigDto,
  })
  @ValidateNested()
  @Type(() => ExtractionConfigDto)
  extraction!: ExtractionConfigDto;

  @ApiProperty({
    description: 'Configuration for data normalization',
    type: NormalizationConfigDto,
  })
  @ValidateNested()
  @Type(() => NormalizationConfigDto)
  normalization!: NormalizationConfigDto;

  @ApiProperty({
    description: 'Scheduling configuration for monitoring',
    type: ScheduleConfigDto,
  })
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule!: ScheduleConfigDto;

  @ApiProperty({
    description: 'Alert policy configuration',
    type: AlertPolicyDto,
  })
  @ValidateNested()
  @Type(() => AlertPolicyDto)
  alertPolicy!: AlertPolicyDto;

  @ApiPropertyOptional({
    description: 'Whether the rule is enabled',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Capture screenshot when value changes',
    example: false,
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  screenshotOnChange?: boolean;

  @ApiPropertyOptional({
    description: 'Selector fingerprint for auto-healing (alternativeSelectors, textAnchor, parentContext)',
    type: SelectorFingerprintDto,
  })
  @ValidateNested()
  @Type(() => SelectorFingerprintDto)
  @IsOptional()
  selectorFingerprint?: SelectorFingerprintDto;
}
