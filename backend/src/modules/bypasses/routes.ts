/**
 * Web routes of the bypasses module (§13 "Servers"/"Admin"):
 *   GET/POST /servers/{id}/bypasses   — owner/admin membership (list also moderator) or server:manage_any
 *   POST /bypasses/{id}/revoke        — scoped per bypass (service-level check)
 *   GET/POST /admin/bypasses          — bypass:manage_global
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  BypassCreateRequestSchema,
  BypassListQuerySchema,
  BypassListResponseSchema,
  BypassParamsSchema,
  BypassRevokeRequestSchema,
  BypassViewSchema,
  OkResponseSchema,
  Permission,
  ServerParamsSchema,
} from '@scpsl-trust/shared';

import { assertAuthenticated, assertMfaEnrollment, requireAuth, requirePermission, requireServerRole } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { BypassService } from './service';

export async function registerBypassRoutes(app: FastifyInstance, deps: Deps, service: BypassService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/servers/:id/bypasses',
    {
      schema: {
        tags: ['bypasses'],
        summary: "List a server's bypasses",
        params: ServerParamsSchema,
        querystring: BypassListQuerySchema,
        response: { 200: BypassListResponseSchema },
      },
      // Members (owner/admin/moderator) may see the list; server:manage_any overrides.
      preHandler: [
        requireServerRole(deps.db, {
          roles: ['owner', 'admin', 'moderator'],
          allowPermission: Permission.SERVER_MANAGE_ANY,
        }),
      ],
    },
    async (request) => {
      const access = request.serverAccess;
      if (access === null) throw new Error('serverAccess missing');
      const { items, total } = await service.listServerBypasses(access.server.id, request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.post(
    '/servers/:id/bypasses',
    {
      schema: {
        tags: ['bypasses'],
        summary: 'Grant a server-scoped bypass',
        params: ServerParamsSchema,
        body: BypassCreateRequestSchema,
        response: { 201: BypassViewSchema },
      },
      preHandler: [requireServerRole(deps.db, { action: 'bypass' })],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const access = request.serverAccess;
      if (access === null) throw new Error('serverAccess missing');
      const view = await service.createServerBypass(request, user, access.server.id, request.body);
      return reply.code(201).send(view);
    },
  );

  r.post(
    '/bypasses/:id/revoke',
    {
      schema: {
        tags: ['bypasses'],
        summary: 'Revoke a bypass',
        params: BypassParamsSchema,
        body: BypassRevokeRequestSchema,
        response: { 200: OkResponseSchema },
      },
      // Authorization depends on the bypass scope; checked in the service.
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      assertMfaEnrollment(request.session);
      await service.revoke(request, user, request.params.id, request.body.reason);
      return { ok: true as const };
    },
  );

  r.get(
    '/admin/bypasses',
    {
      schema: {
        tags: ['admin'],
        summary: 'List global bypasses',
        querystring: BypassListQuerySchema,
        response: { 200: BypassListResponseSchema },
      },
      preHandler: [requirePermission(Permission.BYPASS_MANAGE_GLOBAL)],
    },
    async (request) => {
      const { items, total } = await service.listGlobalBypasses(request.query);
      return { items, total, page: request.query.page, page_size: request.query.page_size };
    },
  );

  r.post(
    '/admin/bypasses',
    {
      schema: {
        tags: ['admin'],
        summary: 'Grant a global bypass',
        body: BypassCreateRequestSchema,
        response: { 201: BypassViewSchema },
      },
      preHandler: [requirePermission(Permission.BYPASS_MANAGE_GLOBAL)],
    },
    async (request, reply) => {
      const user = assertAuthenticated(request);
      const view = await service.createGlobalBypass(request, user, request.body);
      return reply.code(201).send(view);
    },
  );
}
