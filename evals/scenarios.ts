import { auditGrounding } from '@voxdeck/shared';
import type { Judge } from './harness/judge.ts';
import { sleep, type LiveVoiceSession } from './harness/liveSession.ts';
import type { Check, RunRecord, TurnRecord } from './harness/types.ts';

export interface ScenarioContext {
  session: LiveVoiceSession;
  say(text: string): Promise<TurnRecord>;
  reconnect(): Promise<void>;
}

export interface Scenario {
  id: string;
  title: string;
  /** Documentation fields — printed in reports and the README. */
  input: string;
  setup: string;
  expected: string;
  criteria: string[];
  startSlide: number;
  greet?: boolean;
  failNavigation?: boolean;
  /** Known-issue scenario: reported, but excluded from the CI exit code. */
  tracking?: boolean;
  script(ctx: ScenarioContext): Promise<void>;
  checks(run: RunRecord, judge: Judge): Promise<Check[]>;
}

// ── deterministic check helpers ──────────────────────────────────────────────
const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, kind: 'deterministic', ...(detail ? { detail } : {}) });

const navsInTurn = (run: RunRecord, turn: number) => run.navigations.filter((n) => n.turn === turn);

function navigatedTo(run: RunRecord, slide: number, turn: number): Check {
  const navs = navsInTurn(run, turn);
  return check(
    `turn ${turn + 1}: navigates to slide ${slide}`,
    navs.at(-1)?.to === slide,
    navs.length ? `navigations: ${navs.map((n) => `${n.from}→${n.to}`).join(', ')}` : 'no navigation',
  );
}

function stayed(run: RunRecord, turn: number, why = 'no navigation'): Check {
  const navs = navsInTurn(run, turn);
  return check(`turn ${turn + 1}: ${why}`, navs.length === 0, navs.length ? `unexpected: ${navs.map((n) => `${n.from}→${n.to}`).join(', ')}` : undefined);
}

function finalSlide(run: RunRecord, slide: number): Check {
  return check(`final slide is ${slide}`, run.finalSlide === slide, `final slide ${run.finalSlide}`);
}

/** Invariant: never two responses generating at once. */
function noOverlappingResponses(run: RunRecord): Check {
  const active = new Set<string>();
  for (const e of run.events) {
    if (e.type === 'response.created' && e.responseId) {
      if (active.size > 0) return check('no overlapping responses', false, `${e.responseId} created while ${[...active].join(', ')} active`);
      active.add(e.responseId);
    }
    if (e.type === 'response.done' && e.responseId) active.delete(e.responseId);
  }
  return check('no overlapping responses', true);
}

/** Invariant: slide changes come only from responses that completed normally. */
function noStaleNavigation(run: RunRecord): Check {
  const status = new Map(run.events.filter((e) => e.type === 'response.done').map((e) => [e.responseId, e.status]));
  const interrupted = new Set(run.interruptions.map((i) => i.responseId));
  const bad = run.diag
    .filter((e) => e.kind === 'nav.executed')
    .filter((e) => status.get(String(e.data?.responseId)) !== 'completed' || interrupted.has(String(e.data?.responseId)));
  return check('no navigation from a cancelled or interrupted response', bad.length === 0, bad.length ? `stale: ${bad.map((e) => e.data?.responseId).join(', ')}` : undefined);
}

/** Invariant: each function call gets exactly one output. */
function exactlyOnceToolOutputs(run: RunRecord): Check {
  const calls = run.events.flatMap((e) => e.calls ?? []).map((c) => c.callId);
  const outputs = run.diag.filter((e) => e.kind === 'tool.result').map((e) => String(e.data?.callId));
  const dupes = outputs.filter((id, i) => outputs.indexOf(id) !== i);
  const missing = calls.filter((id) => !outputs.includes(id));
  return check('every tool call answered exactly once', dupes.length === 0 && missing.length === 0, dupes.length || missing.length ? `duplicates: ${dupes.join(',') || '-'}; missing: ${missing.join(',') || '-'}` : `${calls.length} call(s)`);
}

function assistantSpoke(run: RunRecord, turn: number): Check {
  const after = run.turns[turn]?.audioEndAt ?? 0;
  const spoke = run.turns[turn]?.firstAudioAt !== null && run.turns[turn]!.firstAudioAt! >= after;
  return check(`turn ${turn + 1}: assistant answered with audio`, spoke);
}

function groundingClean(run: RunRecord): Check {
  const numbers = run.transcript
    .filter((e) => e.role === 'assistant')
    .flatMap((e) => auditGrounding(e.text))
    .filter((f) => f.kind === 'unsupported_number');
  return check('no numbers absent from the deck (grounding audit)', numbers.length === 0, numbers.length ? numbers.map((f) => f.text).join(', ') : undefined);
}

const standardInvariants = (run: RunRecord) => [noOverlappingResponses(run), noStaleNavigation(run), exactlyOnceToolOutputs(run)];

// ── scenarios ────────────────────────────────────────────────────────────────
const TOOLS_Q = 'How does the agent use tools?';

export const scenarios: Scenario[] = [
  {
    id: 'A',
    title: 'Direct question',
    input: `"${TOOLS_Q}"`,
    setup: 'Fresh session on slide 1.',
    expected: 'Navigates to slide 3 (tools) and explains tool calling from the slide content.',
    criteria: ['Slide 3 shown during turn 1', 'Audio answer follows', 'Explanation covers model-proposes / app-validates-and-executes', 'No ungrounded numbers'],
    startSlide: 1,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say(TOOLS_Q));
    },
    async checks(run, judge) {
      return [
        navigatedTo(run, 3, 0),
        assistantSpoke(run, 0),
        ...standardInvariants(run),
        groundingClean(run),
        await judge.check('explains tool calling', run, 'After the slide change, the assistant explains how the agent uses tools: the model emits a structured function call and the application validates and executes it. It must be a short spoken explanation, not just an announcement of the slide title.'),
      ];
    },
  },
  {
    id: 'B',
    title: 'Follow-up keeps context',
    input: `"${TOOLS_Q}" then "Why do we need that?"`,
    setup: 'Fresh session on slide 1; two turns.',
    expected: 'Turn 2 answers *why* (validation/safety of tool use) without navigating.',
    criteria: ['No navigation in turn 2', 'Still on slide 3', 'Answer refers back to tool calling'],
    startSlide: 1,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say(TOOLS_Q));
      await session.waitForTurnComplete(await say('Why do we need that?'));
    },
    async checks(run, judge) {
      return [
        navigatedTo(run, 3, 0),
        stayed(run, 1, 'follow-up does not navigate'),
        finalSlide(run, 3),
        ...standardInvariants(run),
        await judge.check('follow-up uses context', run, 'The FINAL assistant answer explains why this is needed, clearly referring to the previous topic (tool calling / validating tool calls). It must not switch to an unrelated topic or ask what "that" means, since the context is clear.'),
      ];
    },
  },
  {
    id: 'C',
    title: 'Topic switch',
    input: '"Actually, explain interruption handling."',
    setup: 'Fresh session already on slide 3 (tools).',
    expected: 'Navigates to slide 4 and explains interruption handling.',
    criteria: ['Slide 4 shown', 'Explanation covers stopping/cancelling and dropping stale output'],
    startSlide: 3,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say('Actually, explain interruption handling.'));
    },
    async checks(run, judge) {
      return [
        navigatedTo(run, 4, 0),
        ...standardInvariants(run),
        await judge.check('explains interruption handling', run, 'The assistant explains interruption handling: detecting that the user started speaking, stopping/cancelling the current answer, and (at least one of) truncating unplayed audio or discarding stale actions.'),
      ];
    },
  },
  {
    id: 'D',
    title: 'Mid-sentence interruption',
    input: '"Can you walk me through this slide?" … after ~1.5 s of answer audio: "Wait — explain interruption handling instead."',
    setup: 'Fresh session on slide 2 (architecture).',
    expected: 'The slide-2 answer stops; nothing from it is applied; slide 4 is shown and the new question answered.',
    criteria: [
      'Barge-in detected while audio was playing',
      'Unplayed audio truncated (audio_end_ms sent); stale audio discarded',
      'Interrupted response cancelled or already finished — never resumed',
      'Final slide 4; no navigation from the interrupted response',
      'Final answer is about interruption handling',
    ],
    startSlide: 2,
    async script({ session, say }) {
      await say('Can you walk me through this slide?');
      await session.waitForAudibleSpeech(1_500);
      await session.waitForTurnComplete(await say('Wait, explain interruption handling instead.'));
    },
    async checks(run, judge) {
      const i = run.interruptions[0];
      return [
        check('barge-in detected during playback', Boolean(i) && run.diag.some((e) => e.kind === 'interrupt.auto'), i ? `heard ${i.playedMs} ms before interrupting` : 'no interruption recorded'),
        check(
          'server stopped streaming the old answer within 1.5 s',
          Boolean(i) && (i!.lastStaleDeltaAfterMs === null || i!.lastStaleDeltaAfterMs <= 1_500),
          i ? `${i.staleDeltasDiscarded} stale chunk(s) discarded, last at +${i.lastStaleDeltaAfterMs ?? 0} ms` : undefined,
        ),
        check(
          'generation stopped promptly (cancelled ≤ 1500 ms, or already finished)',
          Boolean(i) && (i!.cancelLatencyMs === null || i!.cancelLatencyMs <= 1_500),
          i ? (i.cancelLatencyMs === null ? 'generation had already finished — playback truncated' : `cancelled after ${i.cancelLatencyMs} ms`) : undefined,
        ),
        finalSlide(run, 4),
        ...standardInvariants(run),
        await judge.check('handles the new intent', run, 'After being cut off, the assistant addresses interruption handling (the new request) and does not continue or summarize its previous slide-2 explanation.'),
      ];
    },
  },
  {
    id: 'E',
    title: 'Ambiguous request',
    input: '"Can you explain that better?"',
    setup: 'Fresh session on slide 1; the presenter greets first, so the only context is the greeting and slide 1.',
    expected: 'Either asks one short clarifying question or re-explains the slide on screen more simply — no arbitrary jump.',
    criteria: ['No navigation', 'Clarifies or uses context; does not invent a topic'],
    startSlide: 1,
    greet: true,
    async script({ session, say }) {
      await session.waitFor(() => session.controller.getSnapshot().status === 'listening' && session.record.events.some((e) => e.type === 'response.done'), 15_000, 'greeting');
      await sleep(1_500);
      await session.waitForTurnComplete(await say('Can you explain that better?'));
    },
    async checks(run, judge) {
      return [
        stayed(run, 0, 'ambiguous request does not navigate'),
        ...standardInvariants(run),
        await judge.check('clarifies or uses context', run, 'The user asked "Can you explain that better?" right after a greeting. A good answer EITHER asks one brief clarifying question about what to explain, OR explains the slide on screen (slide 1: why voice agents are different) more simply. It fails if it jumps to an unrelated topic or delivers a long monologue.'),
      ];
    },
  },
  {
    id: 'F',
    title: 'Out-of-scope request',
    input: '"What\'s the weather going to be in Boston tomorrow?"',
    setup: 'Fresh session on slide 1.',
    expected: 'Says it is outside the presentation and does not invent a forecast; no navigation.',
    criteria: ['No navigation', 'No fabricated forecast or numbers', 'Acknowledges the limitation'],
    startSlide: 1,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say("What's the weather going to be in Boston tomorrow?"));
    },
    async checks(run, judge) {
      return [
        stayed(run, 0, 'off-topic request does not navigate'),
        groundingClean(run),
        ...standardInvariants(run),
        await judge.check('acknowledges limitation', run, 'The assistant says the question is outside this presentation (or that it cannot check the weather) and does NOT state any forecast, temperature or weather condition.'),
      ];
    },
  },
  {
    id: 'G',
    title: 'Rapid consecutive questions',
    input: `"${TOOLS_Q}" then, ~0.4 s after the turn is detected, "Actually no — how do you evaluate a voice agent?"`,
    setup: 'Fresh session on slide 1. The second question lands while the first answer is being generated.',
    expected: 'Ends on slide 6 answering the second question; no overlapping responses, duplicate calls or stale navigation.',
    criteria: ['Final slide 6', 'No overlapping responses', 'No navigation from cancelled responses', 'Exactly one output per call'],
    startSlide: 1,
    async script({ session, say }) {
      const first = await say(TOOLS_Q);
      await session.waitFor(() => first.speechStoppedAt !== null, 10_000, 'first turn to be detected');
      await sleep(400);
      await session.waitForTurnComplete(await say('Actually no, how do you evaluate a voice agent?'));
    },
    async checks(run, judge) {
      return [
        finalSlide(run, 6),
        check('at most two slide changes', run.navigations.length <= 2, `${run.navigations.length} navigation(s)`),
        ...standardInvariants(run),
        await judge.check('answers the latest question', run, 'The final assistant answer is about evaluating voice agents, the user\'s most recent question. It must not end on an answer about tool calling.'),
      ];
    },
  },
  {
    id: 'H',
    title: 'Tool failure',
    input: `"${TOOLS_Q}" with the slide-change handler forced to throw`,
    setup: 'Fresh session on slide 1; the deck handler throws on every navigation.',
    expected: 'The slide stays on 1, the model receives ok:false, and the presenter never claims the slide changed.',
    criteria: ['Slide unchanged', 'tool.failed recorded and ok:false returned', 'No false claim of success', 'Still answers the question'],
    startSlide: 1,
    failNavigation: true,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say(TOOLS_Q));
    },
    async checks(run, judge) {
      return [
        finalSlide(run, 1),
        check('handler failure reported as ok:false', run.diag.some((e) => e.kind === 'tool.failed') && run.diag.some((e) => e.kind === 'tool.result' && e.data?.ok === false && !e.data?.cancelled)),
        ...standardInvariants(run),
        await judge.check('no false success claim', run, 'The slide-change tool FAILED. The assistant must NOT say or imply that the slide changed or that the tools slide is now on screen ("here on slide 3", "as you can see"). A short forward-looking cue before the tool ran (e.g. "Let\'s look at tool calling") is fine. Pass if it acknowledges it could not switch or simply answers without claiming the switch.'),
      ];
    },
  },
  {
    id: 'I',
    title: 'Connection failure and recovery',
    input: '"How do you evaluate a voice agent?" → socket killed → reconnect → "And how does the agent use tools?"',
    setup: 'Fresh session on slide 1. The WebSocket is terminated after the first answer, then a new session is opened.',
    expected: 'Status becomes error with a reconnect message; a new session starts on the current slide and works.',
    criteria: ['Error state after drop', 'New realtime session id', 'Second question navigates to slide 3'],
    startSlide: 1,
    async script({ session, say, reconnect }) {
      await session.waitForTurnComplete(await say('How do you evaluate a voice agent?'));
      session.drop();
      await session.waitFor(() => session.controller.getSnapshot().status === 'error', 5_000, 'error state');
      await reconnect();
      await session.waitForTurnComplete(await say('And how does the agent use tools?'));
    },
    async checks(run) {
      const errorState = run.statusHistory.find((s) => s.status === 'error');
      return [
        check('error state shown after drop', Boolean(errorState), errorState?.error ?? 'never entered error'),
        check('recovered in a new session', new Set(run.realtimeSessionIds).size === 2, `${run.realtimeSessionIds.length} session id(s)`),
        navigatedTo(run, 6, 0),
        navigatedTo(run, 3, 1),
        ...standardInvariants(run),
      ];
    },
  },
  {
    id: 'K',
    title: 'Mid-thought pause (turn-detection trade-off)',
    input: '"So can you explain how the agent handles…" (1 s pause) "…being interrupted while it\'s talking?"',
    setup: 'Fresh session on slide 1. Measures whether turn detection waits for a finished thought.',
    expected: 'The presenter waits for the whole question, then goes to slide 4 — it does not answer the fragment.',
    criteria: ['No response started during the pause', 'Final slide 4'],
    startSlide: 1,
    // Tracking: with synthesized speech (sentence-final prosody on the fragment), neither VAD mode
    // reliably waits out a 1 s pause. Barge-in recovers; the strict check documents the gap.
    tracking: true,
    async script({ session, say }) {
      await say('So can you explain how the agent handles');
      await sleep(1_000);
      await session.waitForTurnComplete(await say("being interrupted while it's talking?"));
    },
    async checks(run) {
      const [first, second] = run.turns;
      const jumpedIn = run.events.filter((e) => e.type === 'response.created' && first?.audioEndAt && second && e.t > first.audioEndAt && e.t < second.startedAt + 300);
      return [
        check('did not answer the half-finished sentence', jumpedIn.length === 0, jumpedIn.length ? `${jumpedIn.length} response(s) started during the pause` : 'waited for the full question'),
        finalSlide(run, 4),
        ...standardInvariants(run),
      ];
    },
  },
  {
    id: 'J',
    title: 'Grounding: nonexistent statistic',
    input: '"What percentage of voice agents fail in production? Which study shows that?"',
    setup: 'Fresh session on slide 1.',
    expected: 'States that the deck has no such figure or study; does not invent one.',
    criteria: ['No numbers absent from the deck', 'No invented study or citation', 'Says the information is not in the presentation'],
    startSlide: 1,
    async script({ session, say }) {
      await session.waitForTurnComplete(await say('What percentage of voice agents fail in production? Which study shows that?'));
    },
    async checks(run, judge) {
      return [
        groundingClean(run),
        ...standardInvariants(run),
        await judge.check('does not fabricate', run, 'The deck contains NO real-world failure rate and NO study about it. The assistant must not state a failure percentage as fact and must not name or invent a study. It should say the presentation does not include that. Mentioning the deck\'s illustrative compounding calculation (0.95 to the tenth ≈ 60%) is acceptable ONLY if framed as an illustration, not as a measured failure rate.'),
      ];
    },
  },
];
