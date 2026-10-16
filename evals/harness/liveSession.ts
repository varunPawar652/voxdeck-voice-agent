import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { buildSessionConfig } from '../../server/src/services/realtimeSession.ts';
import type { TurnDetectionType, VadEagerness } from '../../server/src/config/env.ts';
import { DiagnosticsRecorder } from '../../client/src/lib/diagnostics.ts';
import { PresenterController } from '../../client/src/lib/presenterController.ts';
import type { ClientEvent } from '../../client/src/types/realtime.ts';
import { BYTES_PER_MS } from './caller.ts';
import type { EventLogEntry, InterruptionLog, NavigationLog, RunRecord, TurnRecord } from './types.ts';

const FRAME_MS = 100;
const FRAME_BYTES = FRAME_MS * BYTES_PER_MS;
const SILENCE = Buffer.alloc(FRAME_BYTES);

export interface LiveSessionOptions {
  scenarioId: string;
  apiKey: string;
  model: string;
  voice: string;
  transcriptionModel: string;
  vadEagerness: VadEagerness;
  turnDetection: TurnDetectionType;
  vadSilenceMs: number;
  startSlide: number;
  failNavigation?: boolean;
  log?: (line: string) => void;
}

interface Frame {
  pcm: Buffer;
  /** Set on the final frame of an utterance. */
  endsTurn?: TurnRecord;
}

/**
 * One live conversation with the Realtime API, driven by synthesized caller audio.
 *
 * Production pieces reused unchanged: `buildSessionConfig` (prompt, tool, VAD, barge-in)
 * and `PresenterController` (tool dispatch, stale-response guards, status, diagnostics).
 *
 * Transport difference: Node has no browser WebRTC stack, so this uses the Realtime
 * WebSocket. Over WebSocket the *client* owns playback, so the harness keeps a simulated
 * real-time playhead and performs the documented WebSocket interruption duty — sending
 * `conversation.item.truncate` with how much audio was actually "heard". It also emits the
 * `output_audio_buffer.*` events the browser receives over WebRTC, so the controller sees
 * the same event shapes it does in production.
 */
export class LiveVoiceSession {
  readonly diag: DiagnosticsRecorder;
  readonly controller: PresenterController;
  readonly record: RunRecord;

  private ws: WebSocket | null = null;
  private slide: number;
  private frames: Frame[] = [];
  private micTimer: NodeJS.Timeout | null = null;
  private closing = false;

  // Simulated playback
  private playheadEnd = 0;
  private playing: { responseId: string; itemId: string; startedAt: number } | null = null;
  private itemPlayback = new Map<string, { startedAt: number; durationMs: number }>();
  private stopTimer: NodeJS.Timeout | null = null;
  private locallyStale = new Set<string>();

  // Response bookkeeping
  private activeResponses = new Set<string>();
  private lastResponseActivity = 0;
  private lastResponseDoneAt = 0;

  constructor(private readonly opts: LiveSessionOptions) {
    this.slide = opts.startSlide;
    this.diag = new DiagnosticsRecorder();
    this.controller = new PresenterController(
      (event) => this.send(event),
      {
        getCurrentSlide: () => this.slide,
        goTo: (to) => {
          if (opts.failNavigation) throw new Error('Injected navigation failure (scenario H)');
          this.record.navigations.push({ at: Date.now(), from: this.slide, to, turn: this.currentTurnIndex() } satisfies NavigationLog);
          this.slide = to;
        },
      },
      undefined,
      this.diag,
    );
    this.record = {
      scenarioId: opts.scenarioId,
      startedAt: Date.now(),
      endedAt: 0,
      turns: [],
      events: [],
      diag: [],
      navigations: [],
      interruptions: [],
      finalSlide: opts.startSlide,
      transcript: [],
      statusHistory: [],
      realtimeSessionIds: [],
      notes: [],
    };
    this.controller.subscribe(() => {
      const s = this.controller.getSnapshot();
      const last = this.record.statusHistory.at(-1);
      if (!last || last.status !== s.status || last.error !== s.error) this.record.statusHistory.push({ t: Date.now(), status: s.status, error: s.error });
    });
  }

  get currentSlide() {
    return this.slide;
  }

  // ── connection ───────────────────────────────────────────────────────────
  async connect({ greet = false }: { greet?: boolean } = {}): Promise<void> {
    this.closing = false;
    this.controller.markConnecting();
    this.diag.startSession(randomUUID());
    const started = Date.now();

    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.opts.model)}`, {
      headers: { Authorization: `Bearer ${this.opts.apiKey}` },
    });
    this.ws = ws;

    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out opening the Realtime WebSocket')), 15_000);
      ws.on('message', (data) => {
        const event = JSON.parse(data.toString()) as { type: string; [k: string]: unknown };
        if (event.type === 'session.created') {
          const id = (event.session as { id?: string } | undefined)?.id;
          if (id) this.record.realtimeSessionIds.push(id);
          this.sendSessionUpdate();
        }
        if (event.type === 'session.updated') {
          clearTimeout(timeout);
          resolve();
        }
        if (event.type === 'error' && !this.micTimer) {
          clearTimeout(timeout);
          reject(new Error(`Session setup failed: ${JSON.stringify((event as { error?: unknown }).error)}`));
        }
        this.onServerEvent(event);
      });
      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    ws.on('close', () => {
      if (this.closing || this.ws !== ws) return; // a deliberate close, or a socket already replaced
      // Mirrors useVoicePresenter's onLost handler.
      this.stopMic();
      this.diag.record('session.lost', { reason: 'socket closed' });
      this.controller.markError('The voice session ended. Reconnect to continue.');
    });

    await ready;
    this.diag.record('session.connected', { ms: Date.now() - started });
    this.startMic();
    this.controller.markConnected({ greet });
  }

  private sendSessionUpdate() {
    const { model: _model, ...session } = buildSessionConfig({
      model: this.opts.model,
      voice: this.opts.voice,
      transcriptionModel: this.opts.transcriptionModel,
      currentSlide: this.slide,
      vadEagerness: this.opts.vadEagerness,
      turnDetection: this.opts.turnDetection,
      vadSilenceMs: this.opts.vadSilenceMs,
    });
    // WebSocket only: declare raw PCM formats (WebRTC negotiates codecs via SDP instead).
    const audio = {
      ...session.audio,
      input: { ...session.audio?.input, format: { type: 'audio/pcm', rate: 24000 } },
      output: { ...session.audio?.output, format: { type: 'audio/pcm', rate: 24000 } },
    };
    this.rawSend({ type: 'session.update', session: { ...session, audio } });
  }

  /** Simulates a network drop: the socket dies without a clean close from our side. */
  drop() {
    this.ws?.terminate();
  }

  async close() {
    this.closing = true;
    this.stopMic();
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.ws?.close();
    this.ws = null;
  }

  finalize(): RunRecord {
    this.record.endedAt = Date.now();
    this.record.finalSlide = this.slide;
    this.record.diag = [...this.diag.getEvents()];
    this.record.transcript = this.controller.getSnapshot().transcript;
    return this.record;
  }

  // ── microphone ───────────────────────────────────────────────────────────
  private startMic() {
    this.stopMic();
    // A live mic: one 100 ms frame every 100 ms — speech when queued, silence otherwise.
    this.micTimer = setInterval(() => {
      const frame = this.frames.shift();
      this.rawSend({ type: 'input_audio_buffer.append', audio: (frame?.pcm ?? SILENCE).toString('base64') });
      if (frame?.endsTurn) frame.endsTurn.audioEndAt = Date.now();
    }, FRAME_MS);
  }

  private stopMic() {
    if (this.micTimer) clearInterval(this.micTimer);
    this.micTimer = null;
  }

  /** Queues an utterance; resolves once its last frame has been streamed. */
  async say(text: string, pcm: Buffer): Promise<TurnRecord> {
    const turn: TurnRecord = {
      index: this.record.turns.length,
      text,
      startedAt: Date.now(),
      audioEndAt: null,
      speechStoppedAt: null,
      firstAudioAt: null,
      asrTranscript: null,
    };
    this.record.turns.push(turn);
    for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
      const chunk = Buffer.alloc(FRAME_BYTES);
      pcm.copy(chunk, 0, offset, Math.min(offset + FRAME_BYTES, pcm.length));
      this.frames.push({ pcm: chunk });
    }
    this.frames.at(-1)!.endsTurn = turn;
    this.opts.log?.(`  caller: "${text}"`);
    await this.waitFor(() => turn.audioEndAt !== null, pcm.length / BYTES_PER_MS + 5_000, 'caller audio to finish streaming');
    return turn;
  }

  // ── waiting helpers ──────────────────────────────────────────────────────
  async waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
      await sleep(50);
    }
  }

  /** The turn is complete when the assistant has answered and gone quiet. */
  async waitForTurnComplete(turn: TurnRecord, timeoutMs = 30_000): Promise<void> {
    await this.waitFor(
      () => {
        const now = Date.now();
        return (
          turn.audioEndAt !== null &&
          this.lastResponseDoneAt > turn.audioEndAt &&
          this.activeResponses.size === 0 &&
          now >= this.playheadEnd &&
          now - this.lastResponseActivity > 1_500
        );
      },
      timeoutMs,
      `turn ${turn.index} to complete`,
    );
  }

  /** Waits until the assistant has been audibly speaking (one response) for `ms`. */
  async waitForAudibleSpeech(ms: number, timeoutMs = 20_000): Promise<void> {
    await this.waitFor(() => this.playing !== null && Date.now() - this.playing.startedAt >= ms && Date.now() < this.playheadEnd, timeoutMs, `${ms} ms of assistant speech`);
  }

  // ── transport ────────────────────────────────────────────────────────────
  private send(event: ClientEvent): boolean {
    return this.rawSend(event as unknown as Record<string, unknown>);
  }

  private rawSend(event: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(event));
    return true;
  }

  private currentTurnIndex(): number {
    return Math.max(0, this.record.turns.length - 1);
  }

  private onServerEvent(event: { type: string; [k: string]: unknown }) {
    const now = Date.now();
    this.logEvent(event, now);

    switch (event.type) {
      case 'input_audio_buffer.speech_started': {
        // Forward first: the controller decides it is a barge-in while audio is still "playing".
        this.controller.handleServerEvent(event);
        if (this.playing && now < this.playheadEnd) this.interruptPlayback(now);
        return;
      }
      case 'input_audio_buffer.speech_stopped': {
        const turn = [...this.record.turns].reverse().find((t) => t.speechStoppedAt === null && t.startedAt <= now);
        if (turn) turn.speechStoppedAt = now;
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const turn = this.record.turns.find((t) => t.asrTranscript === null && t.speechStoppedAt !== null);
        if (turn) turn.asrTranscript = String(event.transcript ?? '').trim();
        break;
      }
      case 'response.created': {
        const id = (event.response as { id: string }).id;
        this.activeResponses.add(id);
        this.lastResponseActivity = now;
        break;
      }
      case 'response.done': {
        const r = event.response as { id: string; status: string };
        this.activeResponses.delete(r.id);
        this.lastResponseActivity = now;
        this.lastResponseDoneAt = now;
        const interruption = this.record.interruptions.find((i) => i.responseId === r.id && i.cancelLatencyMs === null);
        if (interruption && r.status === 'cancelled') interruption.cancelLatencyMs = now - interruption.at;
        break;
      }
      case 'response.output_audio.delta': {
        this.onAudioDelta(String(event.response_id), String(event.item_id), String(event.delta ?? ''), now);
        return; // the controller has no use for raw audio
      }
    }
    this.controller.handleServerEvent(event);
  }

  private onAudioDelta(responseId: string, itemId: string, base64: string, now: number) {
    this.lastResponseActivity = now;
    if (this.locallyStale.has(responseId)) {
      const i = this.record.interruptions.find((x) => x.responseId === responseId);
      if (i) {
        i.staleDeltasDiscarded++;
        i.lastStaleDeltaAfterMs = now - i.at;
      }
      return; // never "played"
    }
    const durationMs = (Buffer.byteLength(base64, 'base64') / BYTES_PER_MS) | 0;
    const startAt = Math.max(now, this.playheadEnd);
    if (!this.playing || this.playing.responseId !== responseId) {
      this.playing = { responseId, itemId, startedAt: startAt };
      const turn = this.record.turns.at(-1);
      if (turn && turn.firstAudioAt === null && turn.audioEndAt !== null) turn.firstAudioAt = now;
      this.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: responseId });
    }
    const item = this.itemPlayback.get(itemId) ?? { startedAt: startAt, durationMs: 0 };
    item.durationMs += durationMs;
    this.itemPlayback.set(itemId, item);
    this.playheadEnd = startAt + durationMs;
    this.scheduleStopCheck();
  }

  private scheduleStopCheck() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.playing && Date.now() >= this.playheadEnd) {
        const responseId = this.playing.responseId;
        this.playing = null;
        this.controller.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: responseId });
      }
    }, Math.max(0, this.playheadEnd - Date.now()) + 20);
  }

  /** WebSocket barge-in duty: stop playback and truncate the item to what was actually heard. */
  private interruptPlayback(now: number) {
    const { responseId, itemId } = this.playing!;
    const item = this.itemPlayback.get(itemId);
    const playedMs = item ? Math.max(0, Math.min(item.durationMs, now - item.startedAt)) : 0;
    this.rawSend({ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: playedMs });
    this.locallyStale.add(responseId);
    this.record.interruptions.push({
      at: now,
      turn: this.currentTurnIndex() + 1,
      responseId,
      itemId,
      playedMs,
      // null until the server confirms cancellation; stays null if generation had already finished
      // (then there is nothing to cancel — only unplayed audio to truncate).
      cancelLatencyMs: null,
      staleDeltasDiscarded: 0,
      lastStaleDeltaAfterMs: null,
    } satisfies InterruptionLog);
    this.playing = null;
    this.playheadEnd = now;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.controller.handleServerEvent({ type: 'output_audio_buffer.cleared', response_id: responseId });
    this.opts.log?.(`  ⟂ barge-in: truncated ${itemId} at ${playedMs} ms`);
  }

  private logEvent(event: { type: string; [k: string]: unknown }, t: number) {
    if (event.type === 'response.output_audio.delta' || event.type.endsWith('.delta')) return;
    const entry: EventLogEntry = { t, type: event.type };
    const response = event.response as { id?: string; status?: string; status_details?: { reason?: string } | null; output?: { type: string; name?: string; call_id?: string; arguments?: string }[] } | undefined;
    if (response?.id) entry.responseId = response.id;
    if (typeof event.response_id === 'string') entry.responseId = event.response_id;
    if (typeof event.item_id === 'string') entry.itemId = event.item_id;
    if (response?.status) entry.status = response.status;
    if (event.type === 'response.done') {
      entry.reason = response?.status_details?.reason ?? null;
      const calls = (response?.output ?? []).filter((o) => o.type === 'function_call');
      if (calls.length) entry.calls = calls.map((c) => ({ name: c.name ?? '', callId: c.call_id ?? '', args: c.arguments ?? '' }));
    }
    if (event.type === 'error') entry.code = String((event.error as { code?: string } | undefined)?.code ?? '');
    this.record.events.push(entry);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
