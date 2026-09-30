/**
 * Request ids (ARCHITECTURE §2.1): plugin requests sign their X-Request-Id, so a valid UUID v4
 * is adopted only for requests that look signed (X-Signature present, no Cookie header; the
 * signature check then binds the id and claims it once). Web requests always get a
 * server-generated UUID, so browsers cannot choose the request_id stored in audit events.
 * Every response echoes the id.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { REQUEST_ID_HEADER, REQUEST_ID_HEADER_LOWER, REQUEST_ID_REGEX, SIGNING_HEADERS_LOWER } from '@scpsl-trust/shared';

/** Fastify genReqId: adopt a valid UUID v4 of a (claimed) signed plugin request, else generate one. */
export function genReqId(req: IncomingMessage): string {
  const supplied = req.headers[REQUEST_ID_HEADER_LOWER];
  const looksSigned = typeof req.headers[SIGNING_HEADERS_LOWER.SIGNATURE] === 'string' && req.headers.cookie === undefined;
  if (looksSigned && typeof supplied === 'string' && REQUEST_ID_REGEX.test(supplied)) return supplied;
  return randomUUID();
}

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
