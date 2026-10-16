import { ChevronLeft, ChevronRight, Hand, Loader2, Mic, MicOff, PhoneOff, Play } from 'lucide-react';
import { SLIDE_COUNT } from '@voxdeck/shared';
import type { PresenterStatus } from '../lib/presenterController.ts';

interface Props {
  status: PresenterStatus;
  connected: boolean;
  currentSlide: number;
  micEnabled: boolean;
  onPrev(): void;
  onNext(): void;
  onSelectSlide(n: number): void;
  onConnect(): void;
  onDisconnect(): void;
  onToggleMic(): void;
  onInterrupt(): void;
}

const iconBtn =
  'flex size-10 items-center justify-center rounded-full border border-white/8 bg-ink-850 text-ink-200 transition hover:bg-ink-800 hover:text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40';

export function ControlBar(p: Props) {
  const canInterrupt = p.status === 'speaking' || p.status === 'thinking';
  return (
    <footer className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-white/6 bg-ink-950/80 px-5">
      <div className="flex items-center gap-3">
        <button type="button" className={iconBtn} onClick={p.onPrev} disabled={p.currentSlide <= 1} aria-label="Previous slide" title="Previous (←)">
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex items-center gap-1.5" role="group" aria-label="Slides">
          {Array.from({ length: SLIDE_COUNT }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => p.onSelectSlide(n)}
              aria-label={`Go to slide ${n}`}
              aria-current={n === p.currentSlide ? 'true' : undefined}
              className={`h-1.5 rounded-full transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${n === p.currentSlide ? 'w-6 bg-accent' : 'w-1.5 bg-ink-600 hover:bg-ink-400'}`}
            />
          ))}
        </div>
        <button type="button" className={iconBtn} onClick={p.onNext} disabled={p.currentSlide >= SLIDE_COUNT} aria-label="Next slide" title="Next (→)">
          <ChevronRight className="size-5" />
        </button>
        <span className="font-mono text-xs text-ink-400" aria-live="polite">
          {String(p.currentSlide).padStart(2, '0')} / {String(SLIDE_COUNT).padStart(2, '0')}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {p.connected ? (
          <>
            <button
              type="button"
              onClick={p.onToggleMic}
              className={`${iconBtn} ${p.micEnabled ? '' : 'border-danger/40 bg-danger/15 text-danger hover:text-danger'}`}
              aria-pressed={!p.micEnabled}
              aria-label={p.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
              title="Mute / unmute (M)"
            >
              {p.micEnabled ? <Mic className="size-4.5" /> : <MicOff className="size-4.5" />}
            </button>
            <button
              type="button"
              onClick={p.onInterrupt}
              disabled={!canInterrupt}
              className="flex h-10 items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-4 text-sm font-medium text-warn transition hover:bg-warn/20 focus-visible:ring-2 focus-visible:ring-warn focus-visible:outline-none disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-ink-850 disabled:text-ink-400"
              title="Stop the presenter (Esc)"
            >
              <Hand className="size-4" /> Interrupt
            </button>
            <button
              type="button"
              onClick={p.onDisconnect}
              className="flex h-10 items-center gap-2 rounded-full bg-danger/15 px-4 text-sm font-medium text-danger transition hover:bg-danger/25 focus-visible:ring-2 focus-visible:ring-danger focus-visible:outline-none"
            >
              <PhoneOff className="size-4" /> End
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={p.onConnect}
            disabled={p.status === 'connecting'}
            className="flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-ink-950 shadow-[0_0_30px_-6px] shadow-accent/60 transition hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-70"
          >
            {p.status === 'connecting' ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
            {p.status === 'connecting' ? 'Connecting…' : p.status === 'error' ? 'Reconnect presenter' : 'Start presenter'}
          </button>
        )}
      </div>

      <div className="hidden justify-end gap-3 text-[11px] text-ink-400 lg:flex">
        <span><Kbd>←</Kbd> <Kbd>→</Kbd> slides</span>
        <span><Kbd>M</Kbd> mute</span>
        <span><Kbd>Esc</Kbd> interrupt</span>
      </div>
    </footer>
  );
}

function Kbd({ children }: { children: string }) {
  return <kbd className="rounded border border-white/10 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">{children}</kbd>;
}
