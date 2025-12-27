import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { RuleTestService } from './rule-test.service';
import { HealthScoreService } from './health-score.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RulesController],
  providers: [RulesService, RuleTestService, HealthScoreService],
  exports: [RulesService, RuleTestService, HealthScoreService],
})
export class RulesModule {}
