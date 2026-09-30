/**
 * Web routes of the users module (§13): GET /me, POST/DELETE /me/player-link,
 * GET /admin/users, PATCH /admin/users/{id}.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  AdminUserListQuerySchema,
  AdminUserListResponseSchema,
  AdminUserParamsSchema,
  AdminUserSchema,
  AdminUserUpdateRequestSchema,
  MeResponseSchema,
  OkResponseSchema,
  Permission,
  PlayerLinkCodeResponseSchema,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireAuth, requirePermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import { toOffset } from '../../lib/pagination';
import type { UsersService } from './service';

export async function registerUserRoutes(app: FastifyInstance, deps: Deps, service: UsersService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/me',
    {
      schema: { tags: ['me'], summary: 'Current user profile', response: { 200: MeResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.me(user, request.session!);
    },
  );

  r.post(
    '/me/player-link',
    {
      schema: { tags: ['me'], summary: 'Issue an in-game link code', response: { 200: PlayerLinkCodeResponseSchema } },
      preHandler: [requirePermission(Permission.PLAYER_LINK)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.createLinkCode(user);
    },
  );

  r.delete(
    '/me/player-link',
    {
      schema: { tags: ['me'], summary: 'Unlink the in-game identity', response: { 200: OkResponseSchema } },
      preHandler: [requirePermission(Permission.PLAYER_LINK)],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      await service.unlinkPlayer(request, user);
      return { ok: true as const };
    },
  );

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  r.get(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'List user accounts',
        querystring: AdminUserListQuerySchema,
        response: { 200: AdminUserListResponseSchema },
      },
      preHandler: [requirePermission(Permission.USER_VIEW)],
    },
    async (request) => {
      const query = request.query;
      const page = { page: query.page, page_size: query.page_size };
      const filters: { q?: string; role?: typeof query.role; status?: typeof query.status } = {};
      if (query.q !== undefined) filters.q = query.q;
      if (query.role !== undefined) filters.role = query.role;
      if (query.status !== undefined) filters.status = query.status;
      const { items, total } = await service.listUsers(filters, toOffset(page));
      return { items, total, page: page.page, page_size: page.page_size };
    },
  );

  r.patch(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Change a user role or status',
        params: AdminUserParamsSchema,
        body: AdminUserUpdateRequestSchema,
        response: { 200: AdminUserSchema },
      },
      preHandler: [requirePermission(Permission.USER_MANAGE)],
    },
    async (request) => {
      const actor = assertAuthenticated(request);
      return service.updateUser(request, actor, request.params.id, request.body);
    },
  );
}
