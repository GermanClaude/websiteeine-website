/**
 * Web endpoints (§13 "Players"):
 *   GET /players           (player:view_staff) — search
 *   GET /players/{userId}  public view for everyone (incl. anonymous);
 *                          staff view for player:view_staff — never raw IPs/hashes.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  parseUserId,
  Permission,
  PlayerParamsSchema,
  PlayerSearchQuerySchema,
  PlayerSearchResponseSchema,
  PlayerViewResponseSchema,
} from '@scpsl-trust/shared';

import { requirePermission, userHasPermission } from '../../auth/rbac';
import type { Deps } from '../../container';
import { notFound } from '../../lib/errors';
import type { PlayersService } from './service';

export async function registerWebRoutes(app: FastifyInstance, _deps: Deps, service: PlayersService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/players',
    {
      schema: {
        tags: ['players'],
        summary: 'Search players',
        querystring: PlayerSearchQuerySchema,
        response: { 200: PlayerSearchResponseSchema },
      },
      preHandler: requirePermission(Permission.PLAYER_VIEW_STAFF),
    },
    async (request) => service.search(request.query),
  );

  r.get(
    '/players/:userId',
    {
      schema: {
        tags: ['players'],
        summary: 'Public or staff player view',
        params: PlayerParamsSchema,
        response: { 200: PlayerViewResponseSchema },
      },
      // No preHandler: the public view works without a session (and without CSRF).
    },
    async (request) => {
      const ref = parseUserId(request.params.userId);
      if (ref === null) throw notFound('Player not found');
      const user = request.user;
      // Staff view only for a full staff session (MFA enrollment satisfied).
      const staff =
        user !== null &&
        userHasPermission(user, Permission.PLAYER_VIEW_STAFF) &&
        request.session?.mfa_enrollment_required !== true;
      return service.view(ref, { staff, linkedPlayerId: user?.player_id ?? null });
    },
  );
}
