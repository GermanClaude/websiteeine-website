/**
 * Web routes of the whitelist module (§13 "Whitelist"). Deciding is authorized by
 * server-team membership (owner/admin/moderator) or whitelist:decide_any — checked
 * per request in the service, because the server is derived from the request row.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  Permission,
  WhitelistDecisionRequestSchema,
  WhitelistRequestCreateRequestSchema,
  WhitelistRequestListQuerySchema,
  WhitelistRequestListResponseSchema,
  WhitelistRequestParamsSchema,
  WhitelistRequestViewSchema,
  WhitelistRevokeRequestSchema,
} from '@scpsl-trust/shared';

import { assertAuthenticated, assertMfaEnrollment, requireAuth, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { WhitelistService } from './service';

export async function registerWhitelistRoutes(
  app: FastifyInstance,
  _deps: Deps,
  service: WhitelistService,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/whitelist-requests',
    {
      schema: {
        tags: ['whitelist'],
        summary: 'Request a VPN / account-age whitelist for a server',
        body: WhitelistRequestCreateRequestSchema,
        response: { 201: WhitelistRequestViewSchema },
      },
      preHandler: [requirePermission(Permission.WHITELIST_REQUEST)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const view = await service.create(request, user, request.body);
      return reply.code(201).send(view);
    },
  );

  r.get(
    '/whitelist-requests',
    {
      schema: {
        tags: ['whitelist'],
        summary: 'List whitelist requests (own; server members: their servers; decide_any: all)',
        querystring: WhitelistRequestListQuerySchema,
        response: { 200: WhitelistRequestListResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const { items, total } = await service.list(user, request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.get(
    '/whitelist-requests/:id',
    {
      schema: {
        tags: ['whitelist'],
        summary: 'Whitelist request detail',
        params: WhitelistRequestParamsSchema,
        response: { 200: WhitelistRequestViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.get(user, request.params.id);
    },
  );

  r.post(
    '/whitelist-requests/:id/decision',
    {
      schema: {
        tags: ['whitelist'],
        summary: 'Approve or reject a pending whitelist request',
        params: WhitelistRequestParamsSchema,
        body: WhitelistDecisionRequestSchema,
        response: { 200: WhitelistRequestViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      assertMfaEnrollment(request.session);
      return service.decide(request, user, request.params.id, request.body);
    },
  );

  r.post(
    '/whitelist-requests/:id/revoke',
    {
      schema: {
        tags: ['whitelist'],
        summary: 'Revoke an approved whitelist request (and its bypass)',
        params: WhitelistRequestParamsSchema,
        body: WhitelistRevokeRequestSchema,
        response: { 200: WhitelistRequestViewSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      assertMfaEnrollment(request.session);
      return service.revoke(request, user, request.params.id, request.body.reason);
    },
  );
}
