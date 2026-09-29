/**
 * Structured JSON logging (pino, ARCHITECTURE §15). Sensitive fields are redacted by path;
 * request bodies are never logged and client IPs only as network hash (LOG_CLIENT_IP).
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

import type { LogLevel } from '../config';

export type AppLogger = Logger;

/** Redacted paths (§15), at the top level and one/two levels deep. */
export const LOG_REDACT_PATHS: readonly string[] = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-signature"]',
  'req.headers["x-csrf-token"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-signature"]',
  'headers["x-csrf-token"]',
  ...['password', 'token', 'secret', 'private_key', 'mfa_token', 'ip', 'seed', 'signature'].flatMap((key) => [
    key,
    `*.${key}`,
    `*.*.${key}`,
  ]),
  // One level only, as in §15: our own log lines use `error_code` for error codes.
  '*.code',
]);

export interface LoggerSettings {
  level: LogLevel;
  pretty?: boolean;
  /** Extra base bindings (default: { service }). */
  base?: Record<string, unknown>;
}

export function createLogger(settings: LoggerSettings): AppLogger {
  const options: LoggerOptions = {
    level: settings.level,
    base: settings.base ?? { service: 'scpsl-trust-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    redact: { paths: [...LOG_REDACT_PATHS], censor: '[redacted]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: {
      err: pino.stdSerializers.err,
    },
  };
  if (settings.pretty === true) {
    options.transport = { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } };
  }
  return pino(options);
}

/** Logger that discards everything (tests, CLIs with --quiet). */
export function createSilentLogger(): AppLogger {
  return pino({ level: 'silent' });
}
