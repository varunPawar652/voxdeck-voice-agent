import { pino, type Logger } from 'pino';

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    base: { service: 'voxdeck-server' },
    // Defense in depth: even if a header or secret object is logged by mistake, it is masked.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        '*.apiKey',
        '*.clientSecret',
        '*.value',
        'clientSecret',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
  });
}

export type { Logger };
