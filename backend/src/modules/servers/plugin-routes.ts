/**
 * Signed plugin routes (§5, §6):
 *   POST /servers/register    — NOT signed; registration token + proof of possession (§5.2)
 *   POST /servers/heartbeat   — signed; last_seen / versions / rotation flag
 *   POST /servers/keys/rotate — signed with the current key, PoP by the new key (§5.5)
 *   GET  /servers/policy      — signed; active ServerPolicy (§7)
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  KeyRotateRequestSchema,
  KeyRotateResponseSchema,
  ServerHeartbeatRequestSchema,
  ServerHeartbeatResponseSchema,
  ServerPolicySchema,
  ServerRegisterRequestSchema,
  ServerRegisterResponseSchema,
} from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import { getActivePolicy, toServerPolicyDto } from '../policies';
import { heartbeat, registerServer, rotateKey } from './service';

export async function registerServerPluginRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/servers/register',
    {
      config: { rateLimit: deps.rateLimits.serverRegistration },
      schema: {
        tags: ['plugin'],
        summary: 'Register a server key (registration token + proof of possession)',
        body: ServerRegisterRequestSchema,
        response: { 201: ServerRegisterResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await registerServer(deps, request.body, request.id);
      return reply.code(201).send(result);
    },
  );

  r.post(
    '/servers/heartbeat',
    {
      config: { rateLimit: deps.rateLimits.plugin },
      preHandler: [app.requireServerSignature],
      schema: {
        tags: ['plugin'],
        summary: 'Server heartbeat',
        body: ServerHeartbeatRequestSchema,
        response: { 200: ServerHeartbeatResponseSchema },
      },
    },
    async (request) => heartbeat(deps, request.authServer!, request.body),
  );

  r.post(
    '/servers/keys/rotate',
    {
      config: { rateLimit: deps.rateLimits.plugin },
      preHandler: [app.requireServerSignature],
      schema: {
        tags: ['plugin'],
        summary: 'Rotate the server signing key',
        body: KeyRotateRequestSchema,
        response: { 200: KeyRotateResponseSchema },
      },
    },
    async (request) => rotateKey(deps, request.authServer!, request.body, request.id),
  );

  r.get(
    '/servers/policy',
    {
      config: { rateLimit: deps.rateLimits.plugin },
      preHandler: [app.requireServerSignature],
      schema: {
        tags: ['plugin'],
        summary: 'Active policy of the calling server',
        response: { 200: ServerPolicySchema },
      },
    },
    async (request) => toServerPolicyDto(await getActivePolicy(deps, request.authServer!.id)),
  );
}
