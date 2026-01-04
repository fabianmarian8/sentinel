import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  Max,
} from 'class-validator';
import { FetchMode, FetchProvider } from '@prisma/client';

export class CreateFetchProfileDto {
  @ApiProperty({ description: 'ID of the workspace this profile belongs to' })
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @ApiProperty({ description: 'Name of the fetch profile' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    enum: FetchMode,
    description: 'Default fetch mode (http, headless, flaresolverr)',
  })
  @IsOptional()
  @IsEnum(FetchMode)
  mode?: FetchMode;

  @ApiPropertyOptional({ description: 'Custom user agent string' })
  @IsOptional()
  @IsString()
  userAgent?: string;

  @ApiPropertyOptional({
    enum: FetchProvider,
    description: 'Preferred provider for paid-first routing (e.g., brightdata for DataDome sites)',
  })
  @IsOptional()
  @IsEnum(FetchProvider)
  preferredProvider?: FetchProvider;

  @ApiPropertyOptional({
    type: [String],
    enum: FetchProvider,
    description: 'Providers to disable for this profile (will not be tried)',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(FetchProvider, { each: true })
  disabledProviders?: FetchProvider[];

  @ApiPropertyOptional({
    description: 'Stop trying other providers if preferred provider fails',
  })
  @IsOptional()
  @IsBoolean()
  stopAfterPreferredFailure?: boolean;

  @ApiPropertyOptional({
    description: 'FlareSolverr wait seconds after challenge (0-30)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  flareSolverrWaitSeconds?: number;

  @ApiPropertyOptional({
    description: 'Wait time in ms after page load for headless mode',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30000)
  renderWaitMs?: number;

  @ApiPropertyOptional({
    description: 'Take screenshot when content changes',
  })
  @IsOptional()
  @IsBoolean()
  screenshotOnChange?: boolean;

  @ApiPropertyOptional({
    description: 'ISO 3166-1 alpha-2 country code for geo pinning (e.g., "cz", "de", "us"). Used for BrightData proxy location to ensure currency stability.',
    example: 'cz',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}$/, { message: 'geoCountry must be a lowercase ISO 3166-1 alpha-2 code (e.g., "cz", "de")' })
  geoCountry?: string;
}
