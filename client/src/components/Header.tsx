import { AudioLines } from 'lucide-react';
import { PRESENTATION_TITLE } from '@voxdeck/shared';
import type { PresenterStatus } from '../lib/presenterController.ts';
import { statusMeta } from './status.ts';

export function Header({ status }: { status: PresenterStatus }) {
  const connection =
    status === 'idle' ? { label: 'Not connected', dot: 'bg-ink-400' }
    : status === 'connecting' ? { label: 'Connecting…', dot: 'bg-violet animate-pulse' }
    : status === 'error' ? { label: 'Connection error', dot: 'bg-danger' }
    : { label: 'Live · Realtime', dot: 'bg-emerald-400' };

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-white/6 bg-ink-950/80 px-5 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent/25 to-violet/20 ring-1 ring-accent/30">
          <AudioLines className="size-4.5 text-accent" aria-hidden />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">
          Vox<span className="text-accent">Deck</span>
        </span>
      </div>
      <div className="h-5 w-px bg-white/10" aria-hidden />
      <h1 className="truncate text-sm text-ink-300">{PRESENTATION_TITLE}</h1>
      <div className="ml-auto flex items-center gap-2 rounded-full border border-white/8 bg-ink-850 px-3 py-1 text-xs" role="status" aria-live="polite">
        <span className={`size-2 rounded-full ${connection.dot}`} aria-hidden />
        <span className="text-ink-200">{connection.label}</span>
        <span className="sr-only">Presenter is {statusMeta[status].label}</span>
      </div>
    </header>
  );
}
