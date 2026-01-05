import { Controller, Get, Query, UseGuards, Headers, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StatsService } from './stats.service';

// Internal API key for admin endpoints (set in environment)
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'sentinel-internal-2026';

@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('domains')
  @UseGuards(JwtAuthGuard)
  getDomainStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getDomainStats(user.workspaceId, parseInt(days));
  }

  @Get('providers')
  @UseGuards(JwtAuthGuard)
  getProviderStats(@CurrentUser() user: any, @Query('days') days: string = '7') {
    return this.statsService.getProviderStats(user.workspaceId, parseInt(days));
  }

  @Get('budget')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  getSloMetrics(@CurrentUser() user: any, @Query('hours') hours: string = '6') {
    return this.statsService.getSloMetrics(user.workspaceId, parseInt(hours));
  }

  /**
   * Get SLO metrics broken down by hostname
   * Useful for identifying problematic domains
   * Returns hostnames sorted by success rate (worst first)
   */
  @Get('slo/hostnames')
  @UseGuards(JwtAuthGuard)
  getSloMetricsByHostname(@CurrentUser() user: any, @Query('hours') hours: string = '6') {
    return this.statsService.getSloMetricsByHostname(user.workspaceId, parseInt(hours));
  }

  /**
   * Admin endpoint: Global SLO metrics by hostname (no workspace filter)
   * Requires internal API key in X-Internal-Key header
   * Use: curl -H "X-Internal-Key: sentinel-internal-2026" /api/stats/admin/slo/hostnames
   */
  @Get('admin/slo/hostnames')
  getGlobalSloMetricsByHostname(
    @Headers('x-internal-key') apiKey: string,
    @Query('hours') hours: string = '24',
  ) {
    if (apiKey !== INTERNAL_API_KEY) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    return this.statsService.getGlobalSloMetricsByHostname(parseInt(hours));
  }

  /**
   * Admin endpoint: SLO metrics for specific workspace (canary eval)
   * Returns metrics with tier breakdown for canary workspace monitoring
   *
   * Required for 24h canary eval protocol:
   * - Success rate per tier (A/B/C)
   * - Cost per success per tier
   * - rate_limited % (BrightData capacity)
   * - Worst hostnames with primary error
   *
   * Use: curl -H "X-Internal-Key: sentinel-internal-2026" "/api/stats/admin/slo/canary?workspaceId=xxx&hours=24"
   */
  @Get('admin/slo/canary')
  getCanarySloMetrics(
    @Headers('x-internal-key') apiKey: string,
    @Query('workspaceId') workspaceId: string,
    @Query('hours') hours: string = '24',
  ) {
    if (apiKey !== INTERNAL_API_KEY) {
      throw new UnauthorizedException('Invalid internal API key');
    }
    if (!workspaceId) {
      throw new UnauthorizedException('workspaceId query parameter required');
    }
    return this.statsService.getCanarySloMetrics(workspaceId, parseInt(hours));
  }
}
