/**
 * Fastify type augmentation for everything the core decorates.
 */
import type { preHandlerAsyncHookHandler } from 'fastify';

import type { AuthenticatedServer, AuthenticatedSession, AuthenticatedUser, ServerAccess } from '../auth/types';
import type { Deps } from '../container';

declare module 'fastify' {
  interface FastifyInstance {
    /** Application dependencies (same object modules receive in register()). */
    deps: Deps;
    /** preHandler verifying the Ed25519 request signature (§5.4); sets request.authServer. */
    requireServerSignature: preHandlerAsyncHookHandler;
  }

  interface FastifyRequest {
    /** Raw body bytes of JSON requests (hashed for signed requests); undefined without body. */
    rawBody: Buffer | undefined;
    /** Session user (null when anonymous). Populated before validation. */
    user: AuthenticatedUser | null;
    /** Session of request.user. */
    session: AuthenticatedSession | null;
    /** Server of a verified signed plugin request (§5.4 `request.server`). */
    authServer: AuthenticatedServer | null;
    /** Set by requireServerRole(). */
    serverAccess: ServerAccess | null;
  }
}

export {};
