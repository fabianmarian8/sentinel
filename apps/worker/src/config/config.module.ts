import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { WorkerConfigService } from './config.service';

/**
 * Configuration module
 * Handles environment variables and app configuration
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  providers: [WorkerConfigService],
  exports: [WorkerConfigService],
})
export class ConfigModule {}
