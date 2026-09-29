/**
 * Request ids (ARCHITECTURE §2.1): a valid UUID v4 in X-Request-Id is adopted (plugin
 * requests sign it), otherwise a fresh UUID is generated. Every response echoes it.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { REQUEST_ID_HEADER, REQUEST_ID_HEADER_LOWER, REQUEST_ID_REGEX } from '@scpsl-trust/shared';

/** Fastify genReqId: adopt a valid client-supplied UUID v4, else generate one. */
export function genReqId(req: IncomingMessage): string {
  const supplied = req.headers[REQUEST_ID_HEADER_LOWER];
  if (typeof supplied === 'string' && REQUEST_ID_REGEX.test(supplied)) return supplied;
  return randomUUID();
}

export function registerRequestContext(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });
}
