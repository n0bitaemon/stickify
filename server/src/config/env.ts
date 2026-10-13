import path from 'node:path';
import { z } from 'zod';

/**
 * Configuration is read once from environment variables and validated with zod.
 * The app stops at startup on bad configuration instead of failing silently at runtime.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/stickify'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters').default('dev-only-secret-change-me-please'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  STORAGE_DIR: z.string().default(path.resolve(process.cwd(), 'storage')),
  /** Frontend origin when it runs separately (Vite) without the proxy. Leave empty for same-origin. */
  CORS_ORIGIN: z.string().optional(),
  /** Built web app that Express serves in production. */
  WEB_DIST_DIR: z.string().default(path.resolve(process.cwd(), '../web/dist')),

  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(60),
  /** Media jobs running in parallel (sharp/ffmpeg are CPU/RAM heavy). */
  PROCESSING_CONCURRENCY: z.coerce.number().int().positive().default(2),
  /** Background jobs (export/import) running in parallel. They mostly wait on mediaQueue, so this can be higher. */
  JOB_CONCURRENCY: z.coerce.number().int().positive().default(3),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  /** Enables the bot's long polling. Turn off when the token is only used for link imports. */
  TELEGRAM_BOT_POLLING: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev-only')) {
    throw new Error('Set your own JWT_SECRET when running in production');
  }
  return env;
}

export const env = loadEnv();
