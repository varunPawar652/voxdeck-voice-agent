import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type OpenAI from 'openai';

/** 24 kHz, 16-bit little-endian mono — the Realtime API's PCM input format. */
export const SAMPLE_RATE = 24_000;
export const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000; // 48

export interface Persona {
  id: string;
  voice: string;
  instructions: string;
}

/** Synthetic caller dispositions. Each run uses one; the suite can be repeated across personas. */
export const PERSONAS: Record<string, Persona> = {
  clear: {
    id: 'clear',
    voice: 'alloy',
    instructions: 'Speak clearly at a natural conversational pace, like a curious attendee asking a question in a meeting.',
  },
  rushed: {
    id: 'rushed',
    voice: 'ash',
    instructions: 'Speak quickly and a little impatiently, like a busy person squeezing in a question between meetings.',
  },
};

const TTS_MODEL = 'gpt-4o-mini-tts';

/**
 * Synthesizes the caller's utterance as raw PCM. Cached on disk by content hash so
 * reruns are deterministic in their *input audio* and cost nothing extra.
 */
export class Caller {
  constructor(
    private readonly client: OpenAI,
    private readonly persona: Persona,
    private readonly cacheDir: string,
  ) {}

  async speak(text: string): Promise<Buffer> {
    const key = createHash('sha256').update(JSON.stringify([TTS_MODEL, this.persona.voice, this.persona.instructions, text])).digest('hex').slice(0, 24);
    const file = path.join(this.cacheDir, `${key}.pcm`);
    try {
      return await fs.readFile(file);
    } catch {
      /* not cached yet */
    }
    const res = await this.client.audio.speech.create({
      model: TTS_MODEL,
      voice: this.persona.voice,
      input: text,
      instructions: this.persona.instructions,
      response_format: 'pcm',
    });
    const pcm = trimSilence(Buffer.from(await res.arrayBuffer()));
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(file, pcm);
    return pcm;
  }
}

/** Removes leading/trailing near-silence so the harness controls pause timing exactly. */
export function trimSilence(pcm: Buffer, threshold = 300): Buffer {
  const samples = Math.floor(pcm.length / 2);
  let start = 0;
  let end = samples - 1;
  while (start < samples && Math.abs(pcm.readInt16LE(start * 2)) < threshold) start++;
  while (end > start && Math.abs(pcm.readInt16LE(end * 2)) < threshold) end--;
  const pad = 2400; // keep 100 ms either side so consonants are not clipped
  return pcm.subarray(Math.max(0, start - pad) * 2, Math.min(samples, end + pad) * 2);
}

/** Word error rate between what the caller said and what ASR heard (lower is better). */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const r = norm(reference);
  const h = norm(hypothesis);
  if (!r.length) return h.length ? 1 : 0;
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array<number>(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++) {
    for (let j = 1; j <= h.length; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return Math.round((d[r.length]![h.length]! / r.length) * 100) / 100;
}
