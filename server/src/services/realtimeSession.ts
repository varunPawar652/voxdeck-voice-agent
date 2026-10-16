import OpenAI from 'openai';
import type { ClientSecretCreateParams, ClientSecretCreateResponse } from 'openai/resources/realtime/client-secrets';
import type { RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime';
import { buildInstructions, navigateToSlideTool, type CreateSessionResponse } from '@voxdeck/shared';
import type { AppConfig, TurnDetectionType, VadEagerness } from '../config/env.ts';
import { HttpError } from '../lib/httpError.ts';
import type { Logger } from '../lib/logger.ts';

export interface SessionOptions {
  model: string;
  voice: string;
  transcriptionModel: string;
  currentSlide: number;
  vadEagerness?: VadEagerness;
  turnDetection?: TurnDetectionType;
  vadSilenceMs?: number;
}

type TurnDetection = NonNullable<NonNullable<NonNullable<RealtimeSessionCreateRequest['audio']>['input']>['turn_detection']>;

/**
 * Both modes keep barge-in on: user speech cancels the in-flight response and the server
 * truncates unplayed audio so the conversation history matches what was actually heard.
 */
export function buildTurnDetection(opts: Pick<SessionOptions, 'turnDetection' | 'vadEagerness' | 'vadSilenceMs'>): TurnDetection {
  if (opts.turnDetection === 'server_vad') {
    // Plain silence timer: fast and predictable, but can cut off a user who pauses mid-thought.
    return { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: opts.vadSilenceMs ?? 500, create_response: true, interrupt_response: true };
  }
  // Semantic VAD waits for a *semantically* finished turn, so a user pausing mid-thought
  // ("Wait… explain tool calling instead") is not cut off, yet speech still interrupts instantly.
  return { type: 'semantic_vad', eagerness: opts.vadEagerness ?? 'auto', create_response: true, interrupt_response: true };
}

/**
 * The complete Realtime session, fixed server-side. Because instructions, tools and
 * turn detection are baked into the ephemeral secret, the browser cannot widen the
 * model's capabilities — it can only connect to the session we defined.
 */
export function buildSessionConfig(opts: SessionOptions): RealtimeSessionCreateRequest {
  return {
    type: 'realtime',
    model: opts.model,
    instructions: buildInstructions(opts.currentSlide),
    output_modalities: ['audio'],
    audio: {
      input: {
        // Live captions of the user's speech for the transcript panel.
        transcription: { model: opts.transcriptionModel, language: 'en' },
        // Laptop mic + speakers: suppress room echo so playback doesn't trigger false barge-ins.
        noise_reduction: { type: 'near_field' },
        turn_detection: buildTurnDetection(opts),
      },
      output: { voice: opts.voice },
    },
    tools: [navigateToSlideTool as unknown as NonNullable<RealtimeSessionCreateRequest['tools']>[number]],
    tool_choice: 'auto',
    // At most one slide change per response: no racing navigations.
    parallel_tool_calls: false,
  };
}

/** The slice of the OpenAI SDK we depend on — lets tests inject a fake. */
export interface ClientSecretsApi {
  create(body: ClientSecretCreateParams): Promise<ClientSecretCreateResponse>;
}

export interface RealtimeSessionService {
  readonly configured: boolean;
  createSession(input: { currentSlide: number; clientSessionId?: string }): Promise<CreateSessionResponse>;
}

export function createRealtimeSessionService(
  config: AppConfig,
  logger: Logger,
  clientSecrets?: ClientSecretsApi,
): RealtimeSessionService {
  const api: ClientSecretsApi | undefined =
    clientSecrets ??
    (config.openaiApiKey
      ? new OpenAI({ apiKey: config.openaiApiKey, timeout: 10_000, maxRetries: 1 }).realtime.clientSecrets
      : undefined);

  return {
    configured: Boolean(api),
    async createSession({ currentSlide, clientSessionId }) {
      if (!api) {
        throw new HttpError(
          503,
          'openai_not_configured',
          'The server has no OPENAI_API_KEY. Add it to .env and restart the server.',
        );
      }

      const session = buildSessionConfig({
        model: config.realtimeModel,
        voice: config.realtimeVoice,
        transcriptionModel: config.transcriptionModel,
        currentSlide,
        vadEagerness: config.vadEagerness,
        turnDetection: config.turnDetection,
        vadSilenceMs: config.vadSilenceMs,
      });

      const started = Date.now();
      let secret: ClientSecretCreateResponse;
      try {
        secret = await api.create({
          expires_after: { anchor: 'created_at', seconds: config.clientSecretTtlSeconds },
          session,
        });
      } catch (err) {
        throw toUpstreamError(err, logger.child({ clientSessionId }));
      }

      if (!secret?.value || typeof secret.expires_at !== 'number') {
        logger.error({ event: 'realtime.client_secret.malformed' }, 'Upstream returned an unexpected client-secret shape');
        throw new HttpError(502, 'upstream_malformed', 'The voice service returned an unexpected response.');
      }

      logger.info(
        { event: 'realtime.client_secret.created', clientSessionId, model: config.realtimeModel, voice: config.realtimeVoice, turnDetection: config.turnDetection, vadEagerness: config.vadEagerness, ms: Date.now() - started, expiresAt: secret.expires_at },
        'Created ephemeral Realtime client secret',
      );
      return {
        clientSecret: secret.value,
        expiresAt: secret.expires_at,
        model: config.realtimeModel,
        voice: config.realtimeVoice,
      };
    },
  };
}

/**
 * Translates upstream failures into browser-safe errors. Upstream messages are logged
 * by status/request-id only — OpenAI auth errors can echo a fragment of the key.
 */
export function toUpstreamError(err: unknown, logger: Logger): HttpError {
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : undefined;
  const requestId = typeof err === 'object' && err !== null && 'requestID' in err ? (err as { requestID: unknown }).requestID : undefined;
  logger.error({ event: 'realtime.client_secret.failed', upstreamStatus: status ?? null, requestId, errorName: (err as Error)?.name }, 'Failed to create Realtime client secret');

  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new HttpError(504, 'upstream_timeout', 'The voice service timed out. Please try again.');
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new HttpError(502, 'upstream_unreachable', 'Could not reach the OpenAI API. Check your network connection.');
  }
  switch (status) {
    case 401:
    case 403:
      return new HttpError(502, 'upstream_auth', 'OpenAI rejected the server\'s API key. Check OPENAI_API_KEY and its Realtime access.');
    case 400:
    case 404:
      return new HttpError(502, 'upstream_bad_request', 'OpenAI rejected the session configuration. Check OPENAI_REALTIME_MODEL and OPENAI_REALTIME_VOICE.');
    case 429: {
      const code = typeof err === 'object' && err !== null ? (err as { code?: unknown; type?: unknown }) : {};
      if (code.code === 'insufficient_quota' || code.type === 'insufficient_quota' || code.code === 'credit_balance_exhausted') {
        return new HttpError(503, 'upstream_insufficient_quota', 'Your OpenAI account has no API credits left. Add credits at platform.openai.com → Settings → Billing.');
      }
      return new HttpError(503, 'upstream_rate_limited', 'OpenAI rate limit reached. Wait a moment and try again.');
    }
    default:
      return new HttpError(502, 'upstream_error', 'The voice service is unavailable right now. Please try again.');
  }
}
