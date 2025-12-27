import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';

@ApiTags('workspaces')
@Controller('workspaces')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: "List all user's workspaces" })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of workspaces retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async findAll(@Req() req: any) {
    return this.workspacesService.findAllByUser(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create new workspace' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Workspace created successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async create(@Req() req: any, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Workspace retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.workspacesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update workspace (owner or admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Workspace updated successfully',
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found',
  })
  @ApiForbiddenResponse({
    description: 'Only workspace owner or admin can update workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete workspace (owner only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Workspace deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Workspace not found',
  })
  @ApiForbiddenResponse({
    description: 'Only workspace owner can delete workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.workspacesService.remove(id, req.user.id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add member to workspace (owner or admin only)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Member added successfully',
  })
  @ApiNotFoundResponse({
    description: 'Workspace or user not found',
  })
  @ApiForbiddenResponse({
    description: 'Only workspace owner or admin can add members',
  })
  @ApiConflictResponse({
    description: 'User is already a member of this workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async addMember(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: AddMemberDto,
  ) {
    return this.workspacesService.addMember(id, req.user.id, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove member from workspace (owner or admin only)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Member removed successfully',
  })
  @ApiNotFoundResponse({
    description: 'Workspace or member not found',
  })
  @ApiForbiddenResponse({
    description: 'Only workspace owner or admin can remove members',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: any,
  ) {
    return this.workspacesService.removeMember(id, req.user.id, userId);
  }
}
