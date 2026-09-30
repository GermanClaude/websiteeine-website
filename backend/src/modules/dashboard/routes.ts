/**
 * GET /dashboard (§13 "Dashboard") — any authenticated user; content is scoped
 * by permissions/memberships in the service.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { DashboardResponseSchema } from '@scpsl-trust/shared';

import { assertAuthenticated, requireAuth } from '../../auth/rbac';
import type { Deps } from '../../container';
import type { DashboardService } from './service';

export async function registerDashboardRoutes(
  app: FastifyInstance,
  _deps: Deps,
  service: DashboardService,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/dashboard',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Scoped dashboard counts, server status and recent audit events',
        response: { 200: DashboardResponseSchema },
      },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.build(user);
    },
  );
}
