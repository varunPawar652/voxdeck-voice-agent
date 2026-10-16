import { useEffect, useState } from 'react';
import { ControlBar } from './components/ControlBar.tsx';
import { DiagnosticsPanel } from './components/DiagnosticsPanel.tsx';
import { Header } from './components/Header.tsx';
import { SidePanel } from './components/SidePanel.tsx';
import { SlideStage } from './components/SlideStage.tsx';
import { useVoicePresenter } from './hooks/useVoicePresenter.ts';

export function App() {
  const p = useVoicePresenter();
  const { goToSlide, currentSlide, toggleMic, interrupt, connected } = p;
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goToSlide(currentSlide + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToSlide(currentSlide - 1);
      else if (e.key === 'Escape') interrupt();
      else if (e.key.toLowerCase() === 'm' && connected) toggleMic();
      else if (e.key.toLowerCase() === 'd') setDiagnosticsOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToSlide, currentSlide, toggleMic, interrupt, connected]);

  return (
    <div className="relative flex h-full min-h-[640px] min-w-[1024px] flex-col">
      <Header status={p.status} diagnosticsOpen={diagnosticsOpen} onToggleDiagnostics={() => setDiagnosticsOpen((open) => !open)} />
      {diagnosticsOpen && <DiagnosticsPanel diagnostics={p.diagnostics} onClose={() => setDiagnosticsOpen(false)} />}
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        <SlideStage slideNumber={currentSlide} lastNavigation={p.lastNavigation} navigatedByAgent={p.lastSource === 'agent'} />
        <SidePanel
          status={p.status}
          error={p.error}
          transcript={p.transcript}
          currentSlide={currentSlide}
          micStream={p.micStream}
          remoteStream={p.remoteStream}
          micEnabled={p.micEnabled}
          onAsk={p.ask}
          onSelectSlide={goToSlide}
        />
      </main>
      <ControlBar
        status={p.status}
        connected={connected}
        currentSlide={currentSlide}
        micEnabled={p.micEnabled}
        onPrev={() => goToSlide(currentSlide - 1)}
        onNext={() => goToSlide(currentSlide + 1)}
        onSelectSlide={goToSlide}
        onConnect={() => void p.connect()}
        onDisconnect={p.disconnect}
        onToggleMic={toggleMic}
        onInterrupt={interrupt}
      />
    </div>
  );
}
