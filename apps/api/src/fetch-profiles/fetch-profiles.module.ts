import { Module } from '@nestjs/common';
import { FetchProfilesController } from './fetch-profiles.controller';
import { FetchProfilesService } from './fetch-profiles.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FetchProfilesController],
  providers: [FetchProfilesService],
  exports: [FetchProfilesService],
})
export class FetchProfilesModule {}
