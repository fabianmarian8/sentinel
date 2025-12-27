import { IsEnum, IsOptional, IsString, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AlertSeverity } from '@prisma/client';

export enum AlertStatusFilter {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  ALL = 'all',
}

export class AlertFilterDto {
  @IsString()
  workspaceId!: string;

  @IsEnum(AlertStatusFilter)
  @IsOptional()
  status?: AlertStatusFilter;

  @IsEnum(AlertSeverity)
  @IsOptional()
  severity?: AlertSeverity;

  @IsString()
  @IsOptional()
  ruleId?: string;

  @IsDateString()
  @IsOptional()
  since?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  limit?: number;
}
