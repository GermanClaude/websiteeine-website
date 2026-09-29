/**
 * GET /healthz (liveness), GET /readyz (database + Redis), GET /api/v1/time (§6, unsigned).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { sql } from 'kysely';
import { z } from 'zod';

import { API_PREFIX, buildErrorResponse, TimeResponseSchema } from '@scpsl-trust/shared';

import type { Deps } from '../container';

const HealthResponseSchema = z.object({ status: z.literal('ok') });
const CheckStatusSchema = z.enum(['ok', 'error', 'disabled']);
const ReadyResponseSchema = z.object({
  status: z.literal('ready'),
  checks: z.object({ database: CheckStatusSchema, redis: CheckStatusSchema }),
});

const CHECK_TIMEOUT_MS = 2_000;

async function withTimeout(check: () => Promise<unknown>): Promise<'ok' | 'error'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function registerHealthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/healthz', { schema: { hide: true, response: { 200: HealthResponseSchema } } }, async () => ({ status: 'ok' as const }));

  r.get('/readyz', { schema: { hide: true } }, async (request, reply) => {
    const database = await withTimeout(() => sql`SELECT 1`.execute(deps.db));
    const redis = deps.redis === null ? ('disabled' as const) : await withTimeout(() => deps.store.ping());
    const checks = { database, redis };
    if (database === 'ok' && redis !== 'error') {
      return reply.code(200).send(ReadyResponseSchema.parse({ status: 'ready', checks }));
    }
    request.log.warn({ checks }, 'readiness check failed');
    return reply
      .code(503)
      .send(buildErrorResponse('SERVICE_UNAVAILABLE', request.id, { details: { checks } }));
  });

  r.get(
    `${API_PREFIX}/time`,
    {
      schema: {
        tags: ['plugin'],
        summary: 'Server time for clock-skew diagnostics (unsigned)',
        response: { 200: TimeResponseSchema },
      },
    },
    async () => {
      const now = deps.clock.now();
      return { server_time: now.toISOString(), epoch_ms: now.getTime() };
    },
  );
}
