/**
 * Deterministic counterparts of the live voice scenarios (evals/scenarios.ts).
 * They replay exact Realtime event orderings through the production controller, so
 * race conditions are pinned down regardless of what the model chooses to say.
 * They validate client logic only — not audio, VAD, or model behaviour.
 */
import { describe, expect, it } from 'vitest';
import { PresenterController, type Scheduler } from '../src/lib/presenterController.ts';
import type { ClientEvent } from '../src/types/realtime.ts';

function harness(startSlide = 1) {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const clock: Scheduler = {
    setTimeout: (fn, ms) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    now: () => now,
  };
  const sent: ClientEvent[] = [];
  const deck = { slide: startSlide, moves: [] as number[] };
  const c = new PresenterController(
    (e) => (sent.push(e), true),
    { getCurrentSlide: () => deck.slide, goTo: (n) => (deck.moves.push(n), (deck.slide = n)) },
    clock,
  );
  c.markConnecting();
  c.markConnected({ greet: false });
  const ev = (e: Record<string, unknown>) => c.handleServerEvent(e);
  const nav = (id: string, slide: number) => ({ type: 'function_call', call_id: id, name: 'navigate_to_slide', arguments: JSON.stringify({ slide_number: slide, reason: 'r', transition: 'immediate' }) });
  return {
    c,
    sent,
    deck,
    advance: (ms: number) => {
      now += ms;
      for (const t of [...timers].filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    },
    created: (id: string) => ev({ type: 'response.created', response: { id, status: 'in_progress' } }),
    done: (id: string, output: unknown[] = [], status = 'completed') => ev({ type: 'response.done', response: { id, status, output, status_details: status === 'cancelled' ? { reason: 'turn_detected' } : null } }),
    audio: (id: string, kind: 'started' | 'stopped' | 'cleared') => ev({ type: `output_audio_buffer.${kind}`, response_id: id }),
    speech: (kind: 'started' | 'stopped', item = 'u') => ev({ type: `input_audio_buffer.speech_${kind}`, item_id: item }),
    nav,
    outputs: () =>
      sent.filter((e) => e.type === 'conversation.item.create' && e.item.type === 'function_call_output').map((e) => JSON.parse((e as { item: { output: string } }).item.output)),
  };
}

describe('[D] interruptions around navigation', () => {
  it('BEFORE: user speaks while the tool call is still being generated → no navigation', () => {
    const h = harness();
    h.created('r1');
    h.speech('started');
    h.done('r1', [h.nav('c1', 3)], 'cancelled');
    expect(h.deck.moves).toEqual([]);
    expect(h.outputs()).toEqual([expect.objectContaining({ ok: false })]);
  });

  it('RACE: response.done(completed) lands just after speech_started → treated as stale', () => {
    const h = harness();
    h.created('r1');
    h.speech('started'); // VAD fires first…
    h.done('r1', [h.nav('c1', 3)], 'completed'); // …then the already-finished response arrives
    expect(h.deck.moves).toEqual([]);
    expect(h.sent.some((e) => e.type === 'response.create')).toBe(false); // user owns the turn
  });

  it('AFTER: interrupting the explanation keeps the (already executed) slide and drops the rest', () => {
    const h = harness();
    h.created('r1');
    h.done('r1', [h.nav('c1', 3)]);
    expect(h.deck.slide).toBe(3);
    h.created('r2');
    h.audio('r2', 'started');
    h.c.handleServerEvent({ type: 'response.output_audio_transcript.delta', response_id: 'r2', item_id: 'a2', delta: 'Tools are…' });
    h.speech('started');
    h.done('r2', [], 'cancelled');
    h.audio('r2', 'cleared');
    expect(h.deck.slide).toBe(3); // screen and model history agree: the move did happen
    expect(h.c.getSnapshot().transcript.find((e) => e.id === 'a2')?.state).toBe('interrupted');
    expect(h.deck.moves).toEqual([3]);
  });

  it('DURING a deferred transition: the pending slide change is cancelled', () => {
    const h = harness();
    h.created('r1');
    h.audio('r1', 'started');
    h.done('r1', [{ ...h.nav('c1', 4), arguments: JSON.stringify({ slide_number: 4, reason: 'r', transition: 'next_sentence' }) }]);
    h.speech('started');
    h.advance(5_000);
    h.audio('r1', 'stopped');
    expect(h.deck.moves).toEqual([]);
  });
});

describe('[G] rapid consecutive questions', () => {
  it('second question cancels the first answer; only the second navigation runs, exactly once', () => {
    const h = harness();
    h.speech('started', 'u1');
    h.speech('stopped', 'u1');
    h.created('r1');
    h.speech('started', 'u2'); // second question arrives before r1 finishes
    h.done('r1', [h.nav('c1', 3)], 'cancelled');
    h.speech('stopped', 'u2');
    h.created('r2');
    h.done('r2', [h.nav('c2', 6)]);
    h.done('r2', [h.nav('c2', 6)]); // duplicate delivery
    expect(h.deck.moves).toEqual([6]);
    expect(h.outputs().map((o) => o.ok)).toEqual([false, true]);
    expect(h.sent.filter((e) => e.type === 'response.create')).toHaveLength(1);
  });
});

describe('[H] tool failure', () => {
  it('malformed arguments → ok:false and the model is asked to recover, no slide change', () => {
    const h = harness();
    h.done('r1', [{ type: 'function_call', call_id: 'c1', name: 'navigate_to_slide', arguments: '{"slide_number": "three"' }]);
    expect(h.deck.moves).toEqual([]);
    expect(h.outputs()[0]).toMatchObject({ ok: false });
    expect(h.sent.at(-1)?.type).toBe('response.create');
  });
});

describe('[I] connection failure and recovery', () => {
  it('error clears in-flight state; reconnect starts clean but keeps slide and transcript', () => {
    const h = harness(4);
    h.c.handleServerEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'hello' });
    h.created('r1');
    h.audio('r1', 'started');
    h.c.markError('The voice connection was lost. Reconnect to continue.');
    expect(h.c.getSnapshot()).toMatchObject({ status: 'error' });
    h.c.interrupt(); // nothing in flight any more → no stray cancel events
    expect(h.sent).toEqual([]);

    h.c.markConnecting();
    h.c.markConnected({ greet: false });
    expect(h.c.getSnapshot().status).toBe('listening');
    expect(h.deck.slide).toBe(4);
    expect(h.c.getSnapshot().transcript.some((e) => e.text === 'hello')).toBe(true);
    // a late event from the dead session's response must not navigate
    h.done('r1', [h.nav('c9', 2)], 'cancelled');
    expect(h.deck.moves).toEqual([]);
  });
});
