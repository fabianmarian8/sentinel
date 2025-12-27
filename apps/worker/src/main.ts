import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

/**
 * Bootstrap BullMQ worker application
 */
async function bootstrap() {
  const logger = new Logger('WorkerBootstrap');

  try {
    // Create NestJS application context (microservice mode, no HTTP server)
    const app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    // Enable graceful shutdown hooks
    app.enableShutdownHooks();

    logger.log('🚀 Sentinel Worker started successfully');
    logger.log('📋 Processing queues:');
    logger.log('   - rules:run (concurrency: 5)');
    logger.log('   - alerts:dispatch (concurrency: 10)');
    logger.log('');
    logger.log('Press Ctrl+C to stop gracefully');

    // Handle graceful shutdown
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM signal received: closing worker gracefully');
      await app.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.log('SIGINT signal received: closing worker gracefully');
      await app.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

bootstrap();
