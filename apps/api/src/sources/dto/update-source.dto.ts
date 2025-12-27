import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateSourceDto } from './create-source.dto';

export class UpdateSourceDto extends PartialType(
  OmitType(CreateSourceDto, ['workspaceId'] as const),
) {}
