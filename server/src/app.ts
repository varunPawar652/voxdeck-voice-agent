import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { ApiError } from '@voxdeck/shared';
import type { AppConfig } from './config/env.ts';
import { HttpError } from './lib/httpError.ts';
import type { Logger } from './lib/logger.ts';
import { healthRouter } from './routes/health.ts';
import { sessionRouter } from './routes/session.ts';
import type { RealtimeSessionService } from './services/realtimeSession.ts';

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  sessions: RealtimeSessionService;
  /** Serve the built client from this directory (production single-port mode). */
  staticDir?: string;
}

export function createApp({ config, logger, sessions, staticDir }: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(
    helmet({
      // The SPA talks to api.openai.com directly for WebRTC SDP; allow exactly that.
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'connect-src': ["'self'", 'https://api.openai.com'],
          'media-src': ["'self'", 'blob:'],
          'img-src': ["'self'", 'data:'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // Only the configured frontend origin may call the API from a browser.
  // Exact-match allowlist: other origins get no CORS headers at all (same-origin requests have no Origin).
  app.use(
    '/api',
    cors({
      origin: (origin, done) => done(null, origin === undefined || origin === config.clientOrigin),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );
  app.use('/api', express.json({ limit: '4kb' }));

  app.use('/api', healthRouter(config, sessions));
  app.use('/api', sessionRouter(sessions));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown API route.')));

  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    let httpError: HttpError;
    if (err instanceof HttpError) {
      httpError = err;
    } else if (err?.type === 'entity.parse.failed') {
      httpError = new HttpError(400, 'invalid_json', 'Request body must be valid JSON.');
    } else if (err?.type === 'entity.too.large') {
      httpError = new HttpError(413, 'payload_too_large', 'Request body is too large.');
    } else {
      req.log?.error({ err }, 'Unhandled error');
      httpError = new HttpError(500, 'internal_error', 'Something went wrong on the server.');
    }
    const body: ApiError = { error: { code: httpError.code, message: httpError.message } };
    res.status(httpError.status).json(body);
  };
  app.use(errorHandler);

  return app;
}
