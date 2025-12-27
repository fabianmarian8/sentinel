import { PartialType } from '@nestjs/swagger';
import { CreateRuleDto } from './create-rule.dto';
import { OmitType } from '@nestjs/swagger';

// Omit sourceId from update - cannot change the source of an existing rule
export class UpdateRuleDto extends PartialType(
  OmitType(CreateRuleDto, ['sourceId'] as const),
) {}
