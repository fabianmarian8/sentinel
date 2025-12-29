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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationChannelsService } from './notification-channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@ApiTags('notification-channels')
@Controller('notification-channels')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationChannelsController {
  constructor(private readonly channelsService: NotificationChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'List notification channels for a workspace' })
  @ApiQuery({ name: 'workspaceId', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of notification channels retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  async findAll(@Req() req: any, @Query('workspaceId') workspaceId: string) {
    return this.channelsService.findAllByWorkspace(req.user.id, workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new notification channel' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Notification channel created successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  async create(@Req() req: any, @Body() dto: CreateChannelDto) {
    return this.channelsService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get notification channel by ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification channel retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Notification channel not found',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.channelsService.findOne(req.user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update notification channel' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification channel updated successfully',
  })
  @ApiNotFoundResponse({
    description: 'Notification channel not found',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async update(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete notification channel' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification channel deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Notification channel not found',
  })
  @ApiForbiddenResponse({
    description: 'Only workspace owner or admin can delete notification channels',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.channelsService.remove(req.user.id, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Send a test notification to verify channel' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Test notification sent successfully',
  })
  @ApiNotFoundResponse({
    description: 'Notification channel not found',
  })
  @ApiForbiddenResponse({
    description: 'You are not a member of this workspace',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async test(@Param('id') id: string, @Req() req: any) {
    return this.channelsService.test(req.user.id, id);
  }

  @Post('slack/exchange')
  @ApiOperation({ summary: 'Exchange Slack OAuth code for access token' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OAuth code exchanged successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async exchangeSlackCode(
    @Body() body: { code: string; redirectUri: string },
  ) {
    return this.channelsService.exchangeSlackCode(body.code, body.redirectUri);
  }

  @Get('slack/channels')
  @ApiOperation({ summary: 'List Slack channels for user to select' })
  @ApiQuery({ name: 'accessToken', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slack channels retrieved successfully',
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized - invalid or missing token',
  })
  async listSlackChannels(
    @Query('accessToken') accessToken: string,
  ) {
    return this.channelsService.listSlackChannels(accessToken);
  }

  @Get('slack/auth-url')
  @ApiOperation({ summary: 'Get Slack OAuth authorization URL' })
  @ApiQuery({ name: 'redirectUri', required: true })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slack OAuth URL generated successfully',
  })
  getSlackAuthUrl(@Query('redirectUri') redirectUri: string) {
    const url = this.channelsService.getSlackAuthUrl(redirectUri);
    return { url };
  }
}
