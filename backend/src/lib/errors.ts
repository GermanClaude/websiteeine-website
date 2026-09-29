/**
 * Application errors (ARCHITECTURE §2.1, §14). Every expected failure is an AppError whose
 * code comes from the shared catalogue; the HTTP error handler turns it into
 * `{ error: { code, message, details?, request_id } }`.
 */
import { ERROR_DEFINITIONS, type ErrorCode, type ErrorDetails, type ValidationIssue } from '@scpsl-trust/shared';

export interface AppErrorOptions {
  /** Underlying error; logged server-side, never sent to clients. */
  cause?: unknown;
  /** Extra response headers (e.g. Retry-After). */
  headers?: Record<string, string>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: ErrorDetails | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(code: ErrorCode, message?: string, details?: ErrorDetails, options: AppErrorOptions = {}) {
    super(message ?? ERROR_DEFINITIONS[code].message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_DEFINITIONS[code].status;
    this.details = details;
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
  }

  /** Server errors (5xx) never expose a custom message to clients. */
  get isServerError(): boolean {
    return this.statusCode >= 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function notFound(message?: string): AppError {
  return new AppError('NOT_FOUND', message);
}

export function forbidden(message?: string): AppError {
  return new AppError('FORBIDDEN', message);
}

export function unauthenticated(message?: string): AppError {
  return new AppError('UNAUTHENTICATED', message);
}

export function conflict(message?: string, details?: ErrorDetails): AppError {
  return new AppError('CONFLICT', message, details);
}

export function invalidState(message?: string, details?: ErrorDetails): AppError {
  return new AppError('INVALID_STATE', message, details);
}

/** 400 VALIDATION_FAILED; `issues` become `details` ([{ path, message }]). */
export function validation(issues: readonly ValidationIssue[] | string, message?: string): AppError {
  const details: ValidationIssue[] =
    typeof issues === 'string' ? [{ path: '', message: issues }] : issues.map((issue) => ({ ...issue }));
  return new AppError('VALIDATION_FAILED', message, details);
}

export function rateLimited(retryAfterSeconds?: number): AppError {
  if (retryAfterSeconds === undefined) return new AppError('RATE_LIMITED');
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return new AppError('RATE_LIMITED', undefined, { retry_after_seconds: seconds }, {
    headers: { 'retry-after': String(seconds) },
  });
}
