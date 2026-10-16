import { z } from 'zod';
import { SLIDE_COUNT } from './presentation.ts';

export const slideNumberSchema = z
  .number({ error: 'slide_number must be a number' })
  .int('slide_number must be an integer')
  .min(1, `slide_number must be between 1 and ${SLIDE_COUNT}`)
  .max(SLIDE_COUNT, `slide_number must be between 1 and ${SLIDE_COUNT}`);

export const transitionSchema = z.enum(['immediate', 'next_sentence']);
export type Transition = z.infer<typeof transitionSchema>;

/** Arguments the model must supply when it calls `navigate_to_slide`. */
export const navigateToSlideArgsSchema = z.object({
  slide_number: slideNumberSchema,
  reason: z.string().trim().min(1, 'reason is required').max(300, 'reason is too long'),
  transition: transitionSchema.default('immediate'),
});
export type NavigateToSlideArgs = z.infer<typeof navigateToSlideArgsSchema>;

/** Body of `POST /api/realtime/session`. */
export const createSessionRequestSchema = z
  .object({
    currentSlide: slideNumberSchema.optional(),
  })
  .strict();
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

/** What the browser receives — a short-lived secret, never the real API key. */
export const createSessionResponseSchema = z.object({
  clientSecret: z.string().min(1),
  expiresAt: z.number().int(),
  model: z.string(),
  voice: z.string(),
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Flattens a ZodError into one readable line suitable for a tool result. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}
