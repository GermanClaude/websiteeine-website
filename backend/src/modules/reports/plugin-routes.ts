/**
 * Signed plugin route POST /server/reports (§6.5): in-game report with optional
 * log-excerpt evidence. Body limit 128 KiB, per-server plugin rate limit.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { ServerReportRequestSchema, ServerReportResponseSchema } from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import type { ReportsService } from './service';

export const SERVER_REPORTS_BODY_LIMIT = 131072;

export async function registerReportPluginRoutes(
  app: FastifyInstance,
  deps: Deps,
  service: ReportsService,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/server/reports',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Submit an in-game report (signed)',
        body: ServerReportRequestSchema,
        response: { 201: ServerReportResponseSchema },
      },
      bodyLimit: SERVER_REPORTS_BODY_LIMIT,
      config: { rateLimit: deps.rateLimits.plugin },
      preHandler: [app.requireServerSignature],
    },
    async (request, reply) => {
      const server = request.authServer!;
      const result = await service.createServerReport(request, server, request.body);
      return reply.code(201).send(result);
    },
  );
}
