import { IsString, IsEnum, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceType } from '@prisma/client';

export class CreateWorkspaceDto {
  @ApiProperty({
    example: 'My E-commerce Monitoring',
    description: 'Workspace name',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    enum: WorkspaceType,
    example: WorkspaceType.ecommerce,
    description: 'Type of workspace',
  })
  @IsEnum(WorkspaceType)
  type!: WorkspaceType;

  @ApiProperty({
    example: 'Europe/Bratislava',
    description: 'Workspace timezone',
    required: false,
    default: 'Europe/Bratislava',
  })
  @IsString()
  @IsOptional()
  timezone?: string;
}
