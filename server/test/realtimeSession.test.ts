import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import type { ClientSecretCreateParams } from 'openai/resources/realtime/client-secrets';
import { NAVIGATE_TOOL_NAME } from '@voxdeck/shared';
import { HttpError } from '../src/lib/httpError.ts';
import { buildSessionConfig, createRealtimeSessionService, type ClientSecretsApi } from '../src/services/realtimeSession.ts';
import { FAKE_KEY, silentLogger, testConfig } from './helpers.ts';

const okSecret = { value: 'ek_test_123', expires_at: 1_900_000_000, session: {} as never };

function fakeApi(impl: ClientSecretsApi['create']): ClientSecretsApi & { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn(impl) };
}

describe('buildSessionConfig', () => {
  const session = buildSessionConfig({ model: 'gpt-realtime', voice: 'marin', transcriptionModel: 'gpt-4o-mini-transcribe', currentSlide: 2 });

  it('targets a GA realtime session with audio output', () => {
    expect(session.type).toBe('realtime');
    expect(session.model).toBe('gpt-realtime');
    expect(session.output_modalities).toEqual(['audio']);
    expect(session.audio?.output?.voice).toBe('marin');
  });

  it('enables server-side VAD with automatic barge-in', () => {
    expect(session.audio?.input?.turn_detection).toMatchObject({
      type: 'semantic_vad',
      create_response: true,
      interrupt_response: true,
    });
  });

  it('can use a plain silence-timer VAD, still with barge-in', () => {
    const s = buildSessionConfig({ model: 'm', voice: 'v', transcriptionModel: 't', currentSlide: 1, turnDetection: 'server_vad', vadSilenceMs: 400 });
    expect(s.audio?.input?.turn_detection).toEqual({
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 400,
      create_response: true,
      interrupt_response: true,
    });
  });

  it('transcribes user audio for the transcript panel', () => {
    expect(session.audio?.input?.transcription?.model).toBe('gpt-4o-mini-transcribe');
  });

  it('exposes only the navigation tool, one call at a time', () => {
    expect(session.tools).toHaveLength(1);
    expect(session.tools?.[0]).toMatchObject({ type: 'function', name: NAVIGATE_TOOL_NAME });
    expect(session.tool_choice).toBe('auto');
    expect(session.parallel_tool_calls).toBe(false);
  });

  it('grounds the instructions in the starting slide', () => {
    expect(session.instructions).toContain('slide currently on screen is slide 2');
  });
});

describe('RealtimeSessionService.createSession', () => {
  it('mints a short-lived secret and returns only browser-safe fields', async () => {
    const api = fakeApi(async () => okSecret);
    const service = createRealtimeSessionService(testConfig({ clientSecretTtlSeconds: 90 }), silentLogger, api);

    const result = await service.createSession({ currentSlide: 3 });

    expect(result).toEqual({ clientSecret: 'ek_test_123', expiresAt: 1_900_000_000, model: 'gpt-realtime', voice: 'marin' });
    const body = api.create.mock.calls[0]![0] as ClientSecretCreateParams;
    expect(body.expires_after).toEqual({ anchor: 'created_at', seconds: 90 });
    expect((body.session as { instructions: string }).instructions).toContain('slide 3');
    expect(JSON.stringify(result)).not.toContain(FAKE_KEY);
  });

  it('reports a clear 503 when no API key is configured', async () => {
    const service = createRealtimeSessionService(testConfig({ openaiApiKey: undefined }), silentLogger);
    expect(service.configured).toBe(false);
    await expect(service.createSession({ currentSlide: 1 })).rejects.toMatchObject({ status: 503, code: 'openai_not_configured' });
  });

  it.each([
    [401, 502, 'upstream_auth'],
    [403, 502, 'upstream_auth'],
    [400, 502, 'upstream_bad_request'],
    [429, 503, 'upstream_rate_limited'],
    [500, 502, 'upstream_error'],
  ])('maps upstream HTTP %i to %i %s without leaking upstream text', async (upstream, status, code) => {
    const leaky = Object.assign(new Error(`Incorrect API key provided: ${FAKE_KEY}`), { status: upstream });
    const service = createRealtimeSessionService(testConfig(), silentLogger, fakeApi(async () => Promise.reject(leaky)));

    const err = (await service.createSession({ currentSlide: 1 }).catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain(FAKE_KEY);
    expect(err.message).not.toContain('Incorrect API key');
  });

  it('distinguishes an exhausted credit balance from a rate limit', async () => {
    const quota = Object.assign(new Error('You have no credits remaining.'), { status: 429, type: 'insufficient_quota', code: 'credit_balance_exhausted' });
    const service = createRealtimeSessionService(testConfig(), silentLogger, fakeApi(async () => Promise.reject(quota)));
    await expect(service.createSession({ currentSlide: 1 })).rejects.toMatchObject({ status: 503, code: 'upstream_insufficient_quota' });
  });

  it('maps network failures and timeouts', async () => {
    const offline = createRealtimeSessionService(testConfig(), silentLogger, fakeApi(async () => Promise.reject(new OpenAI.APIConnectionError({ message: 'ECONNREFUSED' }))));
    await expect(offline.createSession({ currentSlide: 1 })).rejects.toMatchObject({ status: 502, code: 'upstream_unreachable' });

    const slow = createRealtimeSessionService(testConfig(), silentLogger, fakeApi(async () => Promise.reject(new OpenAI.APIConnectionTimeoutError())));
    await expect(slow.createSession({ currentSlide: 1 })).rejects.toMatchObject({ status: 504, code: 'upstream_timeout' });
  });

  it('rejects a malformed upstream response', async () => {
    const service = createRealtimeSessionService(testConfig(), silentLogger, fakeApi(async () => ({ session: {} }) as never));
    await expect(service.createSession({ currentSlide: 1 })).rejects.toMatchObject({ status: 502, code: 'upstream_malformed' });
  });
});
