import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createSessionRequestSchema, formatZodError } from '@voxdeck/shared';
import { HttpError } from '../lib/httpError.ts';
import type { RealtimeSessionService } from '../services/realtimeSession.ts';

export function sessionRouter(sessions: RealtimeSessionService): Router {
  const router = Router();

  // Every secret opens a billable voice session, so cap how fast one client can mint them.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 12,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new HttpError(429, 'rate_limited', 'Too many session requests. Wait a minute and try again.')),
  });

  router.post('/realtime/session', limiter, async (req, res) => {
    const parsed = createSessionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new HttpError(400, 'invalid_request', formatZodError(parsed.error));
    }
    const session = await sessions.createSession({ currentSlide: parsed.data.currentSlide ?? 1 });
    // Ephemeral credentials must never be cached by the browser or a proxy.
    res.setHeader('Cache-Control', 'no-store');
    res.json(session);
  });

  return router;
}
