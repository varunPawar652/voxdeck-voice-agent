import { beforeEach, describe, expect, it } from 'vitest';
import {
  INTERRUPTED_BADGE_MS,
  NEXT_SENTENCE_MAX_WAIT_MS,
  PresenterController,
  type Scheduler,
} from '../src/lib/presenterController.ts';
import type { ClientEvent } from '../src/types/realtime.ts';

class FakeClock implements Scheduler {
  time = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private seq = 0;
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }
  now() {
    return this.time;
  }
  advance(ms: number) {
    this.time += ms;
    for (const [id, t] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= this.time) {
        this.timers.delete(id);
        t.fn();
      }
    }
  }
}

function setup(startSlide = 1) {
  const sent: ClientEvent[] = [];
  const deck = { slide: startSlide, moves: [] as number[] };
  const clock = new FakeClock();
  const controller = new PresenterController(
    (e) => {
      sent.push(e);
      return true;
    },
    {
      getCurrentSlide: () => deck.slide,
      goTo: (n) => {
        deck.slide = n;
        deck.moves.push(n);
      },
    },
    clock,
  );
  controller.markConnecting();
  controller.markConnected();
  sent.length = 0; // drop the greeting response.create
  return { controller, sent, deck, clock, status: () => controller.getSnapshot().status };
}

const call = (callId: string, args: unknown, name = 'navigate_to_slide') => ({
  type: 'function_call',
  call_id: callId,
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
  status: 'completed',
});

const responseDone = (id: string, output: unknown[] = [], status = 'completed', reason?: string) => ({
  type: 'response.done',
  response: { id, status, output, status_details: reason ? { type: status, reason } : null },
});

const outputs = (sent: ClientEvent[]) =>
  sent
    .filter((e): e is Extract<ClientEvent, { type: 'conversation.item.create' }> => e.type === 'conversation.item.create' && e.item.type === 'function_call_output')
    .map((e) => JSON.parse((e.item as { output: string }).output) as Record<string, unknown>);

describe('PresenterController — tool dispatch', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('navigates, returns the slide content, and asks the model to continue', () => {
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 3, reason: 'Tool calling', transition: 'immediate' })]));

    expect(t.deck.moves).toEqual([3]);
    expect(t.sent.map((e) => e.type)).toEqual(['conversation.item.create', 'response.create']);
    const [out] = outputs(t.sent);
    expect(out).toMatchObject({ ok: true, slide_number: 3, title: 'Tools, APIs & Function Calling', already_on_slide: false });
    expect(t.controller.getSnapshot().lastNavigation).toMatchObject({ slide: 3, reason: 'Tool calling' });
  });

  it('executes a call id only once even if response.done is replayed', () => {
    const done = responseDone('r1', [call('c1', { slide_number: 4, reason: 'RAG', transition: 'immediate' })]);
    t.controller.handleServerEvent(done);
    t.controller.handleServerEvent(done);
    expect(t.deck.moves).toEqual([4]);
    expect(outputs(t.sent)).toHaveLength(1);
  });

  it('does not move when already on the requested slide', () => {
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 1, reason: 'Intro', transition: 'immediate' })]));
    expect(t.deck.moves).toEqual([]);
    expect(outputs(t.sent)[0]).toMatchObject({ ok: true, already_on_slide: true });
  });

  it.each([
    ['malformed JSON', call('c1', '{"slide_number": 3'), /not valid JSON/],
    ['out-of-range slide', call('c1', { slide_number: 9, reason: 'x', transition: 'immediate' }), /slide_number/],
    ['missing reason', call('c1', { slide_number: 2, transition: 'immediate' }), /reason/],
    ['bad transition', call('c1', { slide_number: 2, reason: 'x', transition: 'teleport' }), /transition/],
    ['unknown tool', call('c1', { slide_number: 2 }, 'delete_everything'), /Unknown tool/],
  ])('rejects %s without navigating, and lets the model recover', (_label, item, pattern) => {
    t.controller.handleServerEvent(responseDone('r1', [item]));
    expect(t.deck.moves).toEqual([]);
    const [out] = outputs(t.sent);
    expect(out!.ok).toBe(false);
    expect(String(out!.error)).toMatch(pattern);
    expect(t.sent.at(-1)!.type).toBe('response.create');
  });

  it('closes out calls from a failed response without requesting another response', () => {
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 5, reason: 'x', transition: 'immediate' })], 'failed'));
    expect(t.deck.moves).toEqual([]);
    expect(outputs(t.sent)[0]).toMatchObject({ ok: false });
    expect(t.sent.some((e) => e.type === 'response.create')).toBe(false);
    expect(t.controller.getSnapshot().transcript.at(-1)!.text).toMatch(/Response failed/);
  });

  it('ignores garbage events', () => {
    for (const junk of [null, 42, 'x', {}, { type: 7 }]) t.controller.handleServerEvent(junk);
    expect(t.sent).toEqual([]);
  });
});

describe('PresenterController — next_sentence transitions', () => {
  it('waits for the current audio to finish before changing slide', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 2, reason: 'Loop', transition: 'next_sentence' })]));

    expect(t.deck.moves).toEqual([]);
    t.controller.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: 'r1' });
    expect(t.deck.moves).toEqual([2]);
    expect(outputs(t.sent)).toHaveLength(1);
  });

  it('falls back to a bounded timeout', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 6, reason: 'Safety', transition: 'next_sentence' })]));
    t.clock.advance(NEXT_SENTENCE_MAX_WAIT_MS - 1);
    expect(t.deck.moves).toEqual([]);
    t.clock.advance(1);
    expect(t.deck.moves).toEqual([6]);
  });

  it('switches immediately when nothing is playing', () => {
    const t = setup();
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 2, reason: 'x', transition: 'next_sentence' })]));
    expect(t.deck.moves).toEqual([2]);
  });

  it('drops a deferred navigation if the user navigates manually first', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 4, reason: 'x', transition: 'next_sentence' })]));
    t.deck.slide = 2;
    t.controller.notifyManualNavigation(2);
    t.clock.advance(NEXT_SENTENCE_MAX_WAIT_MS);
    t.controller.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: 'r1' });

    expect(t.deck.moves).toEqual([]);
    expect(outputs(t.sent)).toEqual([expect.objectContaining({ ok: false })]);
  });
});

describe('PresenterController — barge-in', () => {
  it('handles the "Wait, explain tool calling instead" scenario end to end', () => {
    const t = setup(2);

    // The presenter is mid-explanation of slide 2.
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent({ type: 'response.output_audio_transcript.delta', response_id: 'r1', item_id: 'a1', delta: 'An agent wraps the model in a loop' });
    expect(t.status()).toBe('speaking');

    // User starts talking over it → server VAD fires.
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    expect(t.status()).toBe('interrupted');
    const a1 = t.controller.getSnapshot().transcript.find((e) => e.id === 'a1')!;
    expect(a1.state).toBe('interrupted');

    // Late events from the cancelled response must not leak into the UI.
    t.controller.handleServerEvent({ type: 'response.output_audio_transcript.delta', response_id: 'r1', item_id: 'a1', delta: ' that keeps going' });
    expect(t.controller.getSnapshot().transcript.find((e) => e.id === 'a1')!.text).toBe('An agent wraps the model in a loop');

    // Server confirms cancellation (interrupt_response: true). No new response is requested by us.
    t.controller.handleServerEvent(responseDone('r1', [], 'cancelled', 'turn_detected'));
    t.controller.handleServerEvent({ type: 'output_audio_buffer.cleared', response_id: 'r1' });
    expect(t.sent.some((e) => e.type === 'response.create')).toBe(false);

    t.controller.handleServerEvent({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Wait, explain tool calling instead.' });
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    t.clock.advance(INTERRUPTED_BADGE_MS);

    // The new response navigates to slide 3.
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r2', status: 'in_progress' } });
    expect(t.status()).toBe('thinking');
    t.controller.handleServerEvent(responseDone('r2', [call('c2', { slide_number: 3, reason: 'User asked about tool calling', transition: 'immediate' })]));

    expect(t.deck.slide).toBe(3);
    expect(outputs(t.sent).at(-1)).toMatchObject({ ok: true, slide_number: 3 });
    expect(t.sent.at(-1)!.type).toBe('response.create');
  });

  it('never executes a tool call carried by an interrupted response', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 5, reason: 'x', transition: 'immediate' })], 'cancelled', 'turn_detected'));

    expect(t.deck.moves).toEqual([]);
    // The dangling call is closed out so conversation state stays consistent…
    expect(outputs(t.sent)).toEqual([expect.objectContaining({ ok: false, error: expect.stringMatching(/interrupted/) })]);
    // …but we don't make the model talk over the user.
    expect(t.sent.some((e) => e.type === 'response.create')).toBe(false);
  });

  it('cancels a pending next_sentence navigation on interruption', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 4, reason: 'x', transition: 'next_sentence' })]));
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    t.clock.advance(NEXT_SENTENCE_MAX_WAIT_MS * 2);
    expect(t.deck.moves).toEqual([]);
  });

  it('speech with nothing playing is a normal turn, not an interruption', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    expect(t.status()).toBe('listening');
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    expect(t.status()).toBe('thinking');
  });

  it('settles from interrupted back to listening', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    expect(t.status()).toBe('interrupted');
    t.clock.advance(INTERRUPTED_BADGE_MS);
    expect(t.status()).toBe('listening');
  });
});

describe('PresenterController — manual controls', () => {
  it('manual interrupt cancels the response, then clears queued audio', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.interrupt();

    expect(t.sent.map((e) => e.type)).toEqual(['response.cancel', 'output_audio_buffer.clear']);
    expect(t.sent[0]).toEqual({ type: 'response.cancel', response_id: 'r1' });
    expect(t.status()).toBe('interrupted');
  });

  it('manual interrupt still flushes audio after generation has finished', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1'));
    t.controller.interrupt();
    expect(t.sent.map((e) => e.type)).toEqual(['output_audio_buffer.clear']);
  });

  it('manual interrupt is a no-op when the presenter is idle', () => {
    const t = setup();
    t.controller.interrupt();
    expect(t.sent).toEqual([]);
  });

  it('tells the model when the user changes slide by hand', () => {
    const t = setup();
    t.controller.notifyManualNavigation(4);
    expect(t.sent).toHaveLength(1);
    const item = (t.sent[0] as Extract<ClientEvent, { type: 'conversation.item.create' }>).item;
    expect(item).toMatchObject({ type: 'message', role: 'system' });
    expect(JSON.stringify(item)).toContain('slide 4');
    // It must not trigger an unprompted monologue.
    expect(t.sent.some((e) => e.type === 'response.create')).toBe(false);
  });

  it('typed questions interrupt an in-flight answer and start a new turn', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.askText('Explain memory and RAG.');
    expect(t.sent.map((e) => e.type)).toEqual(['response.cancel', 'output_audio_buffer.clear', 'conversation.item.create', 'response.create']);
    expect(t.controller.getSnapshot().transcript.some((e) => e.role === 'user' && e.text === 'Explain memory and RAG.')).toBe(true);
  });
});

describe('PresenterController — status lifecycle', () => {
  it('moves listening → thinking → speaking → listening', () => {
    const t = setup();
    expect(t.status()).toBe('listening');
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    expect(t.status()).toBe('thinking');
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    expect(t.status()).toBe('speaking');
    t.controller.handleServerEvent(responseDone('r1'));
    expect(t.status()).toBe('speaking'); // audio is still draining
    t.controller.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: 'r1' });
    expect(t.status()).toBe('listening');
  });

  it('surfaces errors and resets on disconnect', () => {
    const t = setup();
    t.controller.markError('Microphone access was blocked.');
    expect(t.controller.getSnapshot()).toMatchObject({ status: 'error', error: 'Microphone access was blocked.' });
    t.controller.markDisconnected();
    expect(t.status()).toBe('idle');
  });

  it('greets on connect, or asks a queued question instead', () => {
    const sent: ClientEvent[] = [];
    const c = new PresenterController((e) => (sent.push(e), true), { getCurrentSlide: () => 1, goTo: () => {} });
    c.markConnected();
    expect(sent).toEqual([{ type: 'response.create' }]);
    sent.length = 0;
    c.markConnected({ initialQuestion: 'What are the main production risks?' });
    expect(sent.map((e) => e.type)).toEqual(['conversation.item.create', 'response.create']);
  });
});

describe('PresenterController — reliability fixes', () => {
  it('reports a failing navigation handler to the model instead of crashing', () => {
    const sent: ClientEvent[] = [];
    const c = new PresenterController((e) => (sent.push(e), true), {
      getCurrentSlide: () => 1,
      goTo: () => {
        throw new Error('render failed');
      },
    });
    c.markConnected({ greet: false });
    expect(() => c.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 3, reason: 'x', transition: 'immediate' })]))).not.toThrow();
    expect(outputs(sent)).toEqual([expect.objectContaining({ ok: false, error: 'The slide could not be changed.', current_slide: 1 })]);
    expect(sent.at(-1)!.type).toBe('response.create'); // the model gets to say so
    expect(c.diag.getEvents().some((e) => e.kind === 'tool.failed')).toBe(true);
  });

  it('retries a response.create rejected by an active response, once that response ends', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'error', error: { type: 'invalid_request_error', code: 'conversation_already_has_active_response' } });
    expect(t.sent).toEqual([]);
    t.controller.handleServerEvent(responseDone('r0', [], 'cancelled'));
    expect(t.sent).toEqual([{ type: 'response.create' }]);
    // only once
    t.controller.handleServerEvent(responseDone('r1'));
    expect(t.sent).toHaveLength(1);
  });

  it('does not retry if the user has spoken since the rejection', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r0', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'error', error: { code: 'conversation_already_has_active_response' } });
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    t.controller.handleServerEvent(responseDone('r0', [], 'cancelled'));
    expect(t.sent.some((e) => e.type === 'response.create')).toBe(false);
  });

  it('shows thinking, not speaking, while the follow-up response is generating', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 3, reason: 'x', transition: 'immediate' })]));
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r2', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.stopped', response_id: 'r1' });
    expect(t.status()).toBe('thinking');
  });

  it('can connect without greeting (used by the eval harness)', () => {
    const sent: ClientEvent[] = [];
    const c = new PresenterController((e) => (sent.push(e), true), { getCurrentSlide: () => 1, goTo: () => {} });
    c.markConnected({ greet: false });
    expect(sent).toEqual([]);
    expect(c.getSnapshot().status).toBe('listening');
  });
});

describe('PresenterController — diagnostics', () => {
  it('measures turn → first audio from speech_stopped', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'u1' });
    t.clock.advance(640);
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r1', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r1' });
    expect(t.controller.diag.getMetrics().turnLatencyMs).toEqual([640]);
    // A second audio start in the same turn (post-tool response) is not a new turn.
    t.controller.handleServerEvent({ type: 'output_audio_buffer.started', response_id: 'r2' });
    expect(t.controller.diag.getMetrics().turnLatencyMs).toEqual([640]);
  });

  it('counts tool calls, navigations, interruptions and cancellations without double counting', () => {
    const t = setup();
    t.controller.handleServerEvent(responseDone('r1', [call('c1', { slide_number: 4, reason: 'x', transition: 'immediate' })]));
    t.controller.handleServerEvent(responseDone('r2', [call('c2', '{bad json')]));
    t.controller.handleServerEvent({ type: 'response.created', response: { id: 'r3', status: 'in_progress' } });
    t.controller.handleServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'u1' });
    t.controller.handleServerEvent(responseDone('r3', [call('c3', { slide_number: 2, reason: 'x', transition: 'immediate' })], 'cancelled', 'turn_detected'));
    const m = t.controller.diag.getMetrics();
    expect(m).toMatchObject({ toolCalls: 2, toolFailures: 1, navigations: 1, cancelledResponses: 1, interruptions: { auto: 1, manual: 0 } });
  });

  it('records the realtime session id and grounding flags, never transcript text', () => {
    const t = setup();
    t.controller.handleServerEvent({ type: 'session.created', session: { id: 'sess_abc123' } });
    t.controller.handleServerEvent({ type: 'response.output_audio_transcript.done', response_id: 'r1', item_id: 'a1', transcript: 'About 73 percent of agents fail, says a recent study by Acme.' });
    const events = t.controller.diag.getEvents();
    expect(events.find((e) => e.kind === 'session.realtime_id')?.data).toEqual({ id: 'sess_abc123' });
    const flag = events.find((e) => e.kind === 'grounding.flag')!;
    expect(flag.realtimeSessionId).toBe('sess_abc123');
    expect(JSON.stringify(events)).not.toContain('Acme');
    expect(t.controller.getSnapshot().transcript.find((e) => e.id === 'a1')?.groundingFlags?.length).toBeGreaterThan(0);
  });
});
