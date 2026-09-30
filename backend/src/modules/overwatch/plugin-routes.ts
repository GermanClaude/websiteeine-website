/**
 * Signed plugin routes of the Overwatch module (§10.1): start / heartbeat / end.
 * The session secret appears only in the start response.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  OverwatchSessionEndRequestSchema,
  OverwatchSessionEndResponseSchema,
  OverwatchSessionHeartbeatRequestSchema,
  OverwatchSessionHeartbeatResponseSchema,
  OverwatchSessionParamsSchema,
  OverwatchSessionStartRequestSchema,
  OverwatchSessionStartResponseSchema,
} from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import type { OverwatchService } from './service';

export async function registerOverwatchPluginRoutes(
  app: FastifyInstance,
  deps: Deps,
  service: OverwatchService,
): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const signed = {
    config: { rateLimit: deps.rateLimits.plugin },
    preHandler: [app.requireServerSignature],
  } as const;

  r.post(
    '/overwatch/sessions',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Start an Overwatch proof session (signed; secret returned once)',
        body: OverwatchSessionStartRequestSchema,
        response: { 201: OverwatchSessionStartResponseSchema },
      },
      ...signed,
    },
    async (request, reply) => {
      const result = await service.startSession(request, request.authServer!, request.body);
      return reply.code(201).send(result);
    },
  );

  r.post(
    '/overwatch/sessions/:id/heartbeat',
    {
      schema: {
        tags: ['plugin'],
        summary: 'Keep an Overwatch session alive (signed)',
        params: OverwatchSessionParamsSchema,
        body: OverwatchSessionHeartbeatRequestSchema,
        response: { 200: OverwatchSessionHeartbeatResponseSchema },
      },
      ...signed,
    },
    async (request) => service.heartbeat(request.authServer!, request.params.id),
  );

  r.post(
    '/overwatch/sessions/:id/end',
    {
      schema: {
        tags: ['plugin'],
        summary: 'End an Overwatch session (signed)',
        params: OverwatchSessionParamsSchema,
        body: OverwatchSessionEndRequestSchema,
        response: { 200: OverwatchSessionEndResponseSchema },
      },
      ...signed,
    },
    async (request) => service.endSession(request, request.authServer!, request.params.id, request.body.reason),
  );
}
