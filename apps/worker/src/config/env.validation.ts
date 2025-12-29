import { z } from 'zod';

export const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().default('0'),

  // Worker concurrency
  WORKER_CONCURRENCY_RULES: z.string().default('5'),
  WORKER_CONCURRENCY_ALERTS: z.string().default('10'),

  // Rate limiting
  RATE_LIMITING_ENABLED: z.string().default('false'),
  RATE_LIMIT_PER_DOMAIN: z.string().default('3'),

  // Encryption (CRITICAL - no fallback allowed)
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),

  // Email providers (optional)
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // SMTP (optional)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
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
