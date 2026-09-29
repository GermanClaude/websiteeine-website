/**
 * Audit module: AuditService (hash-chained, append-only log) and the admin audit routes.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerAuditRoutes } from './routes';

export { actorFromRequest, auditContext } from './actor';
export { AUDIT_METADATA_LIMITS, isSensitiveKey, sanitizeAuditMetadata } from './sanitize';
export {
  actorLabel,
  AuditService,
  computeAuditHash,
  SYSTEM_ACTOR,
  type AuditActor,
  type AuditChainVerification,
  type AuditEventWithLabel,
  type AuditListFilters,
  type AuditRecordInput,
} from './service';
export { toAuditEventView } from './routes';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerAuditRoutes(app, deps);
}
