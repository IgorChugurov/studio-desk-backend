import { existsSync } from 'node:fs';
import { z } from 'zod';

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().positive(),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_OWNER_PASSWORD: z.string().min(1),
  DB_PLATFORM_API_PASSWORD: z.string().min(1),
  DB_STUDIO_API_PASSWORD: z.string().min(1),
  DB_PUBLIC_API_PASSWORD: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  RESEND_FROM_EMAIL: z.string().min(1),
  PLATFORM_ADMIN_EMAIL: z.email(),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  // Extra browser origins allowed by CORS, comma-separated, for example
  // "http://admin.localhost:3001" when a frontend runs on a developer machine.
  CORS_EXTRA_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z.array(
        z
          .url()
          .refine(
            (origin) => new URL(origin).origin === origin,
            'must be an origin without a path, for example http://localhost:3001',
          ),
      ),
    ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Reads `.env` (if present; real environment variables take precedence),
 * validates all settings, and stops the process with the list of failing
 * settings if any is missing or malformed.
 */
export function loadEnv(): Env {
  if (cached) return cached;
  if (existsSync('.env')) process.loadEnvFile('.env');

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = result.data;
  return cached;
}
