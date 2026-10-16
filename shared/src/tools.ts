import { SLIDE_COUNT, slides } from './presentation.ts';

export const NAVIGATE_TOOL_NAME = 'navigate_to_slide';

/**
 * Realtime function-tool definition. Kept in sync with
 * `navigateToSlideArgsSchema` — a unit test asserts the two agree.
 */
export const navigateToSlideTool = {
  type: 'function',
  name: NAVIGATE_TOOL_NAME,
  description:
    'Show a different slide in the live presentation. Call this BEFORE explaining a topic whenever ' +
    'the best slide for the user\'s question is not the slide currently on screen. Do not call it ' +
    'for follow-ups about the current slide. The result contains the slide content to explain.\n' +
    slides.map((s) => `${s.number}: ${s.title} — ${s.keywords.slice(0, 8).join(', ')}`).join('\n'),
  parameters: {
    type: 'object',
    properties: {
      slide_number: {
        type: 'integer',
        minimum: 1,
        maximum: SLIDE_COUNT,
        description: `Slide to show, 1–${SLIDE_COUNT}.`,
      },
      reason: {
        type: 'string',
        description: 'One short sentence: why this slide answers the user\'s question.',
      },
      transition: {
        type: 'string',
        enum: ['immediate', 'next_sentence'],
        description:
          'immediate (default) switches now. next_sentence waits until the presenter finishes the sentence currently being spoken.',
      },
    },
    required: ['slide_number', 'reason', 'transition'],
    additionalProperties: false,
  },
} as const;

export type RealtimeFunctionTool = typeof navigateToSlideTool;
