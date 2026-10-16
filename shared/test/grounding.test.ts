import { describe, expect, it } from 'vitest';
import { DECK_NUMBERS, auditGrounding, extractNumbers } from '../src/grounding.ts';

describe('extractNumbers', () => {
  it('reads digits, percentages and decimals', () => {
    expect(extractNumbers('About 73% of 1,200 calls took 0.95 seconds').map((n) => n.value)).toEqual([73, 1200, 0.95]);
    expect(extractNumbers('73%')[0]).toMatchObject({ percent: true });
  });

  it('reads spoken numbers the way a voice transcript writes them', () => {
    const values = extractNumbers('roughly two hundred milliseconds, sixty percent, ninety-five, zero point nine five').map((n) => n.value);
    expect(values).toEqual([200, 60, 95, 0.95]);
    expect(extractNumbers('sixty percent')[0]).toMatchObject({ value: 60, percent: true });
  });

  it('recognises slide references', () => {
    expect(extractNumbers('see slide 4')[0]).toMatchObject({ value: 4, slideRef: true });
  });
});

describe('auditGrounding', () => {
  it('knows the numbers the deck actually states', () => {
    for (const n of [200, 2009, 2020, 95, 60, 0.95, 10]) expect(DECK_NUMBERS.has(n)).toBe(true);
  });

  it('accepts answers that only use figures from the deck', () => {
    expect(auditGrounding('Turn gaps are typically around 200 milliseconds, across ten languages (Stivers et al.).')).toEqual([]);
    expect(auditGrounding('Ten steps at 95 percent each gives roughly sixty percent end to end.')).toEqual([]);
    expect(auditGrounding("Let's look at slide 4. There are three ideas here.")).toEqual([]);
  });

  it('flags invented statistics', () => {
    const flags = auditGrounding('Around 73 percent of voice agents fail in production.');
    expect(flags).toEqual([{ kind: 'unsupported_number', text: '73 percent' }]);
    expect(auditGrounding('Latency should stay under 800 ms.')[0]?.kind).toBe('unsupported_number');
  });

  it('flags citation-style claims that name no deck source', () => {
    const flags = auditGrounding('A recent study from Stanford found agents fail often.');
    expect(flags.map((f) => f.kind)).toContain('unsourced_citation');
  });

  it('does not flag honest refusals or deck-sourced citations', () => {
    expect(auditGrounding("The deck doesn't include a study on that, so I won't guess a number.")).toEqual([]);
    expect(auditGrounding('According to OWASP, prompt injection is the top risk.')).toEqual([]);
  });
});
