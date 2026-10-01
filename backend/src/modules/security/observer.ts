/**
 * Global intrusion-detection observer (ARCHITECTURE §14). Registered from app.ts AFTER
 * request-context + rate-limit and BEFORE the route handlers, so it sees every request.
 *
 * Hook map:
 *   onRequest   fast block check for the anonymous (network) source — before any DB work —
 *               plus a bounded request-metadata heuristic scan.
 *   preHandler  block check for the resolved source (user/server), burst counting and an
 *               in-process anomaly activity sample.
 *   onError     turns auth/signature/CSRF AppErrors into weighted signals.
 *
 * Everything is best-effort and fail-open: detection must never make a legitimate request
 * fail. Only transient request blocking is automatic; no human account is ever disabled here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isAppError, rateLimited } from '../../lib/errors';
import { ERROR_CODE_SIGNALS, scanRequestMetadata } from './signals';
import type { SecuritySource, SecurityService, SignalContext } from './service';

/** Health probes are never inspected or throttled. */
function isExempt(request: FastifyRequest): boolean {
  return request.url === '/healthz' || request.url === '/readyz';
}

function userAgentOf(request: FastifyRequest): string | undefined {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value : undefined;
}

function contextOf(request: FastifyRequest): SignalContext {
  const endpoint = request.routeOptions?.url ?? null;
  return { endpoint, requestId: request.id };
}

/** Source after authentication is resolved (server > user > network). */
function resolvedSource(request: FastifyRequest, service: SecurityService): SecuritySource {
  if (request.authServer !== null) return { type: 'server', ref: request.authServer.server_id };
  if (request.user !== null) return { type: 'user', ref: request.user.id };
  return service.networkSource(request.ip);
}

export function registerSecurityObserver(app: FastifyInstance, service: SecurityService): void {
  if (!service.detectionEnabled) {
    app.log.info({ event: 'security_detection_disabled' }, 'security: intrusion detection disabled by config');
    return;
  }

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (isExempt(request)) return;
    const source = service.networkSource(request.ip);
    if (await service.isBlocked(source)) {
      throw rateLimited();
    }
    const scan = scanRequestMetadata(request.raw.url ?? request.url, userAgentOf(request));
    if (scan.probe || scan.scanner) {
      await service.observeHeuristics(source, scan, contextOf(request));
    }
  });

  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (isExempt(request)) return;
    const source = resolvedSource(request, service);
    if ((source.type === 'user' || source.type === 'server') && (await service.isBlocked(source))) {
      throw rateLimited();
    }
    await service.observeBurst(source, contextOf(request));
    service.recordActivitySample(source, request.routeOptions?.url ?? null);
  });

  app.addHook('onError', async (request: FastifyRequest, _reply: FastifyReply, error: unknown) => {
    if (!isAppError(error)) return;
    const kind = ERROR_CODE_SIGNALS[error.code];
    if (kind === undefined) return;
    await service.observeSignal(resolvedSource(request, service), kind, contextOf(request));
  });
}
