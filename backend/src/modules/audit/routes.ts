/**
 * GET /api/v1/admin/audit          (audit:view)   — filtered, paginated event list (§13)
 * GET /api/v1/admin/audit/verify   (audit:verify) — recompute the hash chain (§9.1)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  AuditListQuerySchema,
  AuditListResponseSchema,
  AuditVerifyResponseSchema,
  Permission,
  type AuditEventView,
} from '@scpsl-trust/shared';

import { requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import { paginatedResult } from '../../lib/pagination';
import { auditContext } from './actor';
import type { AuditEventWithLabel, AuditListFilters } from './service';

const VerifyQuerySchema = z.object({
  from_seq: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(10_000_000).optional(),
});

export function toAuditEventView(row: AuditEventWithLabel): AuditEventView {
  return {
    seq: row.seq,
    event_id: row.event_id,
    created_at: row.created_at.toISOString(),
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    actor_label: row.actor_label,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    server_id: row.server_id,
    case_id: row.case_id,
    metadata: row.metadata,
    request_id: row.request_id,
    prev_hash: row.prev_hash,
    hash: row.hash,
  };
}

export async function registerAuditRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/admin/audit',
    {
      schema: {
        tags: ['admin'],
        summary: 'List audit events',
        querystring: AuditListQuerySchema,
        response: { 200: AuditListResponseSchema },
      },
      preHandler: requirePermission(Permission.AUDIT_VIEW),
    },
    async (request) => {
      const query = request.query;
      const page = { page: query.page, page_size: query.page_size };
      const filters: AuditListFilters = {};
      if (query.actor_type !== undefined) filters.actor_type = query.actor_type;
      if (query.actor_id !== undefined) filters.actor_id = query.actor_id;
      if (query.action !== undefined) filters.action = query.action;
      if (query.target_type !== undefined) filters.target_type = query.target_type;
      if (query.target_id !== undefined) filters.target_id = query.target_id;
      if (query.from !== undefined) filters.from = new Date(query.from);
      if (query.to !== undefined) filters.to = new Date(query.to);
      if (query.server_id !== undefined) {
        const server = await deps.db.selectFrom('servers').select('id').where('server_id', '=', query.server_id).executeTakeFirst();
        if (server === undefined) return paginatedResult([], 0, page);
        filters.server_id = server.id;
      }
      if (query.case !== undefined) {
        const found = await deps.db.selectFrom('cases').select('id').where('case_number', '=', query.case).executeTakeFirst();
        if (found === undefined) return paginatedResult([], 0, page);
        filters.case_id = found.id;
      }
      const result = await deps.audit.list(filters, page);
      return { ...result, items: result.items.map(toAuditEventView) };
    },
  );

  r.get(
    '/admin/audit/verify',
    {
      schema: {
        tags: ['admin'],
        summary: 'Verify the audit hash chain',
        querystring: VerifyQuerySchema,
        response: { 200: AuditVerifyResponseSchema },
      },
      preHandler: requirePermission(Permission.AUDIT_VERIFY),
    },
    async (request) => {
      const options: { fromSeq?: number; limit?: number } = {};
      if (request.query.from_seq !== undefined) options.fromSeq = request.query.from_seq;
      if (request.query.limit !== undefined) options.limit = request.query.limit;
      const result = await deps.audit.verifyChain(options);
      const verifiedAt = deps.clock.now();
      await deps.audit.record(deps.db, {
        ...auditContext(request),
        action: 'AUDIT_CHAIN_VERIFIED',
        target_type: 'audit_log',
        target_id: null,
        metadata: {
          valid: result.valid,
          checked_events: result.checked,
          first_broken_seq: result.first_invalid_seq,
          failure: result.reason,
          from_seq: options.fromSeq ?? null,
        },
      });
      return {
        valid: result.valid,
        checked_events: result.checked,
        first_broken_seq: result.first_invalid_seq,
        failure: result.reason,
        last_seq: result.last_seq,
        last_hash: result.last_hash,
        verified_at: verifiedAt.toISOString(),
      };
    },
  );
}
