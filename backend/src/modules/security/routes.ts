/**
 * Security monitor (§13 "Admin"):
 *   GET  /api/v1/admin/security/events            (security:view)
 *   GET  /api/v1/admin/security/blocks            (security:view)
 *   POST /api/v1/admin/security/blocks/{id}/clear (security:manage; audited)
 *   GET  /api/v1/admin/security/summary           (security:view)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  Permission,
  SecurityBlockClearRequestSchema,
  SecurityBlockClearResponseSchema,
  SecurityBlockIdParamsSchema,
  SecurityBlockListResponseSchema,
  SecurityEventListQuerySchema,
  SecurityEventListResponseSchema,
  SecuritySummaryResponseSchema,
  type SecurityBlockView,
  type SecurityEventView,
  type SecuritySummaryResponse,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import { notFound } from '../../lib/errors';
import { paginatedResult } from '../../lib/pagination';
import { auditContext } from '../audit/actor';
import type { ActiveBlockRecord, SecurityEventRecord } from './repository';
import type { SecurityService } from './service';

function toEventView(row: SecurityEventRecord): SecurityEventView {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    kind: row.kind,
    severity: row.severity,
    source_type: row.source_type,
    source_ref: row.source_ref,
    score: row.score,
    action_taken: row.action_taken,
    endpoint: row.endpoint,
    request_id: row.request_id,
    metadata: row.metadata,
    expires_at: row.expires_at?.toISOString() ?? null,
  };
}

function toBlockView(block: ActiveBlockRecord & { ttl_seconds: number }): SecurityBlockView {
  return {
    id: `${block.source_type}.${block.source_ref}`,
    source_type: block.source_type,
    source_ref: block.source_ref,
    score: block.score,
    strikes: block.strikes,
    expires_at: block.expires_at.toISOString(),
    ttl_seconds: block.ttl_seconds,
  };
}

export async function registerSecurityRoutes(app: FastifyInstance, deps: Deps, service: SecurityService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/admin/security/events',
    {
      schema: {
        tags: ['admin'],
        summary: 'List intrusion-detection / anomaly events',
        querystring: SecurityEventListQuerySchema,
        response: { 200: SecurityEventListResponseSchema },
      },
      preHandler: requirePermission(Permission.SECURITY_VIEW),
    },
    async (request) => {
      const q = request.query;
      const page = { page: q.page, page_size: q.page_size };
      const filters = {
        ...(q.kind !== undefined ? { kind: q.kind } : {}),
        ...(q.severity !== undefined ? { severity: q.severity } : {}),
        ...(q.source_type !== undefined ? { source_type: q.source_type } : {}),
        ...(q.source_ref !== undefined ? { source_ref: q.source_ref } : {}),
        ...(q.from !== undefined ? { from: new Date(q.from) } : {}),
        ...(q.to !== undefined ? { to: new Date(q.to) } : {}),
      };
      const { items, total } = await service.listEvents(filters, page);
      return paginatedResult(items.map(toEventView), total, page);
    },
  );

  r.get(
    '/admin/security/blocks',
    {
      schema: {
        tags: ['admin'],
        summary: 'List active transient source blocks',
        response: { 200: SecurityBlockListResponseSchema },
      },
      preHandler: requirePermission(Permission.SECURITY_VIEW),
    },
    async () => {
      const blocks = await service.listActiveBlocks();
      return { items: blocks.map(toBlockView) };
    },
  );

  r.post(
    '/admin/security/blocks/:id/clear',
    {
      schema: {
        tags: ['admin'],
        summary: 'Clear a transient source block',
        params: SecurityBlockIdParamsSchema,
        body: SecurityBlockClearRequestSchema,
        response: { 200: SecurityBlockClearResponseSchema },
      },
      preHandler: requirePermission(Permission.SECURITY_MANAGE),
    },
    async (request) => {
      assertAuthenticated(request);
      const source = service.parseBlockId(request.params.id);
      if (source === null || source.ref === null) throw notFound('Block not found');
      const { cleared } = await service.clearBlock(source, auditContext(request), request.body.reason);
      return { ok: true as const, cleared, source_type: source.type, source_ref: source.ref };
    },
  );

  r.get(
    '/admin/security/summary',
    {
      schema: {
        tags: ['admin'],
        summary: 'Security monitor summary (last 24h)',
        response: { 200: SecuritySummaryResponseSchema },
      },
      preHandler: requirePermission(Permission.SECURITY_VIEW),
    },
    async (): Promise<SecuritySummaryResponse> => {
      const summary = await service.summary();
      return {
        events_last_24h: summary.eventsBySeverity,
        total_events_last_24h: summary.totalEvents,
        anomalies_last_24h: summary.anomalies,
        active_blocks: summary.activeBlocks,
        top_sources: summary.topSources,
        detection_enabled: service.detectionEnabled,
        anomaly_enabled: service.anomalyEnabled,
        generated_at: deps.clock.now().toISOString(),
      };
    },
  );
}
