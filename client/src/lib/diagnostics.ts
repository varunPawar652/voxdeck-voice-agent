/**
 * Local, in-memory event log for one browser tab (or one eval run).
 *
 * Privacy rules: never record API keys, ephemeral secrets, audio, or user transcripts.
 * Events carry ids, timings, statuses and short machine-readable details only.
 */

export type DiagKind =
  | 'session.connecting'
  | 'session.connected'
  | 'session.failed'
  | 'session.lost'
  | 'session.closed'
  | 'session.realtime_id'
  | 'turn.speech_started'
  | 'turn.speech_stopped'
  | 'turn.text'
  | 'response.created'
  | 'response.first_audio'
  | 'response.done'
  | 'response.retry'
  | 'interrupt.auto'
  | 'interrupt.manual'
  | 'tool.call'
  | 'tool.result'
  | 'tool.failed'
  | 'nav.executed'
  | 'nav.noop'
  | 'nav.deferred'
  | 'nav.dropped'
  | 'nav.manual'
  | 'grounding.flag'
  | 'error.server';

export interface DiagEvent {
  seq: number;
  /** Wall-clock ms since epoch. */
  t: number;
  /** ms since the current session started connecting. */
  rel: number;
  clientSessionId: string | null;
  realtimeSessionId: string | null;
  kind: DiagKind;
  data?: Record<string, unknown>;
}

export interface DiagMetrics {
  sessions: number;
  reconnects: number;
  connectMs: number | null;
  /**
   * End of user turn → first assistant audio. In the browser: server VAD `speech_stopped`
   * (or a typed question) → `output_audio_buffer.started`, both as received by the client.
   * An approximation of perceived latency: it excludes VAD's own silence window and the
   * client's jitter buffer, so it is not a pure model-latency measurement.
   */
  turnLatencyMs: number[];
  toolCalls: number;
  toolFailures: number;
  navigations: number;
  interruptions: { auto: number; manual: number };
  cancelledResponses: number;
  serverErrors: number;
  groundingFlags: number;
}

const emptyMetrics = (): DiagMetrics => ({
  sessions: 0,
  reconnects: 0,
  connectMs: null,
  turnLatencyMs: [],
  toolCalls: 0,
  toolFailures: 0,
  navigations: 0,
  interruptions: { auto: 0, manual: 0 },
  cancelledResponses: 0,
  serverErrors: 0,
  groundingFlags: 0,
});

export class DiagnosticsRecorder {
  private events: DiagEvent[] = [];
  private metrics: DiagMetrics = emptyMetrics();
  private listeners = new Set<() => void>();
  private seq = 0;
  private sessionStartedAt: number;
  private clientSessionId: string | null = null;
  private realtimeSessionId: string | null = null;
  private version = 0;

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly capacity = 400,
  ) {
    this.sessionStartedAt = clock();
  }

  /** Begins a new connection attempt; ids correlate client events with server logs. */
  startSession(clientSessionId: string) {
    this.sessionStartedAt = this.clock();
    this.clientSessionId = clientSessionId;
    this.realtimeSessionId = null;
    this.metrics.sessions++;
    this.metrics.reconnects = Math.max(0, this.metrics.sessions - 1);
    this.record('session.connecting');
  }

  setRealtimeSessionId(id: string) {
    if (this.realtimeSessionId === id) return;
    this.realtimeSessionId = id;
    this.record('session.realtime_id', { id });
  }

  record(kind: DiagKind, data?: Record<string, unknown>) {
    const t = this.clock();
    const event: DiagEvent = {
      seq: ++this.seq,
      t,
      rel: t - this.sessionStartedAt,
      clientSessionId: this.clientSessionId,
      realtimeSessionId: this.realtimeSessionId,
      kind,
      ...(data ? { data } : {}),
    };
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    this.updateMetrics(event);
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private updateMetrics(e: DiagEvent) {
    const m = this.metrics;
    switch (e.kind) {
      case 'session.connected':
        m.connectMs = typeof e.data?.ms === 'number' ? e.data.ms : e.rel;
        break;
      case 'response.first_audio':
        if (typeof e.data?.latencyMs === 'number') m.turnLatencyMs = [...m.turnLatencyMs, e.data.latencyMs].slice(-50);
        break;
      case 'tool.call':
        m.toolCalls++;
        break;
      case 'tool.result':
        // Calls closed out because the user interrupted are cancellations, not tool failures.
        if (e.data?.ok === false && !e.data.cancelled) m.toolFailures++;
        break;
      case 'nav.executed':
        m.navigations++;
        break;
      case 'interrupt.auto':
        m.interruptions = { ...m.interruptions, auto: m.interruptions.auto + 1 };
        break;
      case 'interrupt.manual':
        m.interruptions = { ...m.interruptions, manual: m.interruptions.manual + 1 };
        break;
      case 'response.done':
        if (e.data?.status === 'cancelled') m.cancelledResponses++;
        break;
      case 'error.server':
        m.serverErrors++;
        break;
      case 'grounding.flag':
        m.groundingFlags++;
        break;
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes whenever anything is recorded — cheap snapshot key for React. */
  getVersion = () => this.version;
  getEvents = (): readonly DiagEvent[] => this.events;
  getMetrics = (): DiagMetrics => this.metrics;

  toJSON() {
    return { exportedAt: new Date(this.clock()).toISOString(), metrics: this.metrics, events: this.events };
  }
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
