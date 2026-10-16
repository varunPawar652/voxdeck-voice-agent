import { useEffect, useRef } from 'react';
import { AlertTriangle, MessageSquareText, Navigation, Sparkles } from 'lucide-react';
import { slides } from '@voxdeck/shared';
import { useAudioLevel } from '../hooks/useAudioLevel.ts';
import type { PresenterStatus, TranscriptEntry } from '../lib/presenterController.ts';
import { statusMeta } from './status.ts';

export const EXAMPLE_QUESTIONS = [
  'How does an AI agent use tools?',
  'Explain memory and RAG.',
  'What happens when multiple agents collaborate?',
  'What are the main production risks?',
];

interface Props {
  status: PresenterStatus;
  error: string | null;
  transcript: TranscriptEntry[];
  currentSlide: number;
  micStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micEnabled: boolean;
  onAsk(question: string): void;
  onSelectSlide(slide: number): void;
}

export function SidePanel(props: Props) {
  return (
    <aside className="flex min-h-0 w-[360px] shrink-0 flex-col gap-3 xl:w-[400px]" aria-label="Presenter panel">
      <PresenterCard {...props} />
      <Transcript entries={props.transcript} status={props.status} onAsk={props.onAsk} />
      <Outline current={props.currentSlide} onSelect={props.onSelectSlide} />
    </aside>
  );
}

function PresenterCard({ status, error, micStream, remoteStream, micEnabled }: Props) {
  const meta = statusMeta[status];
  const voice = useAudioLevel(remoteStream);
  const mic = useAudioLevel(micEnabled ? micStream : null);
  const active = status === 'speaking' ? voice : status === 'listening' || status === 'interrupted' ? mic : 0;

  return (
    <div className="rounded-2xl border border-white/6 bg-ink-900 p-4">
      <div className="flex items-center gap-4">
        <div className="relative flex size-14 shrink-0 items-center justify-center" aria-hidden>
          {(status === 'speaking' || status === 'listening') && (
            <span className={`animate-pulse-ring absolute inset-0 rounded-full ${status === 'speaking' ? 'bg-accent/30' : 'bg-emerald-400/20'}`} />
          )}
          <span
            className="absolute inset-0 rounded-full bg-gradient-to-br from-accent/30 to-violet/30 transition-transform duration-75"
            style={{ transform: `scale(${1 + active * 0.35})` }}
          />
          <span className="relative flex size-10 items-center justify-center rounded-full bg-ink-950 ring-1 ring-white/10">
            <VoiceBars level={active} status={status} />
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-ink-400">AI presenter · marin</p>
          <p className={`flex items-center gap-2 text-lg font-semibold ${meta.text}`} aria-live="polite">
            <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden />
            {meta.label}
          </p>
          <p className="text-xs text-ink-300">{!micEnabled && status !== 'idle' ? 'Microphone muted — unmute to speak.' : meta.hint}</p>
        </div>
      </div>
      {error && (
        <div className="mt-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs text-ink-100" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function VoiceBars({ level, status }: { level: number; status: PresenterStatus }) {
  const base = status === 'thinking' || status === 'connecting' ? 0.35 : 0.18;
  return (
    <span className="flex h-4 items-center gap-[3px]">
      {[0.6, 1, 0.75, 0.9].map((w, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-[height] duration-75 ${status === 'speaking' ? 'bg-accent' : status === 'error' ? 'bg-danger' : 'bg-ink-300'} ${
            status === 'thinking' || status === 'connecting' ? 'animate-pulse' : ''
          }`}
          style={{ height: `${Math.max(base, Math.min(1, level * w * 1.6)) * 100}%` }}
        />
      ))}
    </span>
  );
}

function Transcript({ entries, status, onAsk }: { entries: TranscriptEntry[]; status: PresenterStatus; onAsk(q: string): void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries]);

  const visible = entries.filter((e) => e.text || e.state === 'streaming');
  const busy = status === 'connecting';

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-white/6 bg-ink-900">
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2.5 text-xs font-medium tracking-wider text-ink-400 uppercase">
        <MessageSquareText className="size-3.5" aria-hidden /> Conversation
      </div>
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4" aria-live="polite" aria-relevant="additions">
        {visible.length === 0 ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-xl border border-accent/20 bg-accent/6 p-3 text-sm leading-relaxed text-ink-200">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              Ask a question about any topic. The presenter will navigate to the most relevant slide and explain it.
            </div>
            <p className="text-xs text-ink-400">Speak, or tap an example:</p>
          </div>
        ) : (
          visible.map((entry) => <TranscriptLine key={entry.id} entry={entry} />)
        )}
        {(visible.length === 0 || status === 'listening') && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                onClick={() => onAsk(q)}
                className="rounded-full border border-white/10 bg-ink-800 px-3 py-1 text-xs text-ink-200 transition hover:border-accent/40 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TranscriptLine({ entry }: { entry: TranscriptEntry }) {
  if (entry.role === 'event') {
    return (
      <p className="animate-fade-up flex items-center justify-center gap-1.5 text-center text-[11px] text-ink-400">
        <Navigation className="size-3 text-accent" aria-hidden /> {entry.text}
      </p>
    );
  }
  const user = entry.role === 'user';
  return (
    <div className={`animate-fade-up flex ${user ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          user ? 'rounded-br-md bg-accent/15 text-ink-100' : 'rounded-bl-md bg-ink-800 text-ink-200'
        } ${entry.state === 'interrupted' ? 'opacity-60' : ''}`}
      >
        {entry.text || <span className="text-ink-400 italic">{user ? 'Listening…' : '…'}</span>}
        {entry.state === 'interrupted' && <span className="ml-1.5 rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">interrupted</span>}
      </div>
    </div>
  );
}

function Outline({ current, onSelect }: { current: number; onSelect(n: number): void }) {
  return (
    <nav className="rounded-2xl border border-white/6 bg-ink-900 p-2" aria-label="Slide outline">
      <ol className="grid grid-cols-2 gap-1">
        {slides.map((s) => {
          const active = s.number === current;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.number)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  active ? 'bg-accent/12 text-accent' : 'text-ink-300 hover:bg-ink-800 hover:text-ink-100'
                }`}
              >
                <span className={`font-mono ${active ? 'text-accent' : 'text-ink-400'}`}>{s.number}</span>
                <span className="truncate">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
