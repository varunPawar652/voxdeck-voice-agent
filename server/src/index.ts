import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config/env.ts';
import { createLogger } from './lib/logger.ts';
import { createRealtimeSessionService } from './services/realtimeSession.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n[voxdeck] ${err.message}\n  See .env.example for the expected variables.\n`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger(config.logLevel, config.nodeEnv !== 'production');
const sessions = createRealtimeSessionService(config, logger);
const app = createApp({ config, logger, sessions, staticDir: path.join(repoRoot, 'client/dist') });

if (!sessions.configured) {
  logger.warn('OPENAI_API_KEY is not set — the UI will load, but voice sessions will fail until you add it to .env');
}

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, clientOrigin: config.clientOrigin, model: config.realtimeModel, voice: config.realtimeVoice },
    `VoxDeck server listening on http://localhost:${config.port}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
