/**
 * Regression for the Redis failure drill in docs/OPERATIONS.md: when the rate-limit store
 * (Redis) is unreachable, rate limiting must degrade — the limiter is a protective layer, not
 * an authorization decision. Without `skipOnError` a Redis outage turned *every* request,
 * including unauthenticated reads and `/api/v1/time`, into 500 INTERNAL_ERROR, i.e. a cache
 * outage became a total API outage. The checks that must stay closed (nonce/replay protection,
 * MFA tokens, job locks) fail closed on their own and are unaffected by this.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { createRouteRateLimits, registerRateLimit } from '../../src/http/rate-limit';
import { closeRedis, createRedis, type RedisClient } from '../../src/redis/client';
import { testEnv } from '../helpers';

/** A client pointed at a closed port: every command fails fast instead of hanging. */
const PORT_WITH_NO_REDIS = 1;

describe('rate limiting when Redis is unavailable', () => {
  let redis: RedisClient | null = null;

  afterEach(async () => {
    if (redis !== null) await closeRedis(redis);
    redis = null;
  });

  it('serves requests instead of failing them when the limiter store is down', async () => {
    const config = loadConfig(testEnv({ RATE_LIMIT_GLOBAL_PER_MINUTE: '1' }));
    redis = createRedis(`redis://127.0.0.1:${PORT_WITH_NO_REDIS}`, {
      commandTimeoutMs: 250,
      connectTimeoutMs: 250,
      onError: () => {
        /* expected: connection refused on every reconnect */
      },
    });

    const app = Fastify({ logger: false });
    await registerRateLimit(app, config, redis);
    app.get('/probe', async () => ({ ok: true }));
    await app.ready();
    try {
      // Twice, although the limit is 1/minute: with the store down no count can be kept, so the
      // request is served rather than rejected or failed.
      for (let i = 0; i < 2; i += 1) {
        const res = await app.inject({ method: 'GET', url: '/probe' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ ok: true });
      }
    } finally {
      await app.close();
    }
  });

  it('every route limiter degrades the same way', () => {
    const limits = createRouteRateLimits(loadConfig(testEnv()));
    for (const [name, limit] of Object.entries(limits)) {
      expect(limit.skipOnError, `${name} limiter must skip on store errors`).toBe(true);
    }
  });
});
