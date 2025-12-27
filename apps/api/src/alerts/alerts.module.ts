import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertEventService } from './events/alert-event.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEventService],
  exports: [AlertsService, AlertEventService],
})
export class AlertsModule {}
