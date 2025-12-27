import { IsInt, Min, Max, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScheduleConfigDto {
  @ApiProperty({
    description: 'Interval between checks in seconds (minimum 60)',
    example: 3600,
    minimum: 60,
  })
  @IsInt()
  @Min(60, { message: 'Interval must be at least 60 seconds' })
  @Max(2592000, { message: 'Interval must not exceed 30 days (2592000 seconds)' })
  intervalSeconds!: number;

  @ApiPropertyOptional({
    description: 'Random jitter to add to interval in seconds (0-300)',
    example: 60,
    minimum: 0,
    maximum: 300,
  })
  @IsInt()
  @Min(0)
  @Max(300)
  @IsOptional()
  jitterSeconds?: number;
}
