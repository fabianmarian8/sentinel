import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateChannelDto } from './create-channel.dto';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateChannelDto extends PartialType(
  OmitType(CreateChannelDto, ['workspaceId', 'type'] as const),
) {
  @ApiPropertyOptional({ description: 'Enable or disable the channel' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
