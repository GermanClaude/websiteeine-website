/**
 * OpenAPI 3.1 generation from the zod route schemas (@fastify/swagger +
 * fastify-type-provider-zod). JSON at /api/docs/openapi.json; Swagger UI at /api/docs when
 * OPENAPI_UI=true. Must be registered before any route.
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { createJsonSchemaTransform } from 'fastify-type-provider-zod';

import { CSRF_HEADER, SESSION_COOKIE_NAME, SIGNING_HEADERS } from '@scpsl-trust/shared';

import type { Config } from '../config';

export const OPENAPI_JSON_PATH = '/api/docs/openapi.json';
export const OPENAPI_UI_PREFIX = '/api/docs';

export async function registerOpenApi(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'SCP:SL Trust Network API',
        description:
          'Centralized transparency, decentralized enforcement. Web endpoints use the session cookie + CSRF header; ' +
          'plugin endpoints use Ed25519 signed requests (see docs/ARCHITECTURE.md §5).',
        version: '1.0.0',
      },
      servers: [{ url: config.http.publicBaseUrl }],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE_NAME },
          csrfToken: { type: 'apiKey', in: 'header', name: CSRF_HEADER },
          serverSignature: {
            type: 'apiKey',
            in: 'header',
            name: SIGNING_HEADERS.SIGNATURE,
            description:
              'Ed25519 signature over the canonical request (SCPSL-TRUST-V1). Also requires X-Server-Id, X-Timestamp, ' +
              'X-Nonce, X-Request-Id, X-Plugin-Version and optionally X-Key-Fingerprint.',
          },
        },
      },
    },
    transform: createJsonSchemaTransform({ skipList: [] }),
  });

  app.get(OPENAPI_JSON_PATH, { schema: { hide: true } }, async () => app.swagger());

  if (config.features.openapiUi) {
    await app.register(swaggerUi, {
      routePrefix: OPENAPI_UI_PREFIX,
      staticCSP: true,
      uiConfig: { deepLinking: false, withCredentials: true },
    });
  }
}
