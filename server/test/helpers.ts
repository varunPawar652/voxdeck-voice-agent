import { pino } from 'pino';
import type { AppConfig } from '../src/config/env.ts';

export const FAKE_KEY = 'sk-test-THIS-MUST-NEVER-LEAK-1234567890';

export const silentLogger = pino({ level: 'silent' });

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    clientOrigin: 'http://localhost:5173',
    openaiApiKey: FAKE_KEY,
    realtimeModel: 'gpt-realtime',
    realtimeVoice: 'marin',
    transcriptionModel: 'gpt-4o-mini-transcribe',
    clientSecretTtlSeconds: 120,
    logLevel: 'silent',
    ...overrides,
  };
}
