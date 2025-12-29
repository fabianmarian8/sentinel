import { z } from 'zod';

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRATION: z.string().default('7d'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  // API
  API_PREFIX: z.string().default('api'),
  THROTTLE_TTL: z.string().default('60'),
  THROTTLE_LIMIT: z.string().default('10'),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173'),

  // Scheduler
  SCHEDULER_ENABLED: z.string().default('true'),
  SCHEDULER_TICK_INTERVAL: z.string().default('5000'),
  SCHEDULER_BATCH_SIZE: z.string().default('500'),

  // Encryption
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.errors.map(err =>
      `${err.path.join('.')}: ${err.message}`
    ).join('\n');

    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}
