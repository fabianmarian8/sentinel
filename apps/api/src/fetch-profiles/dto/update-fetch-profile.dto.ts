import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateFetchProfileDto } from './create-fetch-profile.dto';

export class UpdateFetchProfileDto extends PartialType(
  OmitType(CreateFetchProfileDto, ['workspaceId'] as const),
) {}
