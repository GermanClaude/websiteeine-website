/**
 * Web routes of the Overwatch module: proof verification (§10.3, optional auth) and the
 * session views (§13 "Overwatch") — never the secret.
 *
 * GET /evidence/proof is registered here (not in the evidence module); as a static route it
 * wins over the parametric GET /evidence/:id.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  OverwatchSessionListQuerySchema,
  OverwatchSessionListResponseSchema,
  OverwatchSessionParamsSchema,
  OverwatchSessionViewSchema,
  Permission,
  ProofQuerySchema,
  ProofResponseSchema,
} from '@scpsl-trust/shared';

import { requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { OverwatchService } from './service';

export async function registerOverwatchRoutes(app: FastifyInstance, deps: Deps, service: OverwatchService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/evidence/proof',
    {
      schema: {
        tags: ['overwatch'],
        summary: 'Verify an Overwatch proof code (optional auth; strict rate limit)',
        querystring: ProofQuerySchema,
        response: { 200: ProofResponseSchema },
      },
      config: { rateLimit: deps.rateLimits.proof },
    },
    async (request) => service.verifyProof(request, request.user, request.query),
  );

  r.get(
    '/overwatch/sessions',
    {
      schema: {
        tags: ['overwatch'],
        summary: 'List Overwatch sessions (overwatch:view)',
        querystring: OverwatchSessionListQuerySchema,
        response: { 200: OverwatchSessionListResponseSchema },
      },
      preHandler: [requirePermission(Permission.OVERWATCH_VIEW)],
    },
    async (request) => {
      const { items, total } = await service.listSessions(request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.get(
    '/overwatch/sessions/:id',
    {
      schema: {
        tags: ['overwatch'],
        summary: 'Overwatch session detail (overwatch:view; no secret, ever)',
        params: OverwatchSessionParamsSchema,
        response: { 200: OverwatchSessionViewSchema },
      },
      preHandler: [requirePermission(Permission.OVERWATCH_VIEW)],
    },
    async (request) => service.getSession(request.params.id),
  );
}
