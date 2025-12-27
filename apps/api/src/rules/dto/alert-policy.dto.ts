import {
  IsArray,
  IsEnum,
  IsString,
  IsNumber,
  IsOptional,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum AlertConditionType {
  VALUE_CHANGED = 'value_changed',
  VALUE_INCREASED = 'value_increased',
  VALUE_DECREASED = 'value_decreased',
  VALUE_ABOVE = 'value_above',
  VALUE_BELOW = 'value_below',
  VALUE_EQUALS = 'value_equals',
  VALUE_NOT_EQUALS = 'value_not_equals',
  VALUE_CONTAINS = 'value_contains',
  VALUE_NOT_CONTAINS = 'value_not_contains',
  VALUE_DISAPPEARED = 'value_disappeared',
  VALUE_APPEARED = 'value_appeared',
  PERCENTAGE_CHANGE = 'percentage_change',
}

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export class AlertConditionDto {
  @ApiProperty({
    description: 'Type of condition to check',
    enum: AlertConditionType,
    example: AlertConditionType.VALUE_DECREASED,
  })
  @IsEnum(AlertConditionType)
  type!: AlertConditionType;

  @ApiProperty({
    description: 'Severity level for this condition',
    enum: AlertSeverity,
    example: AlertSeverity.HIGH,
  })
  @IsEnum(AlertSeverity)
  severity!: AlertSeverity;

  @ApiPropertyOptional({
    description: 'Threshold value (for numeric comparisons)',
    example: 100,
  })
  @IsNumber()
  @IsOptional()
  threshold?: number;

  @ApiPropertyOptional({
    description: 'Text value (for text comparisons)',
    example: 'Out of stock',
  })
  @IsString()
  @IsOptional()
  value?: string;

  @ApiPropertyOptional({
    description: 'Additional condition parameters',
  })
  @IsOptional()
  params?: Record<string, any>;
}

export class AlertPolicyDto {
  @ApiProperty({
    description: 'Alert conditions to monitor',
    type: [AlertConditionDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlertConditionDto)
  conditions!: AlertConditionDto[];

  @ApiPropertyOptional({
    description: 'IDs of notification channels to use for alerts',
    type: [String],
    example: ['clh1234567890abcdefg'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  channels?: string[];

  @ApiPropertyOptional({
    description: 'Minimum time between alerts in seconds (prevents spam)',
    example: 3600,
  })
  @IsNumber()
  @IsOptional()
  cooldownSeconds?: number;
}
