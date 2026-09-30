/**
 * Rate limiting (ARCHITECTURE §14) with @fastify/rate-limit, Redis-backed when REDIS_URL is
 * set. The global limit applies per client IP to every route; routes opt into stricter or
 * differently keyed limits with `config: { rateLimit: deps.rateLimits.<name> }`.
 */
import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Config } from '../config';
import { hmacSha256Hex } from '../lib/crypto';
import { rateLimited } from '../lib/errors';
import type { RedisClient } from '../redis/client';

export interface RouteRateLimits {
  /** Login, registration, password reset, 2FA: RATE_LIMIT_AUTH_PER_MINUTE per IP. */
  readonly auth: RateLimitOptions;
  /** Public proof API: PROOF_RATE_LIMIT_PER_MINUTE per user (or IP when anonymous). */
  readonly proof: RateLimitOptions;
  /**
   * Signed plugin routes: RATE_LIMIT_PLUGIN_PER_MINUTE per authenticated server. Runs as a
   * preHandler after requireServerSignature (list it after the signature check).
   */
  readonly plugin: RateLimitOptions;
  /** Report creation: RATE_LIMIT_REPORTS_PER_HOUR per user (preHandler, after requireAuth). */
  readonly reportCreate: RateLimitOptions;
  /** Unsigned server registration (token + PoP): auth limit per IP. */
  readonly serverRegistration: RateLimitOptions;
}

const errorResponseBuilder = (_request: FastifyRequest, context: { ttl: number }) => rateLimited(context.ttl / 1000);

/**
 * Data minimization (§8.1/§29): limiter keys never contain the raw client IP, only a truncated
 * HMAC of it (IP_HASH_SECRET), like the server-auth failure counters.
 */
export function ipKey(config: Config, ip: string): string {
  return hmacSha256Hex(config.secrets.ipHashSecret, `rl:v1:${ip}`).slice(0, 32);
}

function userOrIpKey(config: Config, prefix: string) {
  return (request: FastifyRequest): string =>
    request.user !== null ? `${prefix}:user:${request.user.id}` : `${prefix}:ip:${ipKey(config, request.ip)}`;
}

export function createRouteRateLimits(config: Config): RouteRateLimits {
  const limits = config.rateLimit;
  return Object.freeze({
    auth: {
      max: limits.authPerMinute,
      timeWindow: 60_000,
      keyGenerator: (request: FastifyRequest) => `auth:ip:${ipKey(config, request.ip)}`,
      errorResponseBuilder,
    },
    proof: {
      max: config.proof.rateLimitPerMinute,
      timeWindow: 60_000,
      // preHandler: runs after the session hook so logged-in users are keyed by id.
      hook: 'preHandler',
      keyGenerator: userOrIpKey(config, 'proof'),
      errorResponseBuilder,
    },
    plugin: {
      max: limits.pluginPerMinute,
      timeWindow: 60_000,
      hook: 'preHandler',
      keyGenerator: (request: FastifyRequest) =>
        request.authServer !== null ? `plugin:srv:${request.authServer.server_id}` : `plugin:ip:${ipKey(config, request.ip)}`,
      errorResponseBuilder,
    },
    reportCreate: {
      max: limits.reportsPerHour,
      timeWindow: 3_600_000,
      hook: 'preHandler',
      keyGenerator: userOrIpKey(config, 'reports'),
      errorResponseBuilder,
    },
    serverRegistration: {
      max: limits.authPerMinute,
      timeWindow: 60_000,
      keyGenerator: (request: FastifyRequest) => `register:ip:${ipKey(config, request.ip)}`,
      errorResponseBuilder,
    },
  } satisfies RouteRateLimits);
}

export async function registerRateLimit(app: FastifyInstance, config: Config, redis: RedisClient | null): Promise<void> {
  if (!config.rateLimit.enabled) return;
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.globalPerMinute,
    timeWindow: 60_000,
    ...(redis !== null ? { redis, nameSpace: 'rl:' } : {}),
    // Health probes must never be throttled.
    allowList: (request: FastifyRequest) => request.url === '/healthz' || request.url === '/readyz',
    keyGenerator: (request: FastifyRequest) => `ip:${ipKey(config, request.ip)}`,
    errorResponseBuilder,
  });
}
