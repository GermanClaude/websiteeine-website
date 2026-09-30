/**
 * Users module: /me, player-link flow (web + signed plugin route), admin user management.
 */
import { describe, expect, it } from 'vitest';

import { LINK_CODE_REGEX } from '@scpsl-trust/shared';

import { MODULES } from '../../../src/modules';
import {
  createPlayer,
  createServerWithKey,
  createUser,
  expectError,
  sessionFor,
  signedRequest,
  useTestApp,
} from '../../helpers';

const usersModules = MODULES.filter((m) => ['auth', 'users'].includes(m.name));

describe('users module', () => {
  const t = useTestApp({ now: '2026-09-29T12:00:00.000Z', modules: usersModules });

  async function auditEvents(action: import('@scpsl-trust/shared').AuditAction) {
    return t().db.selectFrom('audit_events').selectAll().where('action', '=', action).orderBy('seq', 'asc').execute();
  }

  // -------------------------------------------------------------------------
  // GET /me
  // -------------------------------------------------------------------------

  describe('GET /me', () => {
    it('requires authentication', async () => {
      expectError(await t().app.inject({ method: 'GET', url: '/api/v1/me' }), 401, 'UNAUTHENTICATED');
    });

    it('returns profile, permissions, linked player and memberships', async () => {
      const player = await createPlayer(t().deps);
      const { user } = await createUser(t().deps, { playerId: player.id });
      const { server } = await createServerWithKey(t().deps, { owner: user });
      const session = await sessionFor(t().deps, user);

      const res = await t().app.inject({ method: 'GET', url: '/api/v1/me', headers: session.headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe(user.id);
      expect(body.user.role).toBe('player');
      expect(body.permissions).toContain('player:link');
      expect(body.permissions).not.toContain('user:manage');
      expect(body.linked_player).toMatchObject({ type: player.id_type, id: player.external_id });
      expect(body.linked_player.user_id).toBe(`${player.external_id}@${player.id_type}`);
      expect(body.servers).toEqual([{ server_id: server.server_id, name: server.name, role: 'owner' }]);
      expect(body.user).not.toHaveProperty('password_hash');
      expect(JSON.stringify(body)).not.toContain('totp_secret');
    });

    it('shows the reviewer number for staff', async () => {
      const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
      const session = await sessionFor(t().deps, user);
      const res = await t().app.inject({ method: 'GET', url: '/api/v1/me', headers: session.headers });
      expect(res.json().user.reviewer_number).toBe(user.reviewer_number);
    });
  });

  // -------------------------------------------------------------------------
  // Player link (§6.6)
  // -------------------------------------------------------------------------

  describe('player link', () => {
    it('runs the full link flow via a signed plugin request and audits it', async () => {
      const { user } = await createUser(t().deps);
      const session = await sessionFor(t().deps, user);
      const identity = await createServerWithKey(t().deps);

      const codeRes = await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: session.headers });
      expect(codeRes.statusCode).toBe(200);
      const { code, expires_at } = codeRes.json();
      expect(code).toMatch(LINK_CODE_REGEX);
      expect(new Date(expires_at).getTime()).toBe(t().clock.now().getTime() + 10 * 60_000);

      const playerRef = { type: 'steam' as const, id: '76561198012345678' };
      const link = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: playerRef, code },
      });
      expect(link.statusCode).toBe(200);
      expect(link.json()).toEqual({ linked: true, username: user.username });

      const row = await t().db.selectFrom('users').select('player_id').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.player_id).not.toBeNull();
      const playerRow = await t().db.selectFrom('players').selectAll().where('id', '=', row.player_id!).executeTakeFirstOrThrow();
      expect(playerRow.external_id).toBe(playerRef.id);

      const events = await auditEvents('PLAYER_LINKED');
      expect(events.length).toBe(1);
      expect(events[0]!.actor_type).toBe('server');
      expect(events[0]!.actor_id).toBe(identity.server.server_id);
      expect(events[0]!.target_id).toBe(user.id);

      // The code is single use.
      const reuse = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: playerRef, code },
      });
      expectError(reuse, 400, 'LINK_CODE_INVALID');
    });

    it('rejects invalid, foreign-signed and expired codes', async () => {
      const identity = await createServerWithKey(t().deps);
      const invalid = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: { type: 'steam', id: '76561198000000001' }, code: 'LNK-ZZZZZZ' },
      });
      expectError(invalid, 400, 'LINK_CODE_INVALID');

      // Unsigned requests never reach the handler.
      const unsigned = await t().app.inject({
        method: 'POST',
        url: '/api/v1/player/link',
        payload: { player: { type: 'steam', id: '76561198000000001' }, code: 'LNK-ZZZZZZ' },
      });
      expect(unsigned.statusCode).toBe(401);

      // Expired code.
      const { user } = await createUser(t().deps);
      const session = await sessionFor(t().deps, user);
      const codeRes = await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: session.headers });
      const { code } = codeRes.json();
      t().clock.advance(10 * 60_000 + 1000);
      const expired = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: { type: 'steam', id: '76561198000000002' }, code },
      });
      expectError(expired, 400, 'LINK_CODE_INVALID');
    });

    it('only keeps one active code per user (a new code invalidates the old one)', async () => {
      const { user } = await createUser(t().deps);
      const session = await sessionFor(t().deps, user);
      const identity = await createServerWithKey(t().deps);

      const first = (await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: session.headers })).json();
      const second = (await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: session.headers })).json();
      expect(second.code).not.toBe(first.code);

      const staleUse = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: { type: 'steam', id: '76561198000000003' }, code: first.code },
      });
      expectError(staleUse, 400, 'LINK_CODE_INVALID');

      const freshUse = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: { type: 'steam', id: '76561198000000003' }, code: second.code },
      });
      expect(freshUse.statusCode).toBe(200);
    });

    it('refuses linking a player who is already linked to another account', async () => {
      const taken = await createPlayer(t().deps, { type: 'steam', id: '76561198099999999' });
      await createUser(t().deps, { playerId: taken.id });
      const { user } = await createUser(t().deps);
      const session = await sessionFor(t().deps, user);
      const identity = await createServerWithKey(t().deps);

      const { code } = (await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: session.headers })).json();
      const res = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/link',
        body: { player: { type: 'steam', id: '76561198099999999' }, code },
      });
      expectError(res, 409, 'PLAYER_ALREADY_LINKED');
      const row = await t().db.selectFrom('users').select('player_id').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.player_id).toBeNull();
    });

    it('unlinks via DELETE /me/player-link and audits PLAYER_UNLINKED', async () => {
      const player = await createPlayer(t().deps);
      const { user } = await createUser(t().deps, { playerId: player.id });
      const session = await sessionFor(t().deps, user);

      const res = await t().app.inject({ method: 'DELETE', url: '/api/v1/me/player-link', headers: session.headers });
      expect(res.statusCode).toBe(200);
      const row = await t().db.selectFrom('users').select('player_id').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.player_id).toBeNull();
      expect((await auditEvents('PLAYER_UNLINKED')).some((e) => e.target_id === user.id)).toBe(true);

      const again = await t().app.inject({ method: 'DELETE', url: '/api/v1/me/player-link', headers: session.headers });
      expectError(again, 403, 'PLAYER_NOT_LINKED');
    });
  });

  // -------------------------------------------------------------------------
  // Admin user management
  // -------------------------------------------------------------------------

  describe('admin users', () => {
    it('GET /admin/users requires user:view and hides secrets', async () => {
      const { user: player } = await createUser(t().deps);
      const playerSession = await sessionFor(t().deps, player);
      expectError(await t().app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: playerSession.headers }), 403, 'FORBIDDEN');

      const { user: mod } = await createUser(t().deps, { role: 'moderator', totp: true });
      const modSession = await sessionFor(t().deps, mod);
      const res = await t().app.inject({ method: 'GET', url: '/api/v1/admin/users?page_size=100', headers: modSession.headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBeGreaterThanOrEqual(2);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('password_hash');
      expect(raw).not.toContain('totp_secret');
      expect(raw).not.toContain('$argon2id$');
    });

    it('filters by q, role and status and paginates', async () => {
      const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
      const adminSession = await sessionFor(t().deps, admin);
      await createUser(t().deps, { email: 'findme-alpha@example.test', username: 'findme_alpha' });
      await createUser(t().deps, { status: 'disabled', email: 'disabled-user@example.test' });

      const byQ = await t().app.inject({ method: 'GET', url: '/api/v1/admin/users?q=findme-alpha', headers: adminSession.headers });
      expect(byQ.json().items.map((u: { email: string }) => u.email)).toEqual(['findme-alpha@example.test']);

      const byRole = await t().app.inject({ method: 'GET', url: '/api/v1/admin/users?role=admin', headers: adminSession.headers });
      expect(byRole.json().items.every((u: { role: string }) => u.role === 'admin')).toBe(true);

      const byStatus = await t().app.inject({
        method: 'GET',
        url: '/api/v1/admin/users?status=disabled',
        headers: adminSession.headers,
      });
      expect(byStatus.json().items.every((u: { status: string }) => u.status === 'disabled')).toBe(true);

      const paged = await t().app.inject({ method: 'GET', url: '/api/v1/admin/users?page=1&page_size=2', headers: adminSession.headers });
      expect(paged.json().items.length).toBeLessThanOrEqual(2);
      expect(paged.json().page_size).toBe(2);
    });

    it('enforces the role-change permission matrix', async () => {
      const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
      const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
      const { user: admin2 } = await createUser(t().deps, { role: 'admin', totp: true });
      const { user: superAdmin } = await createUser(t().deps, { role: 'super_admin', totp: true });
      const { user: target } = await createUser(t().deps);

      const modSession = await sessionFor(t().deps, moderator);
      const adminSession = await sessionFor(t().deps, admin);
      const superSession = await sessionFor(t().deps, superAdmin);

      // Moderator has no user:manage at all.
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${target.id}`,
          headers: modSession.headers,
          payload: { role: 'reviewer' },
        }),
        403,
        'FORBIDDEN',
      );

      // Admin may not grant admin or super_admin (needs user:manage_admins).
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${target.id}`,
          headers: adminSession.headers,
          payload: { role: 'admin' },
        }),
        403,
        'FORBIDDEN',
      );
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${target.id}`,
          headers: adminSession.headers,
          payload: { role: 'super_admin' },
        }),
        403,
        'FORBIDDEN',
      );

      // Admin may not manage another admin.
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${admin2.id}`,
          headers: adminSession.headers,
          payload: { status: 'disabled' },
        }),
        403,
        'FORBIDDEN',
      );

      // Nobody may change their own account.
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${superAdmin.id}`,
          headers: superSession.headers,
          payload: { role: 'admin' },
        }),
        403,
        'FORBIDDEN',
      );

      // super_admin may promote to admin.
      const promote = await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        headers: superSession.headers,
        payload: { role: 'admin', reason: 'trusted operator' },
      });
      expect(promote.statusCode).toBe(200);
      expect(promote.json().role).toBe('admin');
      const events = await auditEvents('USER_ROLE_CHANGED');
      expect(events.some((e) => e.target_id === target.id)).toBe(true);

      // Unknown user → 404; invalid body → 400.
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: '/api/v1/admin/users/6f9619ff-8b86-d011-b42d-00c04fc964ff',
          headers: superSession.headers,
          payload: { role: 'reviewer' },
        }),
        404,
        'NOT_FOUND',
      );
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${target.id}`,
          headers: superSession.headers,
          payload: {},
        }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('assigns a reviewer number when a player is first promoted to reviewer', async () => {
      const { user: superAdmin } = await createUser(t().deps, { role: 'super_admin', totp: true });
      const superSession = await sessionFor(t().deps, superAdmin);
      const { user: target } = await createUser(t().deps);
      expect(target.reviewer_number).toBeNull();

      const res = await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        headers: superSession.headers,
        payload: { role: 'reviewer' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().reviewer_number).toBeGreaterThan(0);

      // Demote and promote again: the number is kept, not reissued.
      const number = res.json().reviewer_number as number;
      await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        headers: superSession.headers,
        payload: { role: 'player' },
      });
      const again = await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${target.id}`,
        headers: superSession.headers,
        payload: { role: 'reviewer' },
      });
      expect(again.json().reviewer_number).toBe(number);
    });

    it('disabling a user revokes their sessions and audits USER_STATUS_CHANGED', async () => {
      const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
      const adminSession = await sessionFor(t().deps, admin);
      const { user: victim } = await createUser(t().deps);
      const victimSession = await sessionFor(t().deps, victim);

      const res = await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${victim.id}`,
        headers: adminSession.headers,
        payload: { status: 'disabled', reason: 'abuse' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('disabled');
      expectError(await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: victimSession.headers }), 401, 'UNAUTHENTICATED');
      const events = await auditEvents('USER_STATUS_CHANGED');
      expect(events.some((e) => e.target_id === victim.id)).toBe(true);
    });

    it('never demotes or disables the last active super_admin', async () => {
      const a = await createUser(t().deps, { role: 'super_admin', totp: true });
      const b = await createUser(t().deps, { role: 'super_admin', totp: true });
      const sessionA = await sessionFor(t().deps, a.user);

      // While another active super_admin exists, demoting one works.
      const demoteB = await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/users/${b.user.id}`,
        headers: sessionA.headers,
        payload: { role: 'admin' },
      });
      expect(demoteB.statusCode).toBe(200);

      // Make A the only active super_admin in this database.
      await t().db
        .updateTable('users')
        .set({ status: 'disabled' })
        .where('role', '=', 'super_admin')
        .where('id', '!=', a.user.id)
        .execute();

      // A cannot demote or disable itself (self-change rule)…
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${a.user.id}`,
          headers: sessionA.headers,
          payload: { role: 'admin' },
        }),
        403,
        'FORBIDDEN',
      );
      // …no lesser role may touch a super_admin…
      const otherAdmin = await createUser(t().deps, { role: 'admin', totp: true });
      const adminSession = await sessionFor(t().deps, otherAdmin.user);
      expectError(
        await t().app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/users/${a.user.id}`,
          headers: adminSession.headers,
          payload: { status: 'disabled' },
        }),
        403,
        'FORBIDDEN',
      );
      // …and the dedicated guard refuses the change even for a privileged actor
      // (defense in depth, service level).
      const { UsersService } = await import('../../../src/modules/users/service');
      const service = new UsersService(t().deps);
      const fakeSuper = await createUser(t().deps, { role: 'super_admin', totp: true, status: 'active' });
      // fakeSuper is active, so first re-disable it to leave A as the last one, then act as it.
      await t().db.updateTable('users').set({ status: 'disabled' }).where('id', '=', fakeSuper.user.id).execute();
      const fakeRequest = { id: 'req-test', user: null, session: null } as never;
      await expect(
        service.updateUser(
          fakeRequest,
          { ...fakeSuper.user, email_verified: true, totp_enabled: true } as never,
          a.user.id,
          { role: 'admin' },
        ),
      ).rejects.toMatchObject({ code: 'INVALID_STATE' });

      // A stays the last active super_admin.
      const activeSupers = await t().db
        .selectFrom('users')
        .select('id')
        .where('role', '=', 'super_admin')
        .where('status', '=', 'active')
        .execute();
      expect(activeSupers.map((r) => r.id)).toEqual([a.user.id]);
    });

    it('blocks admins without 2FA via MFA enrollment', async () => {
      const { user: admin } = await createUser(t().deps, { role: 'admin' }); // no TOTP
      const session = await sessionFor(t().deps, admin);
      expectError(await t().app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: session.headers }), 403, 'MFA_ENROLLMENT_REQUIRED');
    });
  });
});
