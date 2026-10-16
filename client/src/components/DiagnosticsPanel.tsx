import { useState, useSyncExternalStore } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { median, type DiagEvent, type DiagnosticsRecorder } from '../lib/diagnostics.ts';

interface Props {
  diagnostics: DiagnosticsRecorder;
  onClose(): void;
}

const tone: Partial<Record<DiagEvent['kind'], string>> = {
  'session.failed': 'text-danger',
  'session.lost': 'text-danger',
  'error.server': 'text-danger',
  'tool.failed': 'text-danger',
  'interrupt.auto': 'text-warn',
  'interrupt.manual': 'text-warn',
  'nav.dropped': 'text-warn',
  'grounding.flag': 'text-warn',
  'nav.executed': 'text-accent',
  'response.first_audio': 'text-accent',
  'session.connected': 'text-emerald-300',
};

export function DiagnosticsPanel({ diagnostics, onClose }: Props) {
  useSyncExternalStore(diagnostics.subscribe, diagnostics.getVersion);
  const m = diagnostics.getMetrics();
  const events = diagnostics.getEvents();
  const last = events.at(-1);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics.toJSON(), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const lastLatency = m.turnLatencyMs.at(-1);
  const stats: [string, string, string?][] = [
    ['Connect', m.connectMs === null ? '—' : `${m.connectMs} ms`, 'Session request + mic + WebRTC handshake'],
    ['Turn → audio (median)', fmt(median(m.turnLatencyMs)), 'Approximate: VAD end-of-turn (or typed question) → first audio event received. Excludes VAD silence window and playback buffering.'],
    ['Turn → audio (last)', fmt(lastLatency ?? null)],
    ['Tool calls / failed', `${m.toolCalls} / ${m.toolFailures}`],
    ['Slide changes', String(m.navigations)],
    ['Interruptions', `${m.interruptions.auto} voice · ${m.interruptions.manual} button`],
    ['Cancelled responses', String(m.cancelledResponses)],
    ['Grounding flags', String(m.groundingFlags), 'Heuristic audit: numbers or citation phrasing not found in the deck'],
    ['Server errors', String(m.serverErrors)],
    ['Sessions / reconnects', `${m.sessions} / ${m.reconnects}`],
  ];

  return (
    <aside
      className="animate-fade-up absolute top-14 right-3 bottom-[4.25rem] z-20 flex w-[420px] flex-col rounded-2xl border border-white/10 bg-ink-950/97 shadow-2xl backdrop-blur"
      aria-label="Developer diagnostics"
    >
      <header className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5">
        <h2 className="text-sm font-semibold">Diagnostics</h2>
        <span className="text-[11px] text-ink-400">local only · no audio, transcripts or keys</span>
        <button type="button" onClick={copy} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-300 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy JSON'}
        </button>
        <button type="button" onClick={onClose} aria-label="Close diagnostics" className="rounded-md p-1 text-ink-300 hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none">
          <X className="size-4" />
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-px border-b border-white/8 bg-white/5 text-xs">
        {stats.map(([label, value, hint]) => (
          <div key={label} className="bg-ink-950 px-3 py-2" title={hint}>
            <dt className="text-[10px] tracking-wide text-ink-400 uppercase">
              {label}
              {hint && <span className="ml-0.5 text-ink-600">ⓘ</span>}
            </dt>
            <dd className="font-mono text-ink-100">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-b border-white/8 px-3 py-1.5 font-mono text-[10px] text-ink-400">
        client {short(last?.clientSessionId)} · realtime {short(last?.realtimeSessionId)}
      </p>

      <ol className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px]">
        {events.length === 0 && <li className="text-ink-400">No events yet — start the presenter.</li>}
        {[...events].reverse().map((e) => (
          <li key={e.seq} className="flex gap-2 border-b border-white/4 py-1">
            <span className="w-14 shrink-0 text-right text-ink-500">{(e.rel / 1000).toFixed(2)}s</span>
            <span className={`shrink-0 ${tone[e.kind] ?? 'text-ink-200'}`}>{e.kind}</span>
            {e.data && <span className="truncate text-ink-400" title={JSON.stringify(e.data)}>{compact(e.data)}</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function fmt(ms: number | null): string {
  return ms === null ? '—' : `≈${ms} ms`;
}

function short(id: string | null | undefined): string {
  return id ? `…${id.slice(-8)}` : '—';
}

function compact(data: Record<string, unknown>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' ');
}
