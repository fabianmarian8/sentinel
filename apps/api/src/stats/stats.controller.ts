import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('domains')
  getDomainStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getDomainStats(user.workspaceId, parseInt(days));
  }

  @Get('providers')
  getProviderStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getProviderStats(user.workspaceId, parseInt(days));
  }

  @Get('budget')
  getBudgetStatus(@CurrentUser() user: any) {
    return this.statsService.getBudgetStatus(user.workspaceId);
  }

  /**
   * Get SLO (Service Level Objective) metrics
   *
   * Returns:
   * - Extraction success rate (target: 95%)
   * - Cost per successful extraction
   * - Provider error rates
   * - Schema drift rate
   * - Latency percentiles (P50, P95, P99)
   *
   * Each metric includes a status: healthy | warning | critical
   */
  @Get('slo')
  getSloMetrics(@CurrentUser() user: any, @Query('hours') hours: string = '6') {
    return this.statsService.getSloMetrics(user.workspaceId, parseInt(hours));
  }

  /**
   * Get SLO metrics broken down by hostname
   * Useful for identifying problematic domains
   * Returns hostnames sorted by success rate (worst first)
   */
  @Get('slo/hostnames')
  getSloMetricsByHostname(@CurrentUser() user: any, @Query('hours') hours: string = '6') {
    return this.statsService.getSloMetricsByHostname(user.workspaceId, parseInt(hours));
  }
}
