/**
 * CSRF protection (ARCHITECTURE §12.1).
 *
 * token = base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:" + session.id)); required in
 * X-CSRF-Token on every non-GET/HEAD/OPTIONS request authenticated by the session cookie.
 * Independently, a present Origin (or Referer) of any unsafe browser request must be an
 * allowed origin (WEB_ORIGIN or the API's own origin). Signed plugin requests (X-Signature
 * and no session cookie) are exempt: they carry no ambient credentials.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { CSRF_HEADER_LOWER, SESSION_COOKIE_NAME, SIGNING_HEADERS_LOWER } from '@scpsl-trust/shared';

import { hmacSha256, timingSafeEqualStr } from '../lib/crypto';
import { AppError } from '../lib/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfTokenFor(sessionId: string, sessionSecret: string): string {
  return hmacSha256(sessionSecret, `csrf:v1:${sessionId}`).toString('base64url');
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Whether the request looks like a signed plugin request without browser credentials. */
export function isSignedPluginRequest(request: FastifyRequest): boolean {
  return request.headers[SIGNING_HEADERS_LOWER.SIGNATURE] !== undefined && request.cookies[SESSION_COOKIE_NAME] === undefined;
}

export interface CsrfOptions {
  sessionSecret: string;
  /** Origins allowed in Origin/Referer (WEB_ORIGIN, PUBLIC_BASE_URL origin). */
  allowedOrigins: readonly string[];
}

/** Throws CSRF_TOKEN_INVALID when the request violates the CSRF rules. */
export function assertCsrf(request: FastifyRequest, options: CsrfOptions): void {
  if (SAFE_METHODS.has(request.method) || isSignedPluginRequest(request)) return;

  const origin = headerValue(request, 'origin');
  if (origin !== undefined) {
    if (!options.allowedOrigins.includes(originOf(origin) ?? '')) {
      throw new AppError('CSRF_TOKEN_INVALID', 'Request origin is not allowed');
    }
  } else {
    const referer = headerValue(request, 'referer');
    if (referer !== undefined && !options.allowedOrigins.includes(originOf(referer) ?? '')) {
      throw new AppError('CSRF_TOKEN_INVALID', 'Request referer is not allowed');
    }
  }

  if (request.session === null) return;
  const supplied = headerValue(request, CSRF_HEADER_LOWER);
  if (supplied === undefined || supplied.length === 0 || supplied.length > 128) {
    throw new AppError('CSRF_TOKEN_INVALID');
  }
  if (!timingSafeEqualStr(supplied, csrfTokenFor(request.session.id, options.sessionSecret))) {
    throw new AppError('CSRF_TOKEN_INVALID');
  }
}

/** Registers the CSRF check (preValidation, after the session hook). */
export function registerCsrfProtection(app: FastifyInstance, options: CsrfOptions): void {
  const frozen: CsrfOptions = { sessionSecret: options.sessionSecret, allowedOrigins: Object.freeze([...options.allowedOrigins]) };
  app.addHook('preValidation', async (request) => {
    assertCsrf(request, frozen);
  });
}
