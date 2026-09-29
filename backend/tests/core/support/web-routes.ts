/**
 * Test-only routes exercising the web auth building blocks (no feature modules).
 */
import type { FastifyInstance } from 'fastify';

import { Permission } from '@scpsl-trust/shared';

import {
  requireAuth,
  requireMfaSession,
  requirePermission,
  requireServerRole,
  requireVerifiedEmail,
} from '../../../src/auth/rbac';

export const TEST_ROUTES = {
  me: '/api/v1/_test/me',
  state: '/api/v1/_test/state',
  anonymous: '/api/v1/_test/anon',
  auditView: '/api/v1/_test/audit-view',
  reportCreate: '/api/v1/_test/report-create',
  verified: '/api/v1/_test/verified',
  mfa: '/api/v1/_test/mfa',
  login: '/api/v1/_test/login',
  logout: '/api/v1/_test/logout',
  server: (id: string, action: 'manage' | 'whitelist' | 'confirm' | 'members') => `/api/v1/_test/servers/${id}/${action}`,
} as const;

export function registerWebTestRoutes(app: FastifyInstance): void {
  const { db, sessions } = app.deps;

  app.get(TEST_ROUTES.me, { preHandler: requireAuth }, async (request) => ({ user: request.user, session: request.session }));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    app.route({ method, url: TEST_ROUTES.state, preHandler: requireAuth, handler: async () => ({ ok: true }) });
  }
  app.post(TEST_ROUTES.anonymous, async () => ({ ok: true }));
  app.get(TEST_ROUTES.auditView, { preHandler: requirePermission(Permission.AUDIT_VIEW) }, async () => ({ ok: true }));
  app.get(TEST_ROUTES.reportCreate, { preHandler: requirePermission(Permission.REPORT_CREATE) }, async () => ({ ok: true }));
  app.get(TEST_ROUTES.verified, { preHandler: requireVerifiedEmail }, async () => ({ ok: true }));
  app.get(TEST_ROUTES.mfa, { preHandler: requireMfaSession }, async () => ({ ok: true }));

  app.post<{ Body: { user_id: string } }>(TEST_ROUTES.login, async (request, reply) => {
    const created = await sessions.createSession(db, { id: request.body.user_id }, {
      mfa_verified: false,
      user_agent: request.headers['user-agent'] ?? null,
      ip: request.ip,
    });
    sessions.setSessionCookie(reply, created.token, created.session.expires_at);
    return { csrf_token: created.csrfToken, session_id: created.session.id };
  });
  app.post(TEST_ROUTES.logout, { preHandler: requireAuth }, async (request, reply) => {
    await sessions.revokeSession(db, request.session?.id ?? '', 'logout');
    sessions.clearSessionCookie(reply);
    return { ok: true };
  });

  const serverHandler = async (request: { serverAccess: unknown }) => request.serverAccess;
  app.get('/api/v1/_test/servers/:id/manage', { preHandler: requireServerRole(db, { action: 'manage' }) }, serverHandler);
  app.get('/api/v1/_test/servers/:id/whitelist', { preHandler: requireServerRole(db, { action: 'whitelist_decide' }) }, serverHandler);
  app.get('/api/v1/_test/servers/:id/confirm', { preHandler: requireServerRole(db, { action: 'confirm' }) }, serverHandler);
  app.get(
    '/api/v1/_test/servers/:id/members',
    { preHandler: requireServerRole(db, { roles: ['owner'], allowPermission: null }) },
    serverHandler,
  );
}
