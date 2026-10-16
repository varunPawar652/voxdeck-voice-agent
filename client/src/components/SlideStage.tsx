import { useEffect, useState } from 'react';
import { Lightbulb, Navigation } from 'lucide-react';
import { SLIDE_COUNT, getSlide } from '@voxdeck/shared';
import type { NavigationRecord } from '../lib/presenterController.ts';
import { Diagram } from './diagrams/Diagrams.tsx';

interface Props {
  slideNumber: number;
  lastNavigation: NavigationRecord | null;
  navigatedByAgent: boolean;
}

export function SlideStage({ slideNumber, lastNavigation, navigatedByAgent }: Props) {
  const slide = getSlide(slideNumber)!;

  // Briefly show *why* the presenter moved here — makes tool calls visible to the audience.
  const [dismissedCallId, setDismissedCallId] = useState<string | null>(null);
  const toast =
    lastNavigation && navigatedByAgent && lastNavigation.slide === slideNumber && lastNavigation.callId !== dismissedCallId ? lastNavigation : null;
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setDismissedCallId(toast.callId), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <section className="stage-bg relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/6" aria-label={`Slide ${slide.number} of ${SLIDE_COUNT}`}>
      <div className="grid-texture pointer-events-none absolute inset-0" aria-hidden />

      {toast && (
        <div className="animate-fade-up absolute top-4 right-4 z-10 flex max-w-sm items-start gap-2 rounded-xl border border-accent/30 bg-ink-900/95 px-3 py-2 text-xs shadow-xl backdrop-blur" role="status">
          <Navigation className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span>
            <span className="font-semibold text-accent">Presenter moved to slide {toast.slide}</span>
            <span className="block text-ink-300">{toast.reason}</span>
          </span>
        </div>
      )}

      <article key={slide.id} className="animate-slide-in relative flex min-h-0 flex-1 flex-col gap-5 p-8 xl:p-10">
        <header>
          <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-accent uppercase">
            <span>{String(slide.number).padStart(2, '0')}</span>
            <span className="h-px w-6 bg-accent/50" aria-hidden />
            <span>{slide.eyebrow}</span>
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight xl:text-4xl">{slide.title}</h2>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-ink-300 xl:text-lg">{slide.summary}</p>
        </header>

        <div className="min-h-56 flex-1">
          <Diagram config={slide.diagram} />
        </div>

        <footer className="grid shrink-0 gap-3 lg:grid-cols-[1fr_1.1fr]">
          <div className="grid grid-cols-3 gap-2">
            {slide.keyConcepts.map((c) => (
              <div key={c.term} className="rounded-xl border border-white/6 bg-ink-950/40 p-3">
                <p className="text-sm font-semibold text-ink-100">{c.term}</p>
                <p className="mt-0.5 text-xs leading-snug text-ink-400">{c.detail}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-3 rounded-xl border border-violet/20 bg-violet/6 p-3">
            <Lightbulb className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink-100">{slide.example.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-300">{slide.example.text}</p>
            </div>
          </div>
        </footer>
      </article>
    </section>
  );
}
