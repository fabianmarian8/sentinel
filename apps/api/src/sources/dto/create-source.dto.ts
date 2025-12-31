import { IsUrl, IsOptional, IsArray, IsString, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSourceDto {
  @ApiProperty({
    description: 'ID of the workspace this source belongs to',
    example: 'clh1234567890abcdefg',
  })
  @IsUUID()
  workspaceId!: string;

  @ApiProperty({
    description: 'URL to monitor for changes',
    example: 'https://example.com/product/123',
  })
  @IsUrl({}, { message: 'url must be a valid URL' })
  url!: string;

  @ApiPropertyOptional({
    description: 'ID of the fetch profile to use for this source',
    example: 'clh9876543210zyxwvut',
  })
  @IsOptional()
  @IsUUID()
  fetchProfileId?: string;

  @ApiPropertyOptional({
    description: 'Tags for organizing sources',
    example: ['ecommerce', 'competitor', 'high-priority'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
