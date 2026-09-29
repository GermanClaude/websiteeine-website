/**
 * Derives the audit actor and request id from a request.
 */
import type { FastifyRequest } from 'fastify';

import type { AuditActor } from './service';

/**
 * Signed plugin request → server (`srv_…`); session → user (users.id);
 * otherwise an anonymous web user (`actor_id` null, e.g. failed login of an unknown email).
 */
export function actorFromRequest(request: FastifyRequest): AuditActor {
  if (request.authServer !== null) return { actor_type: 'server', actor_id: request.authServer.server_id };
  if (request.user !== null) return { actor_type: 'user', actor_id: request.user.id };
  return { actor_type: 'user', actor_id: null };
}

/** `{ actor, request_id }` to spread into AuditService.record input. */
export function auditContext(request: FastifyRequest): { actor: AuditActor; request_id: string } {
  return { actor: actorFromRequest(request), request_id: request.id };
}
