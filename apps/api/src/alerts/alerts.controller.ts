import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Sse,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Observable, interval } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { AlertsService } from './alerts.service';
import { AlertFilterDto } from './dto/alert-filter.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

interface MessageEvent {
  data: string | object;
}

@Controller('alerts')
@UseGuards(JwtAuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  /**
   * GET /alerts?workspaceId=xxx&status=open&severity=critical&ruleId=xxx&since=2025-12-27T00:00:00Z&limit=50
   * List alerts with filtering
   */
  @Get()
  async findAll(
    @Query() filters: AlertFilterDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertsService.findMany(filters, userId);
  }

  /**
   * GET /alerts/:id
   * Get alert detail
   */
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertsService.findOne(id, userId);
  }

  /**
   * POST /alerts/:id/ack
   * Acknowledge alert
   */
  @Post(':id/ack')
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertsService.acknowledge(id, userId);
  }

  /**
   * POST /alerts/:id/resolve
   * Resolve alert
   */
  @Post(':id/resolve')
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.alertsService.resolve(id, userId);
  }

  /**
   * GET /alerts/stream?workspaceId=xxx
   * SSE endpoint for real-time updates
   *
   * Usage:
   * const eventSource = new EventSource('/alerts/stream?workspaceId=xxx', {
   *   headers: { Authorization: 'Bearer <token>' }
   * });
   * eventSource.onmessage = (event) => {
   *   const alerts = JSON.parse(event.data);
   *   console.log('Recent alerts:', alerts);
   * };
   */
  @Sse('stream')
  stream(
    @CurrentUser('id') userId: string,
    @Query('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Observable<MessageEvent> {
    // Poll every 5 seconds for new alerts
    // In production, this should use Redis pub/sub for better performance
    return interval(5000).pipe(
      switchMap(async () => {
        const alerts = await this.alertsService.findRecent(
          workspaceId,
          userId,
          5,
        );
        return alerts;
      }),
      map((alerts) => ({
        data: JSON.stringify(alerts),
      })),
    );
  }
}
