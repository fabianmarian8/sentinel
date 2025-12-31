import { IsUrl, IsOptional, IsArray, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSourceDto {
  @ApiProperty({
    description: 'ID of the workspace this source belongs to (CUID format)',
    example: 'clh1234567890abcdefg',
  })
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @ApiProperty({
    description: 'URL to monitor for changes',
    example: 'https://example.com/product/123',
  })
  @IsUrl({}, { message: 'url must be a valid URL' })
  url!: string;

  @ApiPropertyOptional({
    description: 'ID of the fetch profile to use for this source (CUID format)',
    example: 'clh9876543210zyxwvut',
  })
  @IsOptional()
  @IsString()
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
