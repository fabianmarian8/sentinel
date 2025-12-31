import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);

  // Global prefix
  app.setGlobalPrefix(configService.apiPrefix);

  // CORS
  app.enableCors({
    origin: configService.corsOrigins,
    credentials: true,
  });

  const nodeEnv = configService.nodeEnv;

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation (only in development and staging)
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Sentinel API')
      .setDescription('Change Intelligence Platform REST API')
      .setVersion('0.0.1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .addTag('Health', 'Health check endpoints')
      .addTag('Auth', 'Authentication endpoints')
      .addTag('Users', 'User management endpoints')
      .addTag('Monitors', 'Monitor management endpoints')
      .addTag('Changes', 'Change detection endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${configService.apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    console.log(`📚 Swagger docs available at http://localhost:${configService.port}/${configService.apiPrefix}/docs`);
  }

  // Root redirect
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/', (_req: any, res: any) => {
    if (nodeEnv !== 'production') {
      res.redirect(`/${configService.apiPrefix}/docs`);
    } else {
      res.json({ status: 'ok', message: 'Sentinel API' });
    }
  });

  const port = configService.port;
  await app.listen(port);

  console.log(`🚀 Sentinel API running on http://localhost:${port}/${configService.apiPrefix}`);
}

bootstrap();
