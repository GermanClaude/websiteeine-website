/**
 * Signed plugin endpoints:
 *   POST /player/check        (§6.1) — information only, never an action (R1)
 *   POST /player/bypass/check (§6.2)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  BypassCheckRequestSchema,
  BypassCheckResponseSchema,
  PlayerCheckRequestSchema,
  PlayerCheckResponseSchema,
} from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import type { PlayersService } from './service';

export async function registerPluginRoutes(app: FastifyInstance, deps: Deps, service: PlayersService): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/player/check',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Check a joining player (signed)',
        body: PlayerCheckRequestSchema,
        response: { 200: PlayerCheckResponseSchema },
      },
      preHandler: [app.requireServerSignature],
      config: { rateLimit: deps.rateLimits.plugin },
    },
    async (request) => service.check(request.authServer!, request.body),
  );

  r.post(
    '/player/bypass/check',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Check active bypasses for a player (signed)',
        body: BypassCheckRequestSchema,
        response: { 200: BypassCheckResponseSchema },
      },
      preHandler: [app.requireServerSignature],
      config: { rateLimit: deps.rateLimits.plugin },
    },
    async (request) => service.bypassCheck(request.authServer!, request.body),
  );
}
