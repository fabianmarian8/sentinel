import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { WorkerConfigService } from './config.service';
import { validateEnv } from './env.validation';

/**
 * Configuration module
 * Handles environment variables and app configuration
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
  ],
  providers: [WorkerConfigService],
  exports: [WorkerConfigService],
})
export class ConfigModule {}
