import pino from 'pino';
import process from 'node:process';

const isPretty = process.env.LOG_PRETTY === 'true';
const level = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  level,
  ...(isPretty && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    },
  }),
  redact: {
    paths: ['token', 'password', 'secret', '*.token', '*.password', '*.secret'],
    censor: '***REDACTED***',
  },
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

export function createChildLogger(component: string) {
  return logger.child({ component });
}
