import { sign } from '@fastify/cookie';
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME } from '@scpsl-trust/shared';

import { SESSION_REFRESH_THROTTLE_MS } from '../../src/auth/user-session';
import { randomToken } from '../../src/lib/crypto';
import { networkHashes } from '../../src/lib/ip';
import { createUser, expectError, sessionFor, useTestApp, type TestApp } from '../helpers';
import { registerWebTestRoutes, TEST_ROUTES } from './support/web-routes';

async function me(t: TestApp, cookie: string) {
  return t.app.inject({ method: 'GET', url: TEST_ROUTES.me, headers: { cookie } });
}

describe('web sessions', () => {
  const t = useTestApp({ modules: [], extend: registerWebTestRoutes });

  it('authenticates a session cookie and populates request.user / request.session', async () => {
    const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await sessionFor(t().deps, user);
    const res = await me(t(), session.cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: Record<string, unknown>; session: Record<string, unknown> };
    expect(body.user).toEqual({
      id: user.id,
      email: user.email,
      username: user.username,
      role: 'reviewer',
      status: 'active',
      email_verified: true,
      totp_enabled: true,
      player_id: null,
      reviewer_number: user.reviewer_number,
    });
    expect(body.session).toMatchObject({ id: session.sessionId, mfa_verified: true, mfa_enrollment_required: false });
  });

  it('flags staff sessions without 2FA for enrollment, but not players', async () => {
    const reviewer = (await createUser(t().deps, { role: 'reviewer' })).user;
    const player = (await createUser(t().deps, { role: 'player' })).user;
    const reviewerSession = (await me(t(), (await sessionFor(t().deps, reviewer)).cookie)).json() as { session: { mfa_enrollment_required: boolean } };
    const playerSession = (await me(t(), (await sessionFor(t().deps, player)).cookie)).json() as { session: { mfa_enrollment_required: boolean } };
    expect(reviewerSession.session.mfa_enrollment_required).toBe(true);
    expect(playerSession.session.mfa_enrollment_required).toBe(false);
  });

  it('rejects missing, unsigned, tampered and unknown cookies (and clears them)', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    expectError(await t().app.inject({ method: 'GET', url: TEST_ROUTES.me }), 401, 'UNAUTHENTICATED');

    const unsigned = await me(t(), `${SESSION_COOKIE_NAME}=${session.token}`);
    expectError(unsigned, 401, 'UNAUTHENTICATED');
    expect(String(unsigned.headers['set-cookie'])).toContain(`${SESSION_COOKIE_NAME}=;`);

    const tampered = session.cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expectError(await me(t(), tampered), 401, 'UNAUTHENTICATED');

    const forged = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sign(randomToken(32), 'not-the-session-secret'))}`;
    expectError(await me(t(), forged), 401, 'UNAUTHENTICATED');

    const unknown = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sign(randomToken(32), t().config.secrets.sessionSecret))}`;
    expectError(await me(t(), unknown), 401, 'UNAUTHENTICATED');

    const garbage = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sign("x' OR '1'='1", t().config.secrets.sessionSecret))}`;
    expectError(await me(t(), garbage), 401, 'UNAUTHENTICATED');
  });

  it('stores only a token hash and a network hash of the client IP', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user, { ip: '203.0.113.77', user_agent: `ua\u0000${'x'.repeat(400)}` });
    const row = await t().db.selectFrom('sessions').selectAll().where('id', '=', session.sessionId).executeTakeFirstOrThrow();
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.token_hash).not.toContain(session.token);
    expect(row.ip_hash).toBe(networkHashes('203.0.113.77', t().config.secrets.ipHashSecret)?.network_hash);
    expect(JSON.stringify(row)).not.toContain('203.0.113.77');
    expect(row.user_agent?.length).toBe(256);
    expect(row.user_agent).not.toContain('\u0000');
  });

  it('sets a hardened cookie on login and clears it on logout', async () => {
    const { user } = await createUser(t().deps);
    const login = await t().app.inject({ method: 'POST', url: TEST_ROUTES.login, payload: { user_id: user.id } });
    expect(login.statusCode).toBe(200);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`));
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('Expires=');
    const cookie = setCookie.split(';')[0] ?? '';
    const { csrf_token: csrfToken } = login.json() as { csrf_token: string };
    expect((await me(t(), cookie)).statusCode).toBe(200);

    const logout = await t().app.inject({ method: 'POST', url: TEST_ROUTES.logout, headers: { cookie, 'x-csrf-token': csrfToken } });
    expect(logout.statusCode).toBe(200);
    expect(String(logout.headers['set-cookie'])).toContain(`${SESSION_COOKIE_NAME}=;`);
    expectError(await me(t(), cookie), 401, 'UNAUTHENTICATED');
  });

  it('expires idle sessions and slides the idle window on use', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    const idleMs = t().config.session.idleTimeoutMinutes * 60_000;
    const start = t().clock.now().getTime();
    try {
      t().clock.set(start + idleMs - 60_000);
      expect((await me(t(), session.cookie)).statusCode).toBe(200);
      // The window slid: another idle period minus a minute later it is still valid.
      t().clock.set(start + 2 * idleMs - 120_000);
      expect((await me(t(), session.cookie)).statusCode).toBe(200);
      t().clock.set(start + 3 * idleMs);
      expectError(await me(t(), session.cookie), 401, 'UNAUTHENTICATED');
    } finally {
      t().clock.set(start);
    }
  });

  it('throttles last_seen_at refreshes', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    const start = t().clock.now().getTime();
    try {
      t().clock.set(start + SESSION_REFRESH_THROTTLE_MS - 1);
      await me(t(), session.cookie);
      let row = await t().db.selectFrom('sessions').selectAll().where('id', '=', session.sessionId).executeTakeFirstOrThrow();
      expect(row.last_seen_at.getTime()).toBe(start);
      t().clock.set(start + SESSION_REFRESH_THROTTLE_MS);
      await me(t(), session.cookie);
      row = await t().db.selectFrom('sessions').selectAll().where('id', '=', session.sessionId).executeTakeFirstOrThrow();
      expect(row.last_seen_at.getTime()).toBe(start + SESSION_REFRESH_THROTTLE_MS);
    } finally {
      t().clock.set(start);
    }
  });

  it('revokes single, other and all sessions', async () => {
    const { user } = await createUser(t().deps);
    const a = await sessionFor(t().deps, user);
    const b = await sessionFor(t().deps, user);
    const c = await sessionFor(t().deps, user);
    const { sessions } = t().deps;

    expect(await sessions.revokeSession(t().db, a.sessionId, 'user_revoked')).toBe(true);
    expect(await sessions.revokeSession(t().db, a.sessionId, 'user_revoked')).toBe(false);
    expectError(await me(t(), a.cookie), 401, 'UNAUTHENTICATED');

    expect(await sessions.revokeOtherSessions(t().db, user.id, b.sessionId, 'password_changed')).toBe(1);
    expect((await me(t(), b.cookie)).statusCode).toBe(200);
    expectError(await me(t(), c.cookie), 401, 'UNAUTHENTICATED');

    expect(await sessions.revokeAllSessions(t().db, user.id, 'account_disabled')).toBe(1);
    expectError(await me(t(), b.cookie), 401, 'UNAUTHENTICATED');
    const row = await t().db.selectFrom('sessions').selectAll().where('id', '=', b.sessionId).executeTakeFirstOrThrow();
    expect(row.revoked_reason).toBe('account_disabled');
  });

  it('answers ACCOUNT_DISABLED for sessions of disabled users', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    await t().db.updateTable('users').set({ status: 'disabled' }).where('id', '=', user.id).execute();
    expectError(await me(t(), session.cookie), 403, 'ACCOUNT_DISABLED');
  });
});

describe('absolute session lifetime', () => {
  const t = useTestApp({
    modules: [],
    extend: registerWebTestRoutes,
    env: { SESSION_TTL_HOURS: '1', SESSION_IDLE_TIMEOUT_MINUTES: '50' },
  });

  it('ends a session at expires_at even while it is being used', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    const start = t().clock.now().getTime();
    t().clock.set(start + 40 * 60_000);
    expect((await me(t(), session.cookie)).statusCode).toBe(200);
    const row = await t().db.selectFrom('sessions').selectAll().where('id', '=', session.sessionId).executeTakeFirstOrThrow();
    // Idle expiry is capped by the absolute expiry.
    expect(row.idle_expires_at.getTime()).toBe(row.expires_at.getTime());
    t().clock.set(start + 59 * 60_000);
    expect((await me(t(), session.cookie)).statusCode).toBe(200);
    t().clock.set(start + 60 * 60_000);
    expectError(await me(t(), session.cookie), 401, 'UNAUTHENTICATED');
  });
});
