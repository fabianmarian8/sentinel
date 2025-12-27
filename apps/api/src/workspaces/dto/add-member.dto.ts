import { IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({
    example: 'clxyz123...',
    description: 'User ID to add as member',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    enum: WorkspaceRole,
    example: WorkspaceRole.member,
    description: 'Role for the new member',
  })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
