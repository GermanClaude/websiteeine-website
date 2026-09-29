/**
 * JSON body parser that keeps the exact body bytes in request.rawBody (needed to verify
 * signatures over the raw body, §5.4 step 5 — never re-serialize before hashing).
 *
 * - empty body → request.body undefined (allowed; schemas decide whether a body is required)
 * - invalid JSON → 400 VALIDATION_FAILED
 * - prototype-poisoning keys (`__proto__`, `constructor.prototype`) → 400 VALIDATION_FAILED
 * - Fastify's default text/plain parser is removed: the API only accepts JSON (and multipart
 *   where a module registers it), so no body can bypass rawBody capture.
 */
import type { FastifyInstance } from 'fastify';

import { AppError } from '../lib/errors';

function reviver(this: unknown, key: string, value: unknown): unknown {
  if (key === '__proto__') throw new SyntaxError('Forbidden key "__proto__"');
  if (key === 'constructor' && typeof value === 'object' && value !== null && Object.hasOwn(value, 'prototype')) {
    throw new SyntaxError('Forbidden key "constructor.prototype"');
  }
  return value;
}

/** Parses UTF-8 JSON bytes; throws AppError(VALIDATION_FAILED) on malformed input. */
export function parseJsonBody(body: Buffer): unknown {
  if (body.length === 0) return undefined;
  const text = body.toString('utf8');
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text, reviver);
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Request body is not valid JSON');
  }
}

export function registerRawJsonParser(app: FastifyInstance): void {
  app.removeContentTypeParser(['application/json', 'text/plain']);
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    request.rawBody = buffer;
    try {
      done(null, parseJsonBody(buffer));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
}
