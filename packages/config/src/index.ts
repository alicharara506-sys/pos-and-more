import { z } from 'zod';

/**
 * Validates process.env once at boot. Every app (api, worker) calls
 * `loadEnv()` on startup and fails fast with a readable error instead of
 * crashing deep inside a request handler with `undefined is not a function`.
 * Fields are optional where a feature is legitimately not configured yet
 * (see .env.example) — callers must check for presence before using a
 * provider-backed feature, and the corresponding adapter must report itself
 * unconfigured rather than silently no-op.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  AUTH_JWT_SECRET: z.string().min(32).optional(),
  AUTH_ENCRYPTION_KEY: z.string().min(32).optional(),
  AUTH_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(43200),
  AUTH_MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  APPLE_OAUTH_CLIENT_ID: z.string().optional(),
  APPLE_OAUTH_TEAM_ID: z.string().optional(),
  APPLE_OAUTH_KEY_ID: z.string().optional(),
  APPLE_OAUTH_PRIVATE_KEY_BASE64: z.string().optional(),
  APPLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_BASE_MONTHLY: z.string().optional(),
  STRIPE_PRICE_BRANCH_MONTHLY: z.string().optional(),
  STRIPE_PRICE_USER_MONTHLY: z.string().optional(),

  EMAIL_PROVIDER: z.enum(['console', 'sendgrid', 'resend']).default('console'),
  EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@salesmasterpro.example'),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  SMS_PROVIDER: z.enum(['none', 'twilio']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  AI_PROVIDER: z.enum(['none', 'anthropic', 'local']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_LOCAL_MODEL_ENDPOINT: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  PLATFORM_ADMIN_JWT_SECRET: z.string().min(32).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cachedEnv) return cachedEnv;
  // .env.example ships every optional key present but blank (`KEY=`) so the
  // full option list is discoverable. Shell-sourcing or dotenv loaders turn
  // that into an empty string, which is NOT the same as "unset" for a Zod
  // `.optional()` field — treat blank values as unset here so an unfilled
  // optional secret doesn't fail validation.
  const normalized = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== ''),
  ) as NodeJS.ProcessEnv;
  const result = envSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${issues}\nSee .env.example for the full list.`,
    );
  }
  cachedEnv = result.data;
  return cachedEnv;
}

/** Test-only: clears the cached env so a suite can reload with different values. */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
