import { PartialType, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateRuleDto } from './create-rule.dto';
import { OmitType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

// Omit sourceId from update - cannot change the source of an existing rule
export class UpdateRuleDto extends PartialType(
  OmitType(CreateRuleDto, ['sourceId'] as const),
) {
  @ApiPropertyOptional({
    description: 'Whether CAPTCHA interval enforcement is active (for testing)',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  captchaIntervalEnforced?: boolean;

  @ApiPropertyOptional({
    description: 'User explicitly disabled auto-throttle for paid services',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  autoThrottleDisabled?: boolean;
}
