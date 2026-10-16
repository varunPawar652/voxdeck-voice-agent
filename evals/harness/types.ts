import type { DiagEvent } from '../../client/src/lib/diagnostics.ts';
import type { PresenterStatus, TranscriptEntry } from '../../client/src/lib/presenterController.ts';

export interface TurnRecord {
  index: number;
  /** What the synthetic caller said (ground truth for ASR scoring). */
  text: string;
  startedAt: number;
  /** Wall time the last speech frame was streamed (the caller "stopped talking"). */
  audioEndAt: number | null;
  /** Server VAD end-of-turn, as received. */
  speechStoppedAt: number | null;
  /** First assistant audio delta received after this turn ended. */
  firstAudioAt: number | null;
  /** What the server's transcription model heard. */
  asrTranscript: string | null;
}

/** Compact server-event log: types, ids and statuses only — never audio payloads. */
export interface EventLogEntry {
  t: number;
  type: string;
  responseId?: string;
  itemId?: string;
  status?: string;
  reason?: string | null;
  calls?: { name: string; callId: string; args: string }[];
  code?: string;
}

export interface NavigationLog {
  at: number;
  from: number;
  to: number;
  turn: number;
}

export interface InterruptionLog {
  at: number;
  turn: number;
  responseId: string;
  itemId: string | null;
  /** How much of the assistant item had been "heard" — sent as audio_end_ms. */
  playedMs: number;
  /** speech_started → response.done(cancelled), when the response was still generating. */
  cancelLatencyMs: number | null;
  /** Audio deltas that arrived for the interrupted response afterwards (discarded, never played). */
  staleDeltasDiscarded: number;
  /** ms after the interruption that the last stale audio chunk arrived (null = none arrived). */
  lastStaleDeltaAfterMs: number | null;
}

export interface RunRecord {
  scenarioId: string;
  startedAt: number;
  endedAt: number;
  turns: TurnRecord[];
  events: EventLogEntry[];
  diag: DiagEvent[];
  navigations: NavigationLog[];
  interruptions: InterruptionLog[];
  finalSlide: number;
  transcript: TranscriptEntry[];
  statusHistory: { t: number; status: PresenterStatus; error: string | null }[];
  realtimeSessionIds: string[];
  notes: string[];
}

export interface Check {
  name: string;
  /** null = skipped (e.g. judge disabled). */
  pass: boolean | null;
  kind: 'deterministic' | 'judge';
  detail?: string;
}

export interface TurnTiming {
  turn: number;
  /** Server VAD end-of-turn → first audio delta received. Approximate (network + no jitter buffer). */
  vadToFirstAudioMs: number | null;
  /** Caller's last audio frame → first audio delta. Includes VAD's end-of-speech wait; closest to perceived gap. */
  speechEndToFirstAudioMs: number | null;
  asrWordErrorRate: number | null;
}

export interface ScenarioResult {
  id: string;
  title: string;
  attempt: number;
  tracking: boolean;
  pass: boolean;
  failureReason: string | null;
  checks: Check[];
  timings: TurnTiming[];
  interruptions: InterruptionLog[];
  durationMs: number;
  error: string | null;
  run: RunRecord | null;
}
