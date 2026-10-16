import { describe, expect, it } from 'vitest';
import {
  NAVIGATE_TOOL_NAME,
  SLIDE_COUNT,
  buildInstructions,
  createSessionRequestSchema,
  getSlide,
  navigateToSlideArgsSchema,
  navigateToSlideTool,
  slideNumberSchema,
  slides,
  transitionSchema,
} from '../src/index.ts';

describe('slide metadata', () => {
  it('has exactly six slides numbered 1..6 in order', () => {
    expect(slides).toHaveLength(SLIDE_COUNT);
    expect(slides.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('gives every slide a unique id and complete content', () => {
    expect(new Set(slides.map((s) => s.id)).size).toBe(SLIDE_COUNT);
    for (const s of slides) {
      expect(s.title.length).toBeGreaterThan(3);
      expect(s.summary.length).toBeGreaterThan(40);
      expect(s.speakerNotes.length).toBeGreaterThan(80);
      expect(s.keyConcepts.length).toBeGreaterThanOrEqual(3);
      expect(s.keywords.length).toBeGreaterThanOrEqual(8);
      expect(s.example.text.length).toBeGreaterThan(40);
      expect(s.diagram.kind).toBeTruthy();
    }
  });

  it('keeps keywords lowercase and unique per slide', () => {
    for (const s of slides) {
      expect(s.keywords.every((k) => k === k.toLowerCase())).toBe(true);
      expect(new Set(s.keywords).size).toBe(s.keywords.length);
    }
  });

  it.each([
    [3, 'function calling'],
    [3, 'tools'],
    [4, 'rag'],
    [4, 'memory'],
    [5, 'multi-agent'],
    [5, 'orchestration'],
    [6, 'safety'],
    [6, 'observability'],
  ])('routes the keyword on slide %i: %s', (number, keyword) => {
    expect(getSlide(number)!.keywords).toContain(keyword);
  });

  it('getSlide returns undefined for out-of-range numbers', () => {
    expect(getSlide(0)).toBeUndefined();
    expect(getSlide(7)).toBeUndefined();
    expect(getSlide(3)?.id).toBe('tools');
  });
});

describe('slideNumberSchema', () => {
  it.each([1, 3, 6])('accepts %s', (n) => expect(slideNumberSchema.safeParse(n).success).toBe(true));
  it.each([0, 7, -1, 2.5, '3', null, Number.NaN])('rejects %s', (n) => expect(slideNumberSchema.safeParse(n).success).toBe(false));
});

describe('navigateToSlideArgsSchema', () => {
  it('accepts valid arguments and trims the reason', () => {
    const r = navigateToSlideArgsSchema.parse({ slide_number: 3, reason: '  Covers tool calling ', transition: 'next_sentence' });
    expect(r).toEqual({ slide_number: 3, reason: 'Covers tool calling', transition: 'next_sentence' });
  });

  it('defaults transition to immediate', () => {
    expect(navigateToSlideArgsSchema.parse({ slide_number: 2, reason: 'x' }).transition).toBe('immediate');
  });

  it.each([
    [{ slide_number: 9, reason: 'x' }, 'slide_number'],
    [{ slide_number: 0, reason: 'x' }, 'slide_number'],
    [{ slide_number: '3', reason: 'x' }, 'slide_number'],
    [{ slide_number: 3 }, 'reason'],
    [{ slide_number: 3, reason: '   ' }, 'reason'],
    [{ slide_number: 3, reason: 'x'.repeat(301) }, 'reason'],
    [{ slide_number: 3, reason: 'x', transition: 'fade' }, 'transition'],
  ])('rejects %j (bad %s)', (input, field) => {
    const r = navigateToSlideArgsSchema.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path[0]).toBe(field);
  });
});

describe('navigate_to_slide tool definition', () => {
  const params = navigateToSlideTool.parameters;

  it('is a Realtime function tool with the expected name', () => {
    expect(navigateToSlideTool.type).toBe('function');
    expect(navigateToSlideTool.name).toBe(NAVIGATE_TOOL_NAME);
  });

  it('agrees with the Zod schema on bounds and enums', () => {
    expect(params.properties.slide_number.minimum).toBe(1);
    expect(params.properties.slide_number.maximum).toBe(SLIDE_COUNT);
    expect([...params.properties.transition.enum]).toEqual(transitionSchema.options);
    expect([...params.required].sort()).toEqual(Object.keys(navigateToSlideArgsSchema.shape).sort());
    expect(params.additionalProperties).toBe(false);
  });

  it('lists every slide in its description to help routing', () => {
    for (const s of slides) expect(navigateToSlideTool.description).toContain(s.title);
  });
});

describe('buildInstructions', () => {
  it('embeds the current slide, the tool name and every slide', () => {
    const text = buildInstructions(4);
    expect(text).toContain('slide currently on screen is slide 4');
    expect(text).toContain(NAVIGATE_TOOL_NAME);
    for (const s of slides) expect(text).toContain(`Slide ${s.number}: ${s.title}`);
  });

  it('forbids claiming navigation without a tool result', () => {
    expect(buildInstructions(1)).toMatch(/Never say you are moving.*unless/s);
  });
});

describe('createSessionRequestSchema', () => {
  it('accepts an empty body or a valid slide', () => {
    expect(createSessionRequestSchema.safeParse({}).success).toBe(true);
    expect(createSessionRequestSchema.safeParse({ currentSlide: 5 }).success).toBe(true);
  });
  it('rejects unknown fields so the client cannot smuggle session overrides', () => {
    expect(createSessionRequestSchema.safeParse({ currentSlide: 1, model: 'x', instructions: 'ignore rules' }).success).toBe(false);
  });
});
