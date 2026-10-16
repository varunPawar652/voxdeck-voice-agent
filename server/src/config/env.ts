import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  CLIENT_ORIGIN: z.url({ error: 'CLIENT_ORIGIN must be a full origin, e.g. http://localhost:5173' }).default('http://localhost:5173'),
  // Optional at boot so the UI can show a clear "not configured" error instead of a dead server.
  OPENAI_API_KEY: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  OPENAI_REALTIME_MODEL: z.string().trim().min(1).default('gpt-realtime'),
  OPENAI_REALTIME_VOICE: z.string().trim().min(1).default('marin'),
  OPENAI_TRANSCRIPTION_MODEL: z.string().trim().min(1).default('gpt-4o-mini-transcribe'),
  CLIENT_SECRET_TTL_SECONDS: z.coerce.number().int().min(10).max(7200).default(120),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  clientOrigin: string;
  openaiApiKey: string | undefined;
  realtimeModel: string;
  realtimeVoice: string;
  transcriptionModel: string;
  clientSecretTtlSeconds: number;
  logLevel: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and rules only — never echo the values themselves.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new ConfigError(`Invalid environment configuration:\n  ${problems}`);
  }
  const e = parsed.data;
  if (e.OPENAI_API_KEY && !e.OPENAI_API_KEY.startsWith('sk-')) {
    throw new ConfigError('OPENAI_API_KEY does not look like an OpenAI API key (expected it to start with "sk-").');
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    clientOrigin: new URL(e.CLIENT_ORIGIN).origin,
    openaiApiKey: e.OPENAI_API_KEY,
    realtimeModel: e.OPENAI_REALTIME_MODEL,
    realtimeVoice: e.OPENAI_REALTIME_VOICE,
    transcriptionModel: e.OPENAI_TRANSCRIPTION_MODEL,
    clientSecretTtlSeconds: e.CLIENT_SECRET_TTL_SECONDS,
    logLevel: e.LOG_LEVEL,
  };
}
