/**
 * Signed plugin routes of the users module (§6.6): POST /player/link.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { PlayerLinkRequestSchema, PlayerLinkResponseSchema } from '@scpsl-trust/shared';

import { assertBodyServerId } from '../../auth/server-auth';
import type { Deps } from '../../container';
import type { UsersService } from './service';

export async function registerUserPluginRoutes(app: FastifyInstance, deps: Deps, service: UsersService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/player/link',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Link an in-game identity to a web account via a link code',
        body: PlayerLinkRequestSchema,
        response: { 200: PlayerLinkResponseSchema },
      },
      preHandler: [app.requireServerSignature],
      config: { rateLimit: deps.rateLimits.plugin },
    },
    async (request) => {
      const server = request.authServer!;
      assertBodyServerId(request.body, server);
      return service.linkPlayer(request, server, { player: request.body.player, code: request.body.code });
    },
  );
}
