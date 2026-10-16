import {
  NAVIGATE_TOOL_NAME,
  formatZodError,
  getSlide,
  navigateToSlideArgsSchema,
  type NavigateToSlideArgs,
} from '@voxdeck/shared';
import type { ClientEvent, FunctionCallItem, RealtimeResponse, ServerEvent } from '../types/realtime.ts';

export type PresenterStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'interrupted' | 'error';

export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'event';
  text: string;
  state: 'streaming' | 'done' | 'interrupted';
  responseId?: string;
}

export interface NavigationRecord {
  callId: string;
  slide: number;
  reason: string;
  at: number;
}

export interface PresenterSnapshot {
  status: PresenterStatus;
  transcript: TranscriptEntry[];
  lastNavigation: NavigationRecord | null;
  error: string | null;
}

export interface DeckPort {
  getCurrentSlide(): number;
  goTo(slide: number, source: 'agent' | 'user'): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** Upper bound for a `next_sentence` transition — the slide must not lag the voice for long. */
export const NEXT_SENTENCE_MAX_WAIT_MS = 2500;
/** How long the "Interrupted" badge stays up before settling back to listening. */
export const INTERRUPTED_BADGE_MS = 900;

interface PendingNavigation {
  callId: string;
  args: NavigateToSlideArgs;
  epoch: number;
  timer: unknown;
}

/**
 * Turns Realtime server events into slide changes, client events and UI state.
 *
 * Framework-free so it can be unit-tested with a fake `send`, deck and clock.
 * The deck (React state) stays the source of truth: every navigation goes through
 * `deck.goTo`, and the model is told the outcome via `function_call_output`.
 */
export class PresenterController {
  private snapshot: PresenterSnapshot = { status: 'idle', transcript: [], lastNavigation: null, error: null };
  private listeners = new Set<() => void>();

  private activeResponseId: string | null = null;
  private playingResponseId: string | null = null;
  /** Responses that were interrupted — anything they produce afterwards is ignored. */
  private staleResponses = new Set<string>();
  /** Calls we have accepted for execution (possibly deferred). */
  private handledCallIds = new Set<string>();
  /** Calls whose function_call_output has been sent — guarantees exactly one output per call. */
  private answeredCallIds = new Set<string>();
  /** Bumped by interruptions and manual navigation; deferred navigations from an older epoch are dropped. */
  private navEpoch = 0;
  private pendingNav: PendingNavigation | null = null;
  private badgeTimer: unknown = null;

  constructor(
    private readonly send: (event: ClientEvent) => boolean,
    private readonly deck: DeckPort,
    private readonly scheduler: Scheduler = realScheduler,
  ) {}

  // ── store plumbing (useSyncExternalStore) ────────────────────────────────
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private update(patch: Partial<PresenterSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }

  private setStatus(status: PresenterStatus) {
    if (this.snapshot.status !== status) this.update({ status });
  }

  private upsertEntry(id: string, patch: Partial<TranscriptEntry> & { appendText?: string }) {
    const transcript = [...this.snapshot.transcript];
    const index = transcript.findIndex((e) => e.id === id);
    const { appendText, ...rest } = patch;
    if (index === -1) {
      transcript.push({ id, role: 'assistant', text: appendText ?? '', state: 'streaming', ...rest });
    } else {
      const current = transcript[index]!;
      transcript[index] = { ...current, ...rest, text: appendText !== undefined ? current.text + appendText : (rest.text ?? current.text) };
    }
    this.update({ transcript: transcript.slice(-80) });
  }

  private logEvent(text: string) {
    this.upsertEntry(`event-${this.scheduler.now()}-${this.snapshot.transcript.length}`, { role: 'event', text, state: 'done' });
  }

  // ── lifecycle ────────────────────────────────────────────────────────────
  markConnecting() {
    this.reset();
    this.update({ status: 'connecting', error: null });
  }

  /** Data channel is open: greet the audience, or go straight to a queued question. */
  markConnected(initialQuestion?: string) {
    this.setStatus('listening');
    if (initialQuestion) this.askText(initialQuestion);
    else this.send({ type: 'response.create' });
  }

  markError(message: string) {
    this.clearPendingNavigation();
    this.update({ status: 'error', error: message });
  }

  markDisconnected() {
    this.reset();
    this.update({ status: 'idle' });
  }

  private reset() {
    this.clearPendingNavigation();
    if (this.badgeTimer) this.scheduler.clearTimeout(this.badgeTimer);
    this.activeResponseId = null;
    this.playingResponseId = null;
    this.staleResponses.clear();
    this.handledCallIds.clear();
    this.answeredCallIds.clear();
    this.navEpoch++;
  }

  // ── user actions ─────────────────────────────────────────────────────────
  /** Manual "Interrupt" button: cancel generation, then flush unplayed audio (which also truncates history). */
  interrupt() {
    const responseId = this.activeResponseId;
    const playing = this.playingResponseId;
    if (!responseId && !playing) return;

    this.beginInterruption();
    if (responseId) this.send({ type: 'response.cancel', response_id: responseId });
    if (playing || responseId) this.send({ type: 'output_audio_buffer.clear' });
    this.logEvent('Presenter interrupted');
  }

  /** A typed question (example chips). Behaves like a spoken turn, including barge-in. */
  askText(text: string) {
    const question = text.trim().slice(0, 500);
    if (!question) return;
    if (this.activeResponseId || this.playingResponseId) this.interrupt();
    this.upsertEntry(`typed-${this.scheduler.now()}-${this.snapshot.transcript.length}`, { role: 'user', text: question, state: 'done' });
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] } });
    this.send({ type: 'response.create' });
    this.setStatus('thinking');
  }

  /** The user clicked prev/next/outline: keep the model's picture of the screen in sync. */
  notifyManualNavigation(slide: number) {
    this.navEpoch++;
    this.clearPendingNavigation('superseded by manual navigation');
    const info = getSlide(slide);
    if (!info || this.snapshot.status === 'idle' || this.snapshot.status === 'connecting') return;
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: `[deck] The user manually moved to slide ${slide}: "${info.title}". It is now on screen.` }],
      },
    });
  }

  // ── server events ────────────────────────────────────────────────────────
  handleServerEvent(raw: unknown) {
    if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') return;
    const event = raw as ServerEvent;

    switch (event.type) {
      case 'input_audio_buffer.speech_started': {
        const e = event as Extract<ServerEvent, { type: 'input_audio_buffer.speech_started' }>;
        // Barge-in: the server (interrupt_response: true) cancels the response and truncates
        // unplayed audio itself. Our job is to drop everything that response still owns.
        if (this.activeResponseId || this.playingResponseId) this.beginInterruption();
        else this.setStatus('listening');
        if (e.item_id) this.upsertEntry(e.item_id, { role: 'user', text: '', state: 'streaming' });
        break;
      }
      case 'input_audio_buffer.speech_stopped':
        if (this.snapshot.status !== 'interrupted') this.setStatus('thinking');
        break;

      case 'conversation.item.input_audio_transcription.delta': {
        const e = event as Extract<ServerEvent, { type: 'conversation.item.input_audio_transcription.delta' }>;
        this.upsertEntry(e.item_id, { role: 'user', appendText: e.delta });
        break;
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const e = event as Extract<ServerEvent, { type: 'conversation.item.input_audio_transcription.completed' }>;
        this.upsertEntry(e.item_id, { role: 'user', text: e.transcript.trim(), state: 'done' });
        break;
      }
      case 'conversation.item.input_audio_transcription.failed': {
        const e = event as Extract<ServerEvent, { type: 'conversation.item.input_audio_transcription.failed' }>;
        this.upsertEntry(e.item_id, { role: 'user', text: '(could not transcribe)', state: 'done' });
        break;
      }

      case 'response.created': {
        const e = event as Extract<ServerEvent, { type: 'response.created' }>;
        this.activeResponseId = e.response?.id ?? null;
        if (this.snapshot.status !== 'speaking') this.setStatus('thinking');
        break;
      }
      case 'response.output_audio_transcript.delta': {
        const e = event as Extract<ServerEvent, { type: 'response.output_audio_transcript.delta' }>;
        if (this.staleResponses.has(e.response_id)) break;
        this.upsertEntry(e.item_id, { role: 'assistant', appendText: e.delta, responseId: e.response_id });
        break;
      }
      case 'response.output_audio_transcript.done': {
        const e = event as Extract<ServerEvent, { type: 'response.output_audio_transcript.done' }>;
        if (this.staleResponses.has(e.response_id)) break;
        this.upsertEntry(e.item_id, { role: 'assistant', text: e.transcript, state: 'done', responseId: e.response_id });
        break;
      }

      case 'output_audio_buffer.started': {
        const id = (event as { response_id?: string }).response_id ?? null;
        if (id && this.staleResponses.has(id)) break;
        this.playingResponseId = id;
        this.setStatus('speaking');
        break;
      }
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': {
        this.playingResponseId = null;
        this.flushPendingNavigation();
        if (!this.activeResponseId && this.snapshot.status === 'speaking') this.setStatus('listening');
        break;
      }

      case 'response.done':
        this.handleResponseDone((event as Extract<ServerEvent, { type: 'response.done' }>).response);
        break;

      case 'error': {
        const e = event as Extract<ServerEvent, { type: 'error' }>;
        // Benign race: we cancelled a response that had just finished.
        if (e.error?.code === 'response_cancel_not_active') break;
        console.warn('[realtime] server error', e.error);
        this.logEvent(`Voice service: ${e.error?.message ?? 'unknown error'}`);
        break;
      }
    }
  }

  private beginInterruption() {
    if (this.activeResponseId) this.staleResponses.add(this.activeResponseId);
    if (this.playingResponseId) this.staleResponses.add(this.playingResponseId);
    this.navEpoch++;
    this.clearPendingNavigation('cancelled: the user interrupted');

    const transcript = this.snapshot.transcript.map((entry) =>
      entry.role === 'assistant' && entry.state === 'streaming' ? { ...entry, state: 'interrupted' as const } : entry,
    );
    this.activeResponseId = null;
    this.playingResponseId = null;
    this.update({ transcript, status: 'interrupted' });

    if (this.badgeTimer) this.scheduler.clearTimeout(this.badgeTimer);
    this.badgeTimer = this.scheduler.setTimeout(() => {
      this.badgeTimer = null;
      if (this.snapshot.status === 'interrupted') this.setStatus('listening');
    }, INTERRUPTED_BADGE_MS);
  }

  private handleResponseDone(response: RealtimeResponse | undefined) {
    if (!response?.id) return;
    const calls = (response.output ?? []).filter((item): item is FunctionCallItem => item?.type === 'function_call');
    const stale = this.staleResponses.has(response.id) || response.status === 'cancelled';

    if (this.activeResponseId === response.id) this.activeResponseId = null;

    if (stale || response.status !== 'completed') {
      // Close out every call so the conversation never holds a dangling function_call,
      // but do NOT request a new response — the user (or the error) owns the next turn.
      const why = stale ? 'cancelled: the user interrupted' : `response ${response.status}`;
      for (const call of calls) this.completeCall(call.call_id, { ok: false, error: why }, false);
      this.markResponseEntries(response.id, 'interrupted');
      if (response.status === 'failed') {
        const message = response.status_details?.error?.message ?? 'The response failed.';
        this.logEvent(`Response failed: ${message}`);
        if (!this.playingResponseId) this.setStatus('listening');
      }
      return;
    }

    if (calls.length === 0) {
      if (!this.playingResponseId && this.snapshot.status !== 'interrupted') this.setStatus('listening');
      return;
    }
    for (const call of calls) this.dispatchToolCall(call);
  }

  private markResponseEntries(responseId: string, state: TranscriptEntry['state']) {
    if (!this.snapshot.transcript.some((e) => e.responseId === responseId && e.state === 'streaming')) return;
    this.update({
      transcript: this.snapshot.transcript.map((e) => (e.responseId === responseId && e.state === 'streaming' ? { ...e, state } : e)),
    });
  }

  // ── tool execution ───────────────────────────────────────────────────────
  private dispatchToolCall(call: FunctionCallItem) {
    if (!call.call_id || this.handledCallIds.has(call.call_id)) return;

    if (call.name !== NAVIGATE_TOOL_NAME) {
      this.completeCall(call.call_id, { ok: false, error: `Unknown tool "${call.name}". Only ${NAVIGATE_TOOL_NAME} is available.` }, true);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(call.arguments || '{}');
    } catch {
      this.completeCall(call.call_id, { ok: false, error: 'Arguments were not valid JSON.' }, true);
      return;
    }
    const parsed = navigateToSlideArgsSchema.safeParse(json);
    if (!parsed.success) {
      this.completeCall(call.call_id, { ok: false, error: `Invalid arguments: ${formatZodError(parsed.error)}`, current_slide: this.deck.getCurrentSlide() }, true);
      return;
    }

    const args = parsed.data;
    this.handledCallIds.add(call.call_id); // reserve now — prevents a duplicate while deferred

    if (args.transition === 'next_sentence' && this.playingResponseId) {
      this.clearPendingNavigation('superseded by a newer navigation');
      const epoch = this.navEpoch;
      const timer = this.scheduler.setTimeout(() => this.flushPendingNavigation(), NEXT_SENTENCE_MAX_WAIT_MS);
      this.pendingNav = { callId: call.call_id, args, epoch, timer };
      return;
    }
    this.executeNavigation(call.call_id, args);
  }

  private flushPendingNavigation() {
    const pending = this.pendingNav;
    if (!pending) return;
    this.scheduler.clearTimeout(pending.timer);
    this.pendingNav = null;
    if (pending.epoch !== this.navEpoch) {
      this.completeCall(pending.callId, { ok: false, error: 'superseded before the slide changed' }, false);
      return;
    }
    this.executeNavigation(pending.callId, pending.args);
  }

  private clearPendingNavigation(reason?: string) {
    const pending = this.pendingNav;
    if (!pending) return;
    this.scheduler.clearTimeout(pending.timer);
    this.pendingNav = null;
    if (reason) this.completeCall(pending.callId, { ok: false, error: reason }, false);
  }

  private executeNavigation(callId: string, args: NavigateToSlideArgs) {
    const slide = getSlide(args.slide_number)!;
    const previous = this.deck.getCurrentSlide();
    if (previous !== slide.number) this.deck.goTo(slide.number, 'agent');

    this.update({ lastNavigation: { callId, slide: slide.number, reason: args.reason, at: this.scheduler.now() } });
    if (previous !== slide.number) this.logEvent(`Moved to slide ${slide.number} · ${args.reason}`);

    this.completeCall(
      callId,
      {
        ok: true,
        slide_number: slide.number,
        already_on_slide: previous === slide.number,
        title: slide.title,
        summary: slide.summary,
        key_concepts: slide.keyConcepts.map((c) => `${c.term}: ${c.detail}`),
        example: `${slide.example.label} — ${slide.example.text}`,
        speaker_notes: slide.speakerNotes,
        next_step: 'The slide is on screen now. Answer the user using this content.',
      },
      true,
    );
  }

  /**
   * Sends the `function_call_output` exactly once per call id, then (optionally)
   * asks the model to continue speaking with the result in context.
   */
  private completeCall(callId: string, output: Record<string, unknown>, continueResponse: boolean) {
    if (this.answeredCallIds.has(callId)) return;
    this.handledCallIds.add(callId);
    this.answeredCallIds.add(callId);
    this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) } });
    if (continueResponse) this.send({ type: 'response.create' });
  }
}
