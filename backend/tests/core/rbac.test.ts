import { describe, expect, it } from 'vitest';

import { Permission } from '@scpsl-trust/shared';

import { assertPermission, assertServerAction, assertServerRole, getServerMembership, userHasPermission } from '../../src/auth/rbac';
import { AppError } from '../../src/lib/errors';
import { createServerWithKey, createUser, expectError, sessionFor, useTestApp, type TestApp } from '../helpers';
import { registerWebTestRoutes, TEST_ROUTES } from './support/web-routes';

async function get(t: TestApp, url: string, cookie?: string) {
  return t.app.inject({ method: 'GET', url, ...(cookie !== undefined ? { headers: { cookie } } : {}) });
}

describe('RBAC preHandlers', () => {
  const t = useTestApp({ modules: [], extend: registerWebTestRoutes });

  it('requirePermission: 401 anonymous, 403 missing permission, 200 granted', async () => {
    expectError(await get(t(), TEST_ROUTES.auditView), 401, 'UNAUTHENTICATED');
    for (const role of ['player', 'server_admin', 'reviewer', 'moderator'] as const) {
      const { user } = await createUser(t().deps, { role, totp: role !== 'player' && role !== 'server_admin' });
      const session = await sessionFor(t().deps, user);
      expectError(await get(t(), TEST_ROUTES.auditView, session.cookie), 403, 'FORBIDDEN');
    }
    for (const role of ['admin', 'super_admin'] as const) {
      const { user } = await createUser(t().deps, { role, totp: true });
      const session = await sessionFor(t().deps, user);
      expect((await get(t(), TEST_ROUTES.auditView, session.cookie)).statusCode).toBe(200);
    }
  });

  it('requirePermission: staff without 2FA must enroll first (even for base permissions)', async () => {
    const { user } = await createUser(t().deps, { role: 'admin' });
    const session = await sessionFor(t().deps, user);
    expectError(await get(t(), TEST_ROUTES.auditView, session.cookie), 403, 'MFA_ENROLLMENT_REQUIRED');
    expectError(await get(t(), TEST_ROUTES.reportCreate, session.cookie), 403, 'MFA_ENROLLMENT_REQUIRED');
    // requireAuth-only routes (/auth/*, /me) stay usable.
    expect((await get(t(), TEST_ROUTES.me, session.cookie)).statusCode).toBe(200);
  });

  it('requirePermission: disabled accounts are rejected', async () => {
    const { user } = await createUser(t().deps, { role: 'admin', totp: true, status: 'disabled' });
    const session = await sessionFor(t().deps, user);
    expectError(await get(t(), TEST_ROUTES.auditView, session.cookie), 403, 'ACCOUNT_DISABLED');
  });

  it('requireVerifiedEmail', async () => {
    const unverified = (await createUser(t().deps, { verified: false })).user;
    const verified = (await createUser(t().deps)).user;
    expectError(await get(t(), TEST_ROUTES.verified, (await sessionFor(t().deps, unverified)).cookie), 403, 'EMAIL_NOT_VERIFIED');
    expect((await get(t(), TEST_ROUTES.verified, (await sessionFor(t().deps, verified)).cookie)).statusCode).toBe(200);
  });

  it('requireMfaSession', async () => {
    const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
    expectError(await get(t(), TEST_ROUTES.mfa, (await sessionFor(t().deps, user, { mfa_verified: false })).cookie), 403, 'FORBIDDEN');
    expect((await get(t(), TEST_ROUTES.mfa, (await sessionFor(t().deps, user)).cookie)).statusCode).toBe(200);
  });
});

describe('server-scoped access (requireServerRole / assertServerRole)', () => {
  const t = useTestApp({ modules: [], extend: registerWebTestRoutes });

  async function member(serverId: string, role: 'admin' | 'moderator', globalRole: 'player' | 'server_admin' = 'player') {
    const { user } = await createUser(t().deps, { role: globalRole });
    await t()
      .db.insertInto('server_members')
      .values({ server_id: serverId, user_id: user.id, role, created_by: user.id })
      .execute();
    return user;
  }

  it('grants owners and adequate members regardless of their global role', async () => {
    const srv = await createServerWithKey(t().deps);
    const ownerSession = await sessionFor(t().deps, srv.owner);
    const res = await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), ownerSession.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ member_role: 'owner', via: 'membership', server: { id: srv.server.id, server_id: srv.server.server_id } });

    const admin = await member(srv.server.id, 'admin');
    expect((await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), (await sessionFor(t().deps, admin)).cookie)).statusCode).toBe(200);

    const moderator = await member(srv.server.id, 'moderator');
    const modCookie = (await sessionFor(t().deps, moderator)).cookie;
    expectError(await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), modCookie), 403, 'FORBIDDEN');
    expect((await get(t(), TEST_ROUTES.server(srv.server.server_id, 'whitelist'), modCookie)).statusCode).toBe(200);
  });

  it('rejects non-members and members of other servers', async () => {
    const srv = await createServerWithKey(t().deps);
    const other = await createServerWithKey(t().deps);
    const outsider = (await createUser(t().deps, { role: 'server_admin' })).user;
    expectError(
      await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), (await sessionFor(t().deps, outsider)).cookie),
      403,
      'FORBIDDEN',
    );
    expectError(
      await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), (await sessionFor(t().deps, other.owner)).cookie),
      403,
      'FORBIDDEN',
    );
  });

  it('honours override permissions, except for actions without one', async () => {
    const srv = await createServerWithKey(t().deps);
    const admin = (await createUser(t().deps, { role: 'admin', totp: true })).user;
    const adminCookie = (await sessionFor(t().deps, admin)).cookie;
    const manage = await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), adminCookie);
    expect(manage.statusCode).toBe(200);
    expect(manage.json()).toMatchObject({ member_role: null, via: 'override' });
    // Confirmations have no override: statements of the server itself.
    expectError(await get(t(), TEST_ROUTES.server(srv.server.server_id, 'confirm'), adminCookie), 403, 'FORBIDDEN');
    // allowPermission: null disables overrides.
    expectError(await get(t(), TEST_ROUTES.server(srv.server.server_id, 'members'), adminCookie), 403, 'FORBIDDEN');

    const globalModerator = (await createUser(t().deps, { role: 'moderator', totp: true })).user;
    const modCookie = (await sessionFor(t().deps, globalModerator)).cookie;
    expect((await get(t(), TEST_ROUTES.server(srv.server.server_id, 'whitelist'), modCookie)).statusCode).toBe(200);
    expectError(await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), modCookie), 403, 'FORBIDDEN');
  });

  it('404s unknown and malformed server ids and 401s anonymous callers', async () => {
    const { user } = await createUser(t().deps, { role: 'admin', totp: true });
    const cookie = (await sessionFor(t().deps, user)).cookie;
    expectError(await get(t(), TEST_ROUTES.server('srv_zzzzzzzzzzzzzzzz', 'manage'), cookie), 404, 'NOT_FOUND');
    expectError(await get(t(), TEST_ROUTES.server('not-a-server', 'manage'), cookie), 404, 'NOT_FOUND');
    expectError(await get(t(), TEST_ROUTES.server("srv_' or 1=1 --", 'manage'), cookie), 404, 'NOT_FOUND');
    expectError(await get(t(), TEST_ROUTES.server('srv_zzzzzzzzzzzzzzzz', 'manage')), 401, 'UNAUTHENTICATED');
  });

  it('enforces 2FA enrollment on server-scoped routes', async () => {
    const owner = (await createUser(t().deps, { role: 'admin' })).user;
    const srv = await createServerWithKey(t().deps, { owner });
    expectError(
      await get(t(), TEST_ROUTES.server(srv.server.server_id, 'manage'), (await sessionFor(t().deps, owner)).cookie),
      403,
      'MFA_ENROLLMENT_REQUIRED',
    );
  });

  it('service helpers', async () => {
    const srv = await createServerWithKey(t().deps);
    expect(await getServerMembership(t().db, srv.server.id, srv.owner.id)).toBe('owner');
    const stranger = (await createUser(t().deps)).user;
    expect(await getServerMembership(t().db, srv.server.id, stranger.id)).toBeNull();
    await expect(assertServerRole(t().db, stranger, srv.server.id, ['owner'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(assertServerAction(t().db, srv.owner, srv.server.id, 'policy')).resolves.toEqual({ member_role: 'owner', via: 'membership' });
    const admin = (await createUser(t().deps, { role: 'admin' })).user;
    await expect(assertServerAction(t().db, admin, srv.server.id, 'bypass')).resolves.toEqual({ member_role: null, via: 'override' });

    expect(() => assertPermission({ role: 'player' }, Permission.AUDIT_VIEW)).toThrow(AppError);
    expect(() => assertPermission({ role: 'admin' }, Permission.AUDIT_VIEW, Permission.USER_MANAGE)).not.toThrow();
    expect(() => assertPermission({ role: 'admin' }, Permission.USER_MANAGE_ADMINS)).toThrow(AppError);
    expect(userHasPermission(null, Permission.CASE_VIEW_PUBLIC)).toBe(false);
    expect(userHasPermission({ role: 'player' }, Permission.CASE_VIEW_PUBLIC)).toBe(true);
  });
});

describe('REQUIRE_2FA_ROLES configuration', () => {
  const t = useTestApp({ modules: [], extend: registerWebTestRoutes, env: { REQUIRE_2FA_ROLES: 'super_admin' } });

  it('only listed roles must enroll', async () => {
    const admin = (await createUser(t().deps, { role: 'admin' })).user;
    expect((await get(t(), TEST_ROUTES.auditView, (await sessionFor(t().deps, admin)).cookie)).statusCode).toBe(200);
    const superAdmin = (await createUser(t().deps, { role: 'super_admin' })).user;
    expectError(await get(t(), TEST_ROUTES.auditView, (await sessionFor(t().deps, superAdmin)).cookie), 403, 'MFA_ENROLLMENT_REQUIRED');
  });
});
