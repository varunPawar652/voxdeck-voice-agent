import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.ts';
import { FAKE_KEY } from './helpers.ts';

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3001,
      clientOrigin: 'http://localhost:5173',
      realtimeModel: 'gpt-realtime',
      realtimeVoice: 'marin',
      clientSecretTtlSeconds: 120,
      turnDetection: 'server_vad',
      vadSilenceMs: 500,
      openaiApiKey: undefined,
    });
  });

  it('reads overrides and normalises the origin', () => {
    const c = loadConfig({ PORT: '4000', CLIENT_ORIGIN: 'http://127.0.0.1:5173/', OPENAI_API_KEY: FAKE_KEY, OPENAI_REALTIME_VOICE: 'cedar' });
    expect(c.port).toBe(4000);
    expect(c.clientOrigin).toBe('http://127.0.0.1:5173');
    expect(c.openaiApiKey).toBe(FAKE_KEY);
    expect(c.realtimeVoice).toBe('cedar');
  });

  it('treats an empty key as missing', () => {
    expect(loadConfig({ OPENAI_API_KEY: '   ' }).openaiApiKey).toBeUndefined();
  });

  it.each([
    [{ PORT: 'abc' }, /PORT/],
    [{ CLIENT_ORIGIN: 'not a url' }, /CLIENT_ORIGIN/],
    [{ CLIENT_SECRET_TTL_SECONDS: '5' }, /CLIENT_SECRET_TTL_SECONDS/],
  ])('rejects invalid %j', (env, pattern) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(pattern);
  });

  it('rejects a malformed key without echoing it', () => {
    let message = '';
    try {
      loadConfig({ OPENAI_API_KEY: 'pk-live-secret-value' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/OPENAI_API_KEY/);
    expect(message).not.toContain('pk-live-secret-value');
  });
});
