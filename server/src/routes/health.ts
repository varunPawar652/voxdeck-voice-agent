import { Router } from 'express';
import { SLIDE_COUNT } from '@voxdeck/shared';
import type { AppConfig } from '../config/env.ts';
import type { RealtimeSessionService } from '../services/realtimeSession.ts';

export function healthRouter(config: AppConfig, sessions: RealtimeSessionService): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      openaiConfigured: sessions.configured,
      model: config.realtimeModel,
      voice: config.realtimeVoice,
      slides: SLIDE_COUNT,
    });
  });
  return router;
}
