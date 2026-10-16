import { slides } from './presentation.ts';

/**
 * A deliberately simple, deterministic grounding audit for assistant answers.
 *
 * It flags (1) numeric claims that appear nowhere in the deck and (2) citation-style
 * phrasing ("a study found…") that names none of the deck's sources. It is a heuristic
 * that surfaces answers for review in diagnostics and evals — it does not prove an
 * answer correct, and it never blocks speech.
 */

export interface GroundingFlag {
  kind: 'unsupported_number' | 'unsourced_citation';
  /** The offending fragment, e.g. "73 percent" or the citing sentence. */
  text: string;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

interface NumberMention {
  value: number;
  raw: string;
  percent: boolean;
  decimal: boolean;
  /** Preceded by "slide", e.g. "slide 4" — a deck reference, not a claim. */
  slideRef: boolean;
}

/** Finds numbers written as digits ("73%", "0.95") or words ("seventy-three percent"). */
export function extractNumbers(text: string): NumberMention[] {
  // Punctuation is kept as its own token so "ninety-five, zero point nine five" stays two numbers.
  const tokens = text.toLowerCase().replace(/[–—-]/g, ' ').match(/\d+(?:[.,]\d+)*%?|[a-z]+|%|[,;:!?]|\.(?!\d)/g) ?? [];
  const out: NumberMention[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const prev = tokens[i - 1];
    const startsDigit = /^\d/.test(tok);
    const startsWord = tok in UNITS || tok in TENS;
    if (!startsDigit && !startsWord) continue;

    let value: number;
    let raw: string;
    let decimal = false;
    let j = i;

    if (startsDigit) {
      const clean = tok.replace(/%$/, '').replace(/,(?=\d{3}\b)/g, '');
      decimal = clean.includes('.');
      value = Number(clean);
      raw = tok;
    } else {
      // Spoken number: e.g. "two hundred", "ninety five", "zero point nine five".
      let total = 0;
      let current = 0;
      let last: 'unit' | 'tens' | 'scale' | null = null;
      const words: string[] = [];
      while (j < tokens.length) {
        const w = tokens[j]!;
        const isUnit = w in UNITS;
        const isTens = w in TENS;
        // "five zero" or "twenty thirty" are two numbers; "twenty five" is one.
        if (isUnit && (last === 'unit' || (last === 'tens' && !(UNITS[w]! > 0 && UNITS[w]! < 10)))) break;
        if (isTens && (last === 'unit' || last === 'tens')) break;

        if (isUnit) {
          current += UNITS[w]!;
          last = 'unit';
        } else if (isTens) {
          current += TENS[w]!;
          last = 'tens';
        } else if (w === 'hundred') {
          current = (current || 1) * 100;
          last = 'scale';
        } else if (w in SCALES) {
          total += (current || 1) * SCALES[w]!;
          current = 0;
          last = 'scale';
        } else if (w === 'and' && last === 'scale' && tokens[j + 1] && (tokens[j + 1]! in UNITS || tokens[j + 1]! in TENS)) {
          /* "one hundred and five" */
        } else break;
        words.push(w);
        j++;
      }
      value = total + current;
      if (tokens[j] === 'point') {
        let digits = '';
        let k = j + 1;
        while (k < tokens.length && tokens[k]! in UNITS && UNITS[tokens[k]!]! < 10) digits += String(UNITS[tokens[k++]!]);
        if (digits) {
          value = Number(`${value}.${digits}`);
          decimal = true;
          words.push('point', ...digits.split(''));
          j = k;
        }
      }
      raw = words.join(' ');
      i = j - 1;
    }

    const next = tokens[startsDigit ? i + 1 : j];
    const percent = tok.endsWith('%') || next === '%' || next === 'percent';
    if (Number.isFinite(value)) out.push({ value, raw: percent && !raw.endsWith('%') ? `${raw} percent` : raw, percent, decimal, slideRef: prev === 'slide' || prev === 'slides' });
  }
  return out;
}

const deckText = slides
  .map((s) =>
    [s.title, s.summary, s.speakerNotes, s.example.text, JSON.stringify(s.keyConcepts), JSON.stringify(s.diagram), s.sources.map((x) => x.label).join(' ')].join(' '),
  )
  .join(' ');

/** Every number the deck itself states — anything else is unsupported. */
export const DECK_NUMBERS: ReadonlySet<number> = new Set([
  ...extractNumbers(deckText).map((n) => n.value),
  ...slides.map((s) => s.number),
]);

const SOURCE_ANCHORS = ['stivers', 'pnas', 'lewis', 'owasp', 'openai', 'synthio', 'ten languages', '10 languages'];
const CITATION_CUE = /\b(according to|a (?:recent |new |\d{4} )?(?:study|survey|report|paper|analysis)|studies (?:show|found|suggest)|research (?:shows|found|suggests)|et al\b|published (?:in|by)|data from)\b/i;
const NEGATION = /\b(no|not|don't|doesn't|isn't|aren't|without|can't|cannot|never|n't)\b/i;

function isMaterial(n: NumberMention): boolean {
  if (n.slideRef) return false;
  return n.percent || n.decimal || n.value >= 11;
}

export function auditGrounding(answer: string): GroundingFlag[] {
  const flags: GroundingFlag[] = [];
  const seen = new Set<string>();

  for (const n of extractNumbers(answer)) {
    if (!isMaterial(n) || DECK_NUMBERS.has(n.value) || seen.has(n.raw)) continue;
    seen.add(n.raw);
    flags.push({ kind: 'unsupported_number', text: n.raw });
  }

  for (const sentence of answer.split(/(?<=[.!?])\s+/)) {
    const lower = sentence.toLowerCase();
    if (!CITATION_CUE.test(sentence) || NEGATION.test(sentence)) continue;
    if (SOURCE_ANCHORS.some((a) => lower.includes(a))) continue;
    flags.push({ kind: 'unsourced_citation', text: sentence.trim().slice(0, 160) });
  }
  return flags;
}
