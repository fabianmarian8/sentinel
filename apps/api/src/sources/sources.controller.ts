import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';

@ApiTags('sources')
@Controller('sources')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class SourcesController {
  constructor(private sourcesService: SourcesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all sources in a workspace',
    description: 'Retrieve all sources for a given workspace. Requires workspace membership.',
  })
  @ApiQuery({
    name: 'workspaceId',
    description: 'ID of the workspace to list sources from',
    required: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sources retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - user does not have access to this workspace',
  })
  async findByWorkspace(
    @Query('workspaceId') workspaceId: string,
    @Req() req: any,
  ) {
    return this.sourcesService.findByWorkspace(workspaceId, req.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new source',
    description: 'Add a new URL source to monitor for changes. Requires workspace membership.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Source created successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - user does not have access to this workspace',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data or duplicate URL',
  })
  async create(@Body() dto: CreateSourceDto, @Req() req: any) {
    return this.sourcesService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get source by ID',
    description: 'Retrieve detailed information about a specific source',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Source retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - source does not exist or access denied',
  })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.sourcesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a source',
    description: 'Update source configuration. Can modify URL, fetch profile, and tags.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Source updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - source does not exist or access denied',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data or duplicate URL',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSourceDto,
    @Req() req: any,
  ) {
    return this.sourcesService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a source',
    description: 'Permanently delete a source and all associated rules',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Source deleted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - source does not exist or access denied',
  })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.sourcesService.remove(id, req.user.id);
  }
}
