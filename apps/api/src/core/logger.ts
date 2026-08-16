/** Structured logging. Pretty in development, JSON in production. */

import pino from 'pino';
import { env, isDevelopment, isProduction } from '../config/env.js';

/**
 * Fields that must never reach the log stream. Pino replaces these with
 * `[Redacted]` wherever they appear at the listed paths.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.passwordHash',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.otp',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'authToken',
  'credentials',
  'twoFactorSecret',
  '*.password',
  '*.passwordHash',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[Redacted]' },
  base: isProduction ? { service: 'erp-api', env: env.NODE_ENV } : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      }
    : undefined,
});

/** Child logger tagged with a module name, e.g. `logger.child({ module })`. */
export function moduleLogger(name: string) {
  return logger.child({ module: name });
}

export type Logger = typeof logger;
