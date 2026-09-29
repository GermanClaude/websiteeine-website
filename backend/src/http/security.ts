/**
 * Security headers and CORS (ARCHITECTURE §14): helmet with a strict CSP for API
 * responses, HSTS when COOKIE_SECURE, CORS only for WEB_ORIGIN (with credentials) and
 * `Cache-Control: no-store` on API responses unless a route set its own policy.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

import { CSRF_HEADER, REQUEST_ID_HEADER } from '@scpsl-trust/shared';

import type { Config } from '../config';

export async function registerSecurity(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hsts: config.cookies.secure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(cors, {
    origin: [config.http.webOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', CSRF_HEADER, REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER, 'Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 600,
    strictPreflight: true,
  });

  app.addHook('onSend', async (request, reply) => {
    if (reply.hasHeader('cache-control')) return;
    const url = request.url;
    if (url.startsWith('/api/') || url === '/healthz' || url === '/readyz') {
      reply.header('cache-control', 'no-store');
    }
  });
}
