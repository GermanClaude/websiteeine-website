/**
 * buildApp(deps) — the Fastify application (used by src/index.ts and by tests).
 *
 * Hook order per request:
 *   onRequest     X-Request-Id echo, cookie parsing, helmet/CORS, rate limit (route level)
 *   parsing       JSON bodies with request.rawBody (1 MiB default limit)
 *   preValidation session cookie → request.user/session, CSRF + Origin check
 *   validation    zod schemas (400 VALIDATION_FAILED)
 *   preHandler    route guards (requireAuth / requirePermission / requireServerSignature …)
 *   onResponse    one structured log line
 */
import cookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { registerCsrfProtection } from './auth/csrf';
import { createServerSignatureHandler } from './auth/server-auth';
import { registerSessionHook } from './auth/user-session';
import type { TrustProxySetting } from './config';
import type { Deps } from './container';
import { registerErrorHandlers } from './http/error-handler';
import './http/fastify-types';
import { registerHealthRoutes } from './http/health';
import { registerRequestLogging } from './http/logging';
import { registerOpenApi } from './http/openapi';
import { registerRateLimit } from './http/rate-limit';
import { registerRawJsonParser } from './http/raw-body';
import { genReqId, registerRequestContext } from './http/request-context';
import { registerSecurity } from './http/security';
import { MODULES, registerModules } from './modules';
import type { NamedModule } from './modules/types';

/** JSON body limit (ARCHITECTURE §14); routes may lower it (plugin reports: 128 KiB). */
export const DEFAULT_BODY_LIMIT_BYTES = 1_048_576;

export interface BuildAppOptions {
  /** Feature modules to register (default: all). */
  modules?: readonly NamedModule[];
  /** Registers additional routes after the core (tests). */
  extend?: (app: FastifyInstance) => Promise<void> | void;
}

function toFastifyTrustProxy(setting: TrustProxySetting): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting === 'number') return (_address: string, hop: number) => hop < setting;
  return setting;
}

export async function buildApp(deps: Deps, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app: FastifyInstance = Fastify({
    // Typed as the base logger so the instance type matches FastifyInstance everywhere.
    loggerInstance: deps.logger as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    genReqId,
    requestIdHeader: false,
    trustProxy: toFastifyTrustProxy(config.http.trustProxy),
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
    return503OnClosing: true,
    forceCloseConnections: 'idle',
    routerOptions: { maxParamLength: 256 },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('deps', deps);
  app.decorateRequest('rawBody', undefined);
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);
  app.decorateRequest('authServer', null);
  app.decorateRequest('serverAccess', null);

  registerRequestContext(app);
  registerRawJsonParser(app);
  await app.register(cookie, { secret: config.secrets.sessionSecret, hook: 'onRequest' });
  await registerSecurity(app, config);
  await registerRateLimit(app, config, deps.redis);
  await registerOpenApi(app, config);

  registerSessionHook(app, deps.sessions);
  registerCsrfProtection(app, {
    sessionSecret: config.secrets.sessionSecret,
    allowedOrigins: [...new Set([config.http.webOrigin, new URL(config.http.publicBaseUrl).origin])],
  });
  registerRequestLogging(app, { logClientIp: config.logging.clientIp, ipHashSecret: config.secrets.ipHashSecret });
  registerErrorHandlers(app);

  app.decorate(
    'requireServerSignature',
    createServerSignatureHandler({
      db: deps.db,
      nonceStore: deps.nonceStore,
      store: deps.store,
      clock: deps.clock,
      logger: deps.logger,
      maxSkewSeconds: config.serverAuth.signatureMaxSkewSeconds,
      failureLimitPerMinute: config.rateLimit.serverAuthFailuresPerMinute,
      ipHashSecret: config.secrets.ipHashSecret,
    }),
  );

  await registerHealthRoutes(app, deps);
  await registerModules(app, deps, options.modules ?? MODULES);
  if (options.extend !== undefined) await options.extend(app);
  return app;
}
