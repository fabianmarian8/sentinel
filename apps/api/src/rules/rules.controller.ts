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
import { RulesService } from './rules.service';
import { RuleTestService } from './rule-test.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';

@ApiTags('rules')
@Controller('rules')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class RulesController {
  constructor(
    private rulesService: RulesService,
    private ruleTestService: RuleTestService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List rules',
    description:
      'Retrieve rules by workspace or source. Requires either workspaceId or sourceId query parameter.',
  })
  @ApiQuery({
    name: 'workspaceId',
    description: 'ID of the workspace to list rules from',
    required: false,
  })
  @ApiQuery({
    name: 'sourceId',
    description: 'ID of the source to list rules for',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rules retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - user does not have access',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - must provide either workspaceId or sourceId',
  })
  async findAll(
    @Query('workspaceId') workspaceId?: string,
    @Query('sourceId') sourceId?: string,
    @Req() req?: any,
  ) {
    if (workspaceId) {
      return this.rulesService.findByWorkspace(workspaceId, req.user.id);
    } else if (sourceId) {
      return this.rulesService.findBySource(sourceId, req.user.id);
    } else {
      throw new Error('Must provide either workspaceId or sourceId');
    }
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new rule',
    description:
      'Add a new monitoring rule to a source. Requires source access.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Rule created successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - user does not have access to the source',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data',
  })
  async create(@Body() dto: CreateRuleDto, @Req() req: any) {
    return this.rulesService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get rule by ID',
    description:
      'Retrieve detailed information about a specific rule including latest observations',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.rulesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a rule',
    description:
      'Update rule configuration. Can modify name, extraction, normalization, schedule, and alert policy.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRuleDto,
    @Req() req: any,
  ) {
    return this.rulesService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a rule',
    description:
      'Permanently delete a rule and all associated observations and alerts',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule deleted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.rulesService.remove(id, req.user.id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause a rule',
    description: 'Disable a rule temporarily by setting enabled=false',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule paused successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  async pause(@Param('id') id: string, @Req() req: any) {
    return this.rulesService.pause(id, req.user.id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume a rule',
    description:
      'Re-enable a paused rule by setting enabled=true and calculating new nextRunAt',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule resumed successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  async resume(@Param('id') id: string, @Req() req: any) {
    return this.rulesService.resume(id, req.user.id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test a rule',
    description:
      'Execute fetch + extract for a rule without persisting results. Returns timing, fetch status, and extracted value for debugging.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rule test executed successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - rule does not exist or access denied',
  })
  async testRule(@Param('id') id: string, @Req() req: any) {
    // First verify user has access to this rule
    await this.rulesService.findOne(id, req.user.id);
    // Then run the test
    return this.ruleTestService.testRule(id);
  }

}
