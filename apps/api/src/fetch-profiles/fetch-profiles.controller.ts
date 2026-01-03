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
import { FetchProfilesService } from './fetch-profiles.service';
import { CreateFetchProfileDto } from './dto/create-fetch-profile.dto';
import { UpdateFetchProfileDto } from './dto/update-fetch-profile.dto';

@ApiTags('fetch-profiles')
@Controller('fetch-profiles')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class FetchProfilesController {
  constructor(private fetchProfilesService: FetchProfilesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all fetch profiles in a workspace',
    description: 'Retrieve all fetch profiles for domain-specific fetch configuration. Requires workspace membership.',
  })
  @ApiQuery({
    name: 'workspaceId',
    description: 'ID of the workspace to list profiles from',
    required: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Fetch profiles retrieved successfully',
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
    return this.fetchProfilesService.findByWorkspace(workspaceId, req.user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new fetch profile',
    description: `
      Create a fetch profile for domain-specific fetch configuration.

      **Domain Policy fields:**
      - \`preferredProvider\`: Set to 'brightdata' for DataDome-protected sites
      - \`disabledProviders\`: Providers to skip (e.g., ['flaresolverr'] for sites where it fails)
      - \`stopAfterPreferredFailure\`: If true, don't try other providers when preferred fails

      **Example for Etsy (DataDome):**
      \`\`\`json
      {
        "name": "Etsy DataDome",
        "preferredProvider": "brightdata",
        "disabledProviders": ["flaresolverr"],
        "stopAfterPreferredFailure": true
      }
      \`\`\`

      Requires admin access to workspace.
    `,
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Fetch profile created successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - requires admin access to workspace',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data, duplicate name, or policy conflict',
  })
  async create(@Body() dto: CreateFetchProfileDto, @Req() req: any) {
    return this.fetchProfilesService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get fetch profile by ID',
    description: 'Retrieve detailed information about a specific fetch profile including sources using it',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Fetch profile retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiNotFoundResponse({
    description: 'Not found - fetch profile does not exist or access denied',
  })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.fetchProfilesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a fetch profile',
    description: `
      Update fetch profile configuration including domain policy.

      **Validation rules:**
      - \`stopAfterPreferredFailure\` requires \`preferredProvider\` to be set
      - \`preferredProvider\` cannot be in \`disabledProviders\` list

      Requires admin access to workspace.
    `,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Fetch profile updated successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - requires admin access to workspace',
  })
  @ApiNotFoundResponse({
    description: 'Not found - fetch profile does not exist or access denied',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - invalid data, duplicate name, or policy conflict',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFetchProfileDto,
    @Req() req: any,
  ) {
    return this.fetchProfilesService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a fetch profile',
    description: 'Delete a fetch profile. Cannot delete if sources are using it. Requires admin access.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Fetch profile deleted successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'Forbidden - requires admin access to workspace',
  })
  @ApiNotFoundResponse({
    description: 'Not found - fetch profile does not exist or access denied',
  })
  @ApiBadRequestResponse({
    description: 'Bad request - cannot delete profile that is in use',
  })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.fetchProfilesService.remove(id, req.user.id);
  }
}
