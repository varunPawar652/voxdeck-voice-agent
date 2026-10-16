import type OpenAI from 'openai';
import { slides } from '@voxdeck/shared';
import type { Check, RunRecord } from './types.ts';

const deckSummary = slides
  .map((s) => `Slide ${s.number} "${s.title}": ${s.summary} Example${s.example.illustrative ? ' (illustrative)' : ''}: ${s.example.text} Sources: ${s.sources.map((x) => x.label).join('; ') || 'none'}.`)
  .join('\n');

/** Renders the conversation as the judge sees it: what was said, heard, and shown. */
export function renderConversation(run: RunRecord): string {
  type Line = { t: number; text: string };
  const lines: Line[] = [];
  for (const turn of run.turns) {
    lines.push({ t: turn.audioEndAt ?? turn.startedAt, text: `USER (spoken): ${turn.text}${turn.asrTranscript && turn.asrTranscript !== turn.text ? `  [speech recognition heard: "${turn.asrTranscript}"]` : ''}` });
  }
  for (const nav of run.navigations) lines.push({ t: nav.at, text: `[screen: slide changed from ${nav.from} to ${nav.to}]` });
  let connections = 0;
  for (const e of run.diag) {
    if (e.kind === 'tool.failed') lines.push({ t: e.t, text: '[screen: the slide-change tool FAILED; the slide did not change]' });
    if (e.kind === 'session.lost') lines.push({ t: e.t, text: '[connection dropped]' });
    if (e.kind === 'session.connected' && ++connections > 1) lines.push({ t: e.t, text: '[reconnected in a new session]' });
  }
  const doneAt = new Map(run.events.filter((e) => e.type === 'response.done' && e.responseId).map((e) => [e.responseId!, e.t]));
  for (const entry of run.transcript) {
    if (entry.role !== 'assistant' || !entry.text) continue;
    const t = (entry.responseId ? doneAt.get(entry.responseId) : undefined) ?? run.endedAt;
    lines.push({ t, text: `ASSISTANT (spoken)${entry.state === 'interrupted' ? ' [cut off by the user]' : ''}: ${entry.text}` });
  }
  return lines
    .sort((a, b) => a.t - b.t)
    .map((l) => l.text)
    .join('\n');
}

export class Judge {
  constructor(
    private readonly client: OpenAI | null,
    private readonly model: string,
  ) {}

  get enabled() {
    return this.client !== null;
  }

  /** Scores one semantic criterion. Returns a skipped check (pass: null) if judging is off or fails. */
  async check(name: string, run: RunRecord, rubric: string): Promise<Check> {
    if (!this.client) return { name, pass: null, kind: 'judge', detail: 'judge disabled (--no-judge)' };
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'verdict',
            strict: true,
            schema: {
              type: 'object',
              properties: { reason: { type: 'string' }, pass: { type: 'boolean' } },
              required: ['reason', 'pass'],
              additionalProperties: false,
            },
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You grade one behaviour of a voice AI presenter that explains a six-slide deck and can change slides with a tool. ' +
              'Judge ONLY the criterion given. Spoken transcripts are paraphrased speech: ignore filler, grammar and minor ASR noise. ' +
              'Be strict about the criterion and lenient about everything else. Give a one-sentence reason, then the verdict.\n\nDeck:\n' +
              deckSummary,
          },
          { role: 'user', content: `Criterion: ${rubric}\n\nConversation (chronological):\n${renderConversation(run)}` },
        ],
      });
      const verdict = JSON.parse(res.choices[0]?.message.content ?? '{}') as { pass?: boolean; reason?: string };
      return { name, pass: verdict.pass === true, kind: 'judge', detail: verdict.reason ?? '' };
    } catch (err) {
      return { name, pass: null, kind: 'judge', detail: `judge error: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown'}` };
    }
  }
}
