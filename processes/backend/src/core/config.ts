import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  API_TOKEN: z
    .string()
    .min(32)
    .refine((v) => !v.startsWith('replace-'), 'Replace the example token.'),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').length === 32,
      'Expected a base64 encoded 32-byte key.',
    ),
  INSTALLATION_ID: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,64}$/)
    .default('local-desktop'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  BROWSER_POOL_SIZE: z.coerce.number().int().min(1).max(16).default(2),
  BROWSER_HEADLESS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  BROWSER_CHANNEL: z.enum(['chromium', 'chrome', 'msedge']).default('chromium'),
  BROWSER_DATA_DIR: z.string().min(1).optional(),
  BROWSER_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(100).max(300000).default(30000),
  BROWSER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
  BROWSER_ACTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(15000),
  BROWSER_NAVIGATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(30000),
  BROWSER_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3600000).default(300000),
  BROWSER_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(2592000).default(259200),
  WEVERSE_OTP_SENDER: z.string().email().default('noreply@weverse.io'),
  PROXY_PROBE_URL: z
    .string()
    .url()
    .refine((v) => ['https:', 'http:'].includes(new URL(v).protocol), 'Use an HTTP(S) probe URL.')
    .default('https://example.com/'),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. See .env.example.`,
    );
  return parsed.data;
}
