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
}
