import { ArrowDown, ArrowRight, Bot, Brain, Database, Eye, Layers, Network, Search, ShieldCheck, Sparkles, Wrench, Zap } from 'lucide-react';
import type { DiagramConfig } from '@voxdeck/shared';

type Of<K extends DiagramConfig['kind']> = Extract<DiagramConfig, { kind: K }>;

export function Diagram({ config }: { config: DiagramConfig }) {
  switch (config.kind) {
    case 'evolution':
      return <EvolutionDiagram config={config} />;
    case 'agent-loop':
      return <AgentLoopDiagram config={config} />;
    case 'tool-sequence':
      return <ToolSequenceDiagram config={config} />;
    case 'memory-tiers':
      return <MemoryDiagram config={config} />;
    case 'orchestration':
      return <OrchestrationDiagram config={config} />;
    case 'production':
      return <ProductionDiagram config={config} />;
  }
}

const card = 'rounded-xl border border-white/8 bg-ink-850/80';

function EvolutionDiagram({ config }: { config: Of<'evolution'> }) {
  return (
    <div className="flex h-full items-center gap-2">
      {config.stages.map((stage, i) => {
        const last = i === config.stages.length - 1;
        return (
          <div key={stage.label} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-44 flex-1 flex-col justify-between rounded-xl border p-4 ${
                last ? 'border-accent/50 bg-accent/8 shadow-[0_0_40px_-12px] shadow-accent/40' : 'border-white/8 bg-ink-850/80'
              }`}
            >
              <span className={`font-mono text-xs ${last ? 'text-accent' : 'text-ink-400'}`}>{stage.era}</span>
              <div>
                <div className="mb-3 h-1 rounded-full bg-ink-700">
                  <div className={`h-1 rounded-full ${last ? 'bg-accent' : 'bg-ink-400'}`} style={{ width: `${(i + 1) * 25}%` }} />
                </div>
                <p className="font-semibold text-ink-100">{stage.label}</p>
                <p className="mt-1 text-sm leading-snug text-ink-300">{stage.capability}</p>
              </div>
            </div>
            {!last && <ArrowRight className="size-4 shrink-0 text-ink-600" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}

const loopIcons = [Eye, Brain, Zap];

function AgentLoopDiagram({ config }: { config: Of<'agent-loop'> }) {
  // Three steps evenly spaced on a circle around the LLM core.
  const positions = [
    { x: 50, y: 8 },
    { x: 88, y: 72 },
    { x: 12, y: 72 },
  ];
  return (
    <div className="flex h-full gap-6">
      <div className="relative aspect-square h-full max-h-80 min-h-56">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#5eead4" />
            </marker>
          </defs>
          <circle cx="50" cy="52" r="34" fill="none" stroke="#1f2a4a" strokeWidth="0.6" />
          <path d="M 62 21 A 34 34 0 0 1 83 55" fill="none" stroke="#5eead4" strokeWidth="0.8" markerEnd="url(#arrow)" opacity="0.8" />
          <path d="M 72 80 A 34 34 0 0 1 28 80" fill="none" stroke="#5eead4" strokeWidth="0.8" markerEnd="url(#arrow)" opacity="0.8" />
          <path d="M 17 55 A 34 34 0 0 1 38 21" fill="none" stroke="#5eead4" strokeWidth="0.8" markerEnd="url(#arrow)" opacity="0.8" />
        </svg>
        <div className="absolute top-[52%] left-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-accent/40 bg-accent/10 shadow-[0_0_50px_-10px] shadow-accent/50">
          <Sparkles className="size-5 text-accent" aria-hidden />
          <span className="mt-1 text-sm font-semibold">{config.core}</span>
        </div>
        {config.steps.map((step, i) => {
          const Icon = loopIcons[i] ?? Zap;
          const p = positions[i]!;
          return (
            <div
              key={step.label}
              className={`absolute w-32 -translate-x-1/2 -translate-y-1/2 ${card} px-3 py-2 text-center`}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <div className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                <Icon className="size-3.5 text-accent" aria-hidden /> {step.label}
              </div>
              <p className="text-[11px] leading-tight text-ink-300">{step.detail}</p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2">
        <p className="mb-1 text-xs font-medium tracking-wider text-ink-400 uppercase">Wrapped by ordinary code</p>
        {config.modules.map((m) => (
          <div key={m} className={`${card} flex items-center gap-2 px-3 py-2 text-sm`}>
            <span className="size-1.5 rounded-full bg-violet" /> {m}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolSequenceDiagram({ config }: { config: Of<'tool-sequence'> }) {
  const n = config.lanes.length;
  return (
    <div className="relative flex h-full flex-col">
      <div className="grid shrink-0" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {config.lanes.map((lane, i) => (
          <div key={lane} className="flex justify-center">
            <span className={`rounded-lg border px-3 py-1 text-xs font-semibold ${i === 2 ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/10 bg-ink-800 text-ink-200'}`}>
              {lane}
            </span>
          </div>
        ))}
      </div>
      <div className="relative flex flex-1 flex-col justify-around py-2">
        {/* lifelines */}
        <div className="pointer-events-none absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }} aria-hidden>
          {config.lanes.map((lane) => (
            <div key={lane} className="flex justify-center">
              <div className="w-px border-l border-dashed border-ink-700" />
            </div>
          ))}
        </div>
        {config.messages.map((m, i) => {
          const lo = Math.min(m.from, m.to);
          const hi = Math.max(m.from, m.to);
          const rightward = m.to > m.from;
          return (
            <div key={i} className="relative h-9">
              <div className="absolute top-1/2 flex flex-col items-center" style={{ left: `${((lo + 0.5) / n) * 100}%`, width: `${((hi - lo) / n) * 100}%` }}>
                <span className="absolute -top-4 px-1 text-[11px] whitespace-nowrap text-ink-200">
                  {m.code ? <code className="font-mono text-accent">{m.code}</code> : m.label}
                </span>
                <div className={`relative h-px w-full ${m.code ? 'bg-accent/70' : 'bg-ink-400'}`}>
                  <span
                    className={`absolute top-1/2 size-0 -translate-y-1/2 border-y-4 border-y-transparent ${
                      rightward ? `right-0 border-l-6 ${m.code ? 'border-l-accent' : 'border-l-ink-400'}` : `left-0 border-r-6 ${m.code ? 'border-r-accent' : 'border-r-ink-400'}`
                    }`}
                  />
                </div>
                {m.code && <span className="absolute top-1.5 text-[10px] text-ink-400">{m.label}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MemoryDiagram({ config }: { config: Of<'memory-tiers'> }) {
  const icons = [Layers, Bot, Database];
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-1 flex-col justify-center gap-2">
        {config.tiers.map((tier, i) => {
          const Icon = icons[i] ?? Layers;
          return (
            <div key={tier.label} className="mx-auto flex w-full items-center gap-3" style={{ maxWidth: `${70 + i * 15}%` }}>
              <div className={`${card} flex flex-1 items-center gap-3 px-4 py-2.5 ${i === 0 ? 'border-accent/40 bg-accent/8' : ''}`}>
                <Icon className={`size-4 shrink-0 ${i === 0 ? 'text-accent' : 'text-violet'}`} aria-hidden />
                <span className="font-semibold">{tier.label}</span>
                <span className="font-mono text-[11px] text-ink-400">{tier.scope}</span>
                <span className="ml-auto hidden text-sm text-ink-300 md:inline">{tier.example}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className={`${card} p-3`}>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wider text-ink-400 uppercase">
          <Search className="size-3" aria-hidden /> RAG pipeline
        </p>
        <div className="flex items-center gap-1.5">
          {config.pipeline.map((step, i) => (
            <div key={step} className="flex flex-1 items-center gap-1.5">
              <span className={`flex-1 rounded-md px-2 py-1.5 text-center text-sm ${i === config.pipeline.length - 1 ? 'bg-accent/15 text-accent' : 'bg-ink-800 text-ink-200'}`}>{step}</span>
              {i < config.pipeline.length - 1 && <ArrowRight className="size-3 shrink-0 text-ink-600" aria-hidden />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrchestrationDiagram({ config }: { config: Of<'orchestration'> }) {
  return (
    <div className="flex h-full gap-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <div className="flex items-center gap-2 rounded-xl border border-accent/50 bg-accent/10 px-5 py-2.5 font-semibold shadow-[0_0_40px_-12px] shadow-accent/50">
          <Network className="size-4 text-accent" aria-hidden /> {config.orchestrator}
        </div>
        <div className="relative h-6 w-2/3" aria-hidden>
          <div className="absolute top-0 left-1/2 h-3 w-px bg-ink-600" />
          <div className="absolute top-3 right-[16.6%] left-[16.6%] h-px bg-ink-600" />
          {[16.6, 50, 83.4].map((x) => (
            <div key={x} className="absolute top-3 h-3 w-px bg-ink-600" style={{ left: `${x}%` }} />
          ))}
        </div>
        <div className="grid w-full grid-cols-3 gap-3">
          {config.workers.map((w) => (
            <div key={w.label} className={`${card} px-3 py-2.5 text-center`}>
              <Bot className="mx-auto mb-1 size-4 text-violet" aria-hidden />
              <p className="text-sm font-semibold">{w.label}</p>
              <p className="text-[11px] text-ink-300">{w.task}</p>
            </div>
          ))}
        </div>
        <ArrowDown className="my-1 size-4 text-ink-600" aria-hidden />
        <div className={`${card} px-4 py-2 text-sm font-medium`}>{config.aggregator}</div>
      </div>
      <div className="flex w-40 flex-col justify-center gap-2">
        <p className="text-xs font-medium tracking-wider text-ink-400 uppercase">Patterns</p>
        {config.patterns.map((p) => (
          <span key={p} className={`rounded-lg px-3 py-1.5 text-sm ${p === 'Orchestrator–workers' ? 'bg-accent/15 text-accent' : 'bg-ink-800 text-ink-200'}`}>
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProductionDiagram({ config }: { config: Of<'production'> }) {
  const icons = [ShieldCheck, Wrench, Eye];
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid flex-1 grid-cols-3 gap-3">
        {config.pillars.map((pillar, i) => {
          const Icon = icons[i] ?? ShieldCheck;
          return (
            <div key={pillar.label} className={`${card} flex flex-col p-4`}>
              <div className="mb-3 flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-accent/12">
                  <Icon className="size-4 text-accent" aria-hidden />
                </span>
                <span className="font-semibold">{pillar.label}</span>
              </div>
              <ul className="space-y-1.5 text-sm text-ink-300">
                {pillar.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-ink-400" /> {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 rounded-xl border border-warn/30 bg-warn/8 px-4 py-3">
        <span className="font-mono text-2xl font-semibold text-warn">{config.stat.value}</span>
        <span className="text-sm text-ink-200">{config.stat.caption}</span>
      </div>
    </div>
  );
}
