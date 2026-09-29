/**
 * One structured log line per request (ARCHITECTURE §15): request_id (logger binding),
 * server_id / user_id (bound by the auth hooks), method, templated route, status_code,
 * latency_ms and result. Bodies are never logged; the client IP only as network hash when
 * LOG_CLIENT_IP=true.
 */
import type { FastifyInstance } from 'fastify';

import { networkHashes } from '../lib/ip';

export interface RequestLoggingOptions {
  logClientIp: boolean;
  ipHashSecret: string;
}

function resultOf(statusCode: number): 'ok' | 'client_error' | 'server_error' {
  if (statusCode >= 500) return 'server_error';
  if (statusCode >= 400) return 'client_error';
  return 'ok';
}

export function registerRequestLogging(app: FastifyInstance, options: RequestLoggingOptions): void {
  app.addHook('onResponse', async (request, reply) => {
    const statusCode = reply.statusCode;
    const entry: Record<string, unknown> = {
      method: request.method,
      route: request.routeOptions.url ?? 'not_found',
      status_code: statusCode,
      latency_ms: Math.round(reply.elapsedTime * 100) / 100,
      result: resultOf(statusCode),
    };
    if (options.logClientIp) {
      entry['client_network_hash'] = networkHashes(request.ip, options.ipHashSecret)?.network_hash ?? null;
    }
    if (request.url === '/healthz' || request.url === '/readyz') {
      request.log.debug(entry, 'request completed');
    } else {
      request.log.info(entry, 'request completed');
    }
  });
}
