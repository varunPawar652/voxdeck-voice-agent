/**
 * Live voice evaluation runner.
 *
 *   npm run eval:voice                       # all scenarios, clear caller, LLM judge on
 *   npm run eval:voice -- --only=A,D,G       # subset
 *   npm run eval:voice -- --repeat=3         # pass *rates* (model behaviour is stochastic)
 *   npm run eval:voice -- --persona=rushed   # different synthetic caller
 *   npm run eval:voice -- --eagerness=high   # compare semantic VAD eagerness
 *   npm run eval:voice -- --vad=server       # compare against a plain silence-timer VAD
 *   npm run eval:voice -- --no-judge         # deterministic checks only
 *
 * Writes evals/results/<timestamp>.{json,md}. Exits 1 if any scenario fails (CI-friendly).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { loadConfig, type TurnDetectionType, type VadEagerness } from '../server/src/config/env.ts';
import { median, percentile } from '../client/src/lib/diagnostics.ts';
import { Caller, PERSONAS, wordErrorRate } from './harness/caller.ts';
import { Judge } from './harness/judge.ts';
import { LiveVoiceSession } from './harness/liveSession.ts';
import type { ScenarioResult, TurnTiming } from './harness/types.ts';
import { scenarios, type Scenario } from './scenarios.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env'), quiet: true });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit?.includes('=') ? hit.split('=').slice(1).join('=') : hit ? 'true' : undefined;
}

const config = loadConfig();
if (!config.openaiApiKey) {
  console.error('OPENAI_API_KEY is not set in .env — the live voice eval needs real credentials.');
  process.exit(2);
}
const only = arg('only')?.split(',').map((s) => s.trim().toUpperCase());
const repeat = Math.max(1, Number(arg('repeat') ?? 1));
const persona = PERSONAS[arg('persona') ?? 'clear'];
if (!persona) {
  console.error(`Unknown persona. Options: ${Object.keys(PERSONAS).join(', ')}`);
  process.exit(2);
}
const eagerness = (arg('eagerness') ?? config.vadEagerness) as VadEagerness;
const turnDetection = (arg('vad') === 'server' ? 'server_vad' : arg('vad') === 'semantic' ? 'semantic_vad' : config.turnDetection) as TurnDetectionType;
const vadLabel = turnDetection === 'server_vad' ? `server_vad/${config.vadSilenceMs}ms silence` : `semantic_vad/${eagerness}`;
const judgeModel = process.env.EVAL_JUDGE_MODEL ?? 'gpt-4.1-mini';

const client = new OpenAI({ apiKey: config.openaiApiKey });
const caller = new Caller(client, persona, path.join(here, '.cache', 'tts'));
const judge = new Judge(arg('no-judge') ? null : client, judgeModel);
const selected = scenarios.filter((s) => !only || only.includes(s.id));

async function runScenario(scenario: Scenario, attempt: number): Promise<ScenarioResult> {
  const started = Date.now();
  const session = new LiveVoiceSession({
    scenarioId: scenario.id,
    apiKey: config.openaiApiKey!,
    model: config.realtimeModel,
    voice: config.realtimeVoice,
    transcriptionModel: config.transcriptionModel,
    vadEagerness: eagerness,
    turnDetection,
    vadSilenceMs: config.vadSilenceMs,
    startSlide: scenario.startSlide,
    failNavigation: scenario.failNavigation,
    log: (line) => console.log(line),
  });
  let error: string | null = null;
  try {
    await session.connect({ greet: scenario.greet });
    await withTimeout(
      scenario.script({
        session,
        say: async (text) => session.say(text, await caller.speak(text)),
        reconnect: () => session.connect(),
      }),
      120_000,
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await session.close();
  }

  const run = session.finalize();
  const checks = await scenario.checks(run, judge);
  if (error) checks.unshift({ name: 'scenario ran to completion', pass: false, kind: 'deterministic', detail: error });
  const failed = checks.filter((c) => c.pass === false);
  const timings: TurnTiming[] = run.turns.map((t) => ({
    turn: t.index + 1,
    vadToFirstAudioMs: t.speechStoppedAt && t.firstAudioAt && t.firstAudioAt > t.speechStoppedAt ? t.firstAudioAt - t.speechStoppedAt : null,
    speechEndToFirstAudioMs: t.audioEndAt && t.firstAudioAt && t.firstAudioAt > t.audioEndAt ? t.firstAudioAt - t.audioEndAt : null,
    asrWordErrorRate: t.asrTranscript === null ? null : wordErrorRate(t.text, t.asrTranscript),
  }));
  return {
    id: scenario.id,
    title: scenario.title,
    attempt,
    tracking: Boolean(scenario.tracking),
    pass: failed.length === 0,
    failureReason: failed.length ? failed.map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ''}`).join(' | ') : null,
    checks,
    timings,
    interruptions: run.interruptions,
    durationMs: Date.now() - started,
    error,
    run,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`scenario timed out after ${ms} ms`)), ms))]);
}

function fmt(ms: number | null | undefined) {
  return ms === null || ms === undefined ? '—' : `${ms} ms`;
}

async function main() {
  console.log(`VoxDeck voice eval · model ${config.realtimeModel} · voice ${config.realtimeVoice} · VAD ${vadLabel} · caller ${persona!.id} · judge ${judge.enabled ? judgeModel : 'off'}`);
  const results: ScenarioResult[] = [];
  for (const scenario of selected) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      console.log(`\n▶ [${scenario.id}] ${scenario.title}${scenario.tracking ? ' [tracking]' : ''}${repeat > 1 ? ` (run ${attempt}/${repeat})` : ''}`);
      const result = await runScenario(scenario, attempt);
      results.push(result);
      for (const c of result.checks) {
        const mark = c.pass === null ? '–' : c.pass ? '✓' : '✗';
        console.log(`  ${mark} ${c.kind === 'judge' ? '[judge] ' : ''}${c.name}${c.detail ? `  (${c.detail})` : ''}`);
      }
      console.log(`  ${result.pass ? 'PASS' : 'FAIL'} · ${(result.durationMs / 1000).toFixed(1)}s · ` + result.timings.map((t) => `turn ${t.turn}: vad→audio ${fmt(t.vadToFirstAudioMs)}, speech-end→audio ${fmt(t.speechEndToFirstAudioMs)}`).join(' · '));
    }
  }

  const allTimings = results.flatMap((r) => r.timings);
  const vad = allTimings.map((t) => t.vadToFirstAudioMs).filter((x): x is number => x !== null);
  const perceived = allTimings.map((t) => t.speechEndToFirstAudioMs).filter((x): x is number => x !== null);
  const wer = allTimings.map((t) => t.asrWordErrorRate).filter((x): x is number => x !== null);
  const cancels = results.flatMap((r) => r.interruptions).map((i) => i.cancelLatencyMs).filter((x): x is number => x !== null);
  const summary = {
    model: config.realtimeModel,
    voice: config.realtimeVoice,
    vad: vadLabel,
    persona: persona!.id,
    judgeModel: judge.enabled ? judgeModel : null,
    scenarios: results.length,
    passed: results.filter((r) => r.pass).length,
    latency: {
      note: 'Approximate wall-clock timings over the Realtime WebSocket from this machine; no playback jitter buffer. Not a model-latency benchmark.',
      vadToFirstAudio: { median: median(vad), p90: percentile(vad, 90), n: vad.length },
      speechEndToFirstAudio: { median: median(perceived), p90: percentile(perceived, 90), n: perceived.length },
      interruptionCancel: { median: median(cancels), n: cancels.length },
    },
    asr: { meanWordErrorRate: wer.length ? Math.round((wer.reduce((a, b) => a + b, 0) / wer.length) * 100) / 100 : null, n: wer.length },
  };

  const passRates = selected.map((s) => {
    const rs = results.filter((r) => r.id === s.id);
    return { id: s.id, title: s.tracking ? `${s.title} (tracking)` : s.title, passed: rs.filter((r) => r.pass).length, runs: rs.length, failures: rs.filter((r) => !r.pass).map((r) => r.failureReason) };
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(here, 'results');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${stamp}.json`), JSON.stringify({ summary, passRates, results }, null, 2));

  const md = [
    `# Voice eval — ${new Date().toISOString()}`,
    '',
    `Model \`${summary.model}\` · voice \`${summary.voice}\` · VAD \`${summary.vad}\` · caller \`${summary.persona}\` · judge \`${summary.judgeModel ?? 'off'}\``,
    '',
    `**${summary.passed}/${summary.scenarios} scenario runs passed.**`,
    '',
    '| Scenario | Pass rate | First failure |',
    '|---|---|---|',
    ...passRates.map((p) => `| ${p.id} · ${p.title} | ${p.passed}/${p.runs} | ${(p.failures[0] ?? '').replace(/\|/g, '/').slice(0, 160)} |`),
    '',
    '## Timing (approximate)',
    '',
    `- VAD end-of-turn → first audio: median ${fmt(summary.latency.vadToFirstAudio.median)}, p90 ${fmt(summary.latency.vadToFirstAudio.p90)} (n=${summary.latency.vadToFirstAudio.n})`,
    `- Caller stops speaking → first audio (includes VAD wait): median ${fmt(summary.latency.speechEndToFirstAudio.median)}, p90 ${fmt(summary.latency.speechEndToFirstAudio.p90)} (n=${summary.latency.speechEndToFirstAudio.n})`,
    `- Barge-in → response cancelled: median ${fmt(summary.latency.interruptionCancel.median)} (n=${summary.latency.interruptionCancel.n})`,
    `- ASR mean word error rate on caller turns: ${summary.asr.meanWordErrorRate ?? '—'} (n=${summary.asr.n})`,
    '',
    `> ${summary.latency.note}`,
    '',
  ].join('\n');
  await fs.writeFile(path.join(outDir, `${stamp}.md`), md);

  console.log(`\n${md}`);
  console.log(`Reports: evals/results/${stamp}.{json,md}`);
  // Tracking scenarios document known gaps; they never fail the build.
  process.exit(results.every((r) => r.pass || r.tracking) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
