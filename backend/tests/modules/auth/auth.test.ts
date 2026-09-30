/**
 * Auth module: registration, email verification, login, lockout, sessions, passwords.
 * 2FA flows live in twofactor.test.ts.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { MODULES } from '../../../src/modules';
import { buildTestApp, createUser, expectError, sessionFor, useTestApp, DEFAULT_TEST_PASSWORD } from '../../helpers';

const authModules = MODULES.filter((m) => ['auth', 'users'].includes(m.name));

function mailToken(text: string): string {
  const match = text.match(/token=([A-Za-z0-9_-]+)/);
  expect(match).not.toBeNull();
  return match![1]!;
}

function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  const cookie = res.cookies.find((c) => c.name === 'stn_session');
  expect(cookie).toBeDefined();
  return `stn_session=${cookie!.value}`;
}

describe('auth module', () => {
  const t = useTestApp({
    now: '2026-09-29T12:00:00.000Z',
    modules: authModules,
    env: { EMAIL_VERIFICATION_REQUIRED: 'true', ALLOW_REGISTRATION: 'true' },
  });

  beforeEach(() => {
    t().mailer.clear();
  });

  async function auditEvents(action: import('@scpsl-trust/shared').AuditAction) {
    return t().db.selectFrom('audit_events').selectAll().where('action', '=', action).orderBy('seq', 'asc').execute();
  }

  // -------------------------------------------------------------------------
  // Registration & verification
  // -------------------------------------------------------------------------

  describe('registration', () => {
    it('creates a player account, sends a verification mail and audits it', async () => {
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'Alice@Example.com', username: 'alice_1', password: 'sup3r-secret-pw' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.email_verification_required).toBe(true);

      const user = await t().db.selectFrom('users').selectAll().where('id', '=', body.user_id).executeTakeFirstOrThrow();
      expect(user.email).toBe('alice@example.com'); // stored lowercase
      expect(user.role).toBe('player');
      expect(user.email_verified_at).toBeNull();
      expect(user.password_hash.startsWith('$argon2id$')).toBe(true);

      const mail = t().mailer.lastTo('alice@example.com');
      expect(mail).toBeDefined();
      expect(mail!.text).toContain('/verify-email?token=');

      const events = await auditEvents('USER_REGISTERED');
      expect(events.some((e) => e.target_id === body.user_id)).toBe(true);
    });

    it('rejects duplicate email and case-insensitive duplicate username', async () => {
      const { user } = await createUser(t().deps, { email: 'dup@example.test', username: 'dupuser' });
      const dupEmail = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'DUP@example.test', username: 'other_name', password: 'sup3r-secret-pw' },
      });
      expectError(dupEmail, 409, 'ALREADY_EXISTS');
      const dupName = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'fresh@example.test', username: 'DupUser', password: 'sup3r-secret-pw' },
      });
      expectError(dupName, 409, 'ALREADY_EXISTS');
      expect(user.id).toBeDefined();
    });

    it('rejects weak passwords and passwords equal to identity', async () => {
      const weak = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'weak@example.test', username: 'weakuser', password: "aaaaaaaaaaa" },
      });
      expectError(weak, 400, 'PASSWORD_TOO_WEAK');
      const identity = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'ident@example.test', username: 'identuser1', password: 'identuser1' },
      });
      expectError(identity, 400, 'VALIDATION_FAILED'); // shared schema refine
      const invalid = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'not-an-email', username: 'x', password: 'short' },
      });
      expectError(invalid, 400, 'VALIDATION_FAILED');
    });

    it('is refused when registration is disabled', async () => {
      const closed = await buildTestApp({ modules: authModules, env: { ALLOW_REGISTRATION: 'false' } });
      try {
        const res = await closed.app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email: 'nope@example.test', username: 'nopeuser', password: 'sup3r-secret-pw' },
        });
        expectError(res, 403, 'REGISTRATION_DISABLED');
      } finally {
        await closed.close();
      }
    });
  });

  describe('email verification', () => {
    it('requires verification before login, verifies single-use, then allows login', async () => {
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'verify@example.test', username: 'verifyme', password: 'sup3r-secret-pw' },
      });
      const blocked = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'verify@example.test', password: 'sup3r-secret-pw' },
      });
      expectError(blocked, 403, 'EMAIL_NOT_VERIFIED');

      const token = mailToken(t().mailer.lastTo('verify@example.test')!.text);
      const ok = await t().app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
      expect(ok.statusCode).toBe(200);
      expect((await auditEvents('USER_EMAIL_VERIFIED')).length).toBeGreaterThan(0);

      const reuse = await t().app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
      expectError(reuse, 400, 'TOKEN_INVALID');

      const login = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'verify@example.test', password: 'sup3r-secret-pw' },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json().mfa_required).toBe(false);
    });

    it('rejects expired verification tokens', async () => {
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: 'stale@example.test', username: 'staleuser', password: 'sup3r-secret-pw' },
      });
      const token = mailToken(t().mailer.lastTo('stale@example.test')!.text);
      t().clock.advance(25 * 3_600_000);
      const res = await t().app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
      expectError(res, 400, 'TOKEN_INVALID');
    });

    it('resend-verification always answers 202 and only mails unverified accounts', async () => {
      const unknown = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        payload: { email: 'ghost@example.test' },
      });
      expect(unknown.statusCode).toBe(202);
      expect(t().mailer.sent.length).toBe(0);

      await createUser(t().deps, { email: 'resend@example.test', verified: false });
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        payload: { email: 'resend@example.test' },
      });
      expect(res.statusCode).toBe(202);
      expect(t().mailer.lastTo('resend@example.test')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Login & lockout
  // -------------------------------------------------------------------------

  describe('login', () => {
    it('succeeds, sets the session cookie, returns csrf token and audits', async () => {
      const { user } = await createUser(t().deps, { email: 'login@example.test' });
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'login@example.test', password: DEFAULT_TEST_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.mfa_required).toBe(false);
      expect(body.user.id).toBe(user.id);
      expect(body.csrf_token.length).toBeGreaterThan(10);
      expect(body.session.mfa_verified).toBe(false);
      expect(body.user).not.toHaveProperty('password_hash');
      const cookie = sessionCookie(res);

      // The cookie authenticates GET /auth/session.
      const session = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
      expect(session.statusCode).toBe(200);
      expect(session.json().user.id).toBe(user.id);

      const events = await auditEvents('USER_LOGIN_SUCCEEDED');
      expect(events.some((e) => e.target_id === user.id)).toBe(true);
      const row = await t().db.selectFrom('users').select('last_login_at').where('id', '=', user.id).executeTakeFirstOrThrow();
      expect(row.last_login_at).not.toBeNull();
    });

    it('answers wrong password and unknown email identically (401, timed dummy verify)', async () => {
      await createUser(t().deps, { email: 'known@example.test' });
      const wrong = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'known@example.test', password: 'definitely-wrong-pw' },
      });
      const wrongBody = expectError(wrong, 401, 'INVALID_CREDENTIALS');

      const start = process.hrtime.bigint();
      const unknown = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'ghost-user@example.test', password: 'definitely-wrong-pw' },
      });
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
      const unknownBody = expectError(unknown, 401, 'INVALID_CREDENTIALS');
      expect(unknownBody.message).toBe(wrongBody.message);
      // The dummy argon2 verification was executed (equal timing, §12.2).
      expect(elapsedMs).toBeGreaterThan(5);

      // Unknown-account failures are audited without the email address.
      const failures = await auditEvents('USER_LOGIN_FAILED');
      const anonymous = failures.filter((e) => e.target_id === null);
      expect(anonymous.length).toBeGreaterThan(0);
      for (const event of anonymous) {
        expect(JSON.stringify(event.metadata)).not.toContain('ghost-user');
      }
    });

    it('refuses disabled accounts', async () => {
      await createUser(t().deps, { email: 'off@example.test', status: 'disabled' });
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'off@example.test', password: DEFAULT_TEST_PASSWORD },
      });
      expectError(res, 403, 'ACCOUNT_DISABLED');
    });

    it('locks after LOGIN_MAX_FAILURES with exponential backoff and unlocks over time', async () => {
      const { user } = await createUser(t().deps, { email: 'lock@example.test' });
      for (let i = 0; i < 5; i += 1) {
        const res = await t().app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'lock@example.test', password: 'wrong-password-x' },
        });
        expectError(res, 401, 'INVALID_CREDENTIALS');
      }
      expect((await auditEvents('USER_LOCKED')).some((e) => e.target_id === user.id)).toBe(true);

      // Locked: even the correct password is refused with retry_after.
      const locked = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'lock@example.test', password: DEFAULT_TEST_PASSWORD },
      });
      const lockedBody = expectError(locked, 423, 'ACCOUNT_LOCKED');
      const retryAfter = (lockedBody.details as { retry_after: number }).retry_after;
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);

      // After the 15 minute lock a new failure locks for 30 minutes (2^1 backoff).
      t().clock.advance(15 * 60_000 + 1000);
      const fail6 = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'lock@example.test', password: 'wrong-password-x' },
      });
      expectError(fail6, 401, 'INVALID_CREDENTIALS');
      const row = await t().db.selectFrom('users').select(['locked_until']).where('id', '=', user.id).executeTakeFirstOrThrow();
      const lockMs = row.locked_until!.getTime() - t().clock.now().getTime();
      expect(lockMs).toBeGreaterThan(29 * 60_000);
      expect(lockMs).toBeLessThanOrEqual(30 * 60_000);

      // Unlock after the backoff window; success resets the counter.
      t().clock.advance(30 * 60_000 + 1000);
      const ok = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'lock@example.test', password: DEFAULT_TEST_PASSWORD },
      });
      expect(ok.statusCode).toBe(200);
      const reset = await t().db
        .selectFrom('users')
        .select(['failed_login_count', 'locked_until'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow();
      expect(reset.failed_login_count).toBe(0);
      expect(reset.locked_until).toBeNull();
    });

    it('applies the per-IP auth rate limit', async () => {
      const limited = await buildTestApp({ modules: authModules, env: { RATE_LIMIT_AUTH_PER_MINUTE: '3' } });
      try {
        let last: Awaited<ReturnType<typeof limited.app.inject>> | undefined;
        for (let i = 0; i < 4; i += 1) {
          last = await limited.app.inject({
            method: 'POST',
            url: '/api/v1/auth/login',
            payload: { email: 'rl@example.test', password: 'whatever-pw-1' },
          });
        }
        expectError(last!, 429, 'RATE_LIMITED');
      } finally {
        await limited.close();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Session endpoints
  // -------------------------------------------------------------------------

  describe('sessions', () => {
    it('GET /auth/session is 401 when anonymous', async () => {
      const res = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session' });
      expectError(res, 401, 'UNAUTHENTICATED');
    });

    it('logout requires CSRF, revokes the session and audits', async () => {
      const { user } = await createUser(t().deps);
      const session = await sessionFor(t().deps, user);

      const noCsrf = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { cookie: session.headers['cookie']! },
      });
      expectError(noCsrf, 403, 'CSRF_TOKEN_INVALID');

      const res = await t().app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: session.headers });
      expect(res.statusCode).toBe(200);
      const after = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: session.headers['cookie']! } });
      expectError(after, 401, 'UNAUTHENTICATED');
      expect((await auditEvents('USER_LOGOUT')).length).toBeGreaterThan(0);
    });

    it('lists own sessions with a current flag and revokes only own sessions', async () => {
      const { user } = await createUser(t().deps);
      const other = await createUser(t().deps);
      const s1 = await sessionFor(t().deps, user);
      const s2 = await sessionFor(t().deps, user);
      const foreign = await sessionFor(t().deps, other.user);

      const list = await t().app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: s1.headers });
      expect(list.statusCode).toBe(200);
      const items = list.json().items as Array<{ id: string; current: boolean }>;
      expect(items.length).toBe(2);
      expect(items.find((i) => i.id === s1.sessionId)!.current).toBe(true);
      expect(items.find((i) => i.id === s2.sessionId)!.current).toBe(false);

      // Another user's session reads as 404 (no enumeration).
      const stranger = await t().app.inject({
        method: 'POST',
        url: `/api/v1/auth/sessions/${foreign.sessionId}/revoke`,
        headers: s1.headers,
      });
      expectError(stranger, 404, 'NOT_FOUND');
      const foreignStillWorks = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: foreign.headers });
      expect(foreignStillWorks.statusCode).toBe(200);

      const revoke = await t().app.inject({
        method: 'POST',
        url: `/api/v1/auth/sessions/${s2.sessionId}/revoke`,
        headers: s1.headers,
      });
      expect(revoke.statusCode).toBe(200);
      const s2Dead = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: s2.headers });
      expectError(s2Dead, 401, 'UNAUTHENTICATED');
      expect((await auditEvents('SESSION_REVOKED')).some((e) => e.target_id === s2.sessionId)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Password reset & change
  // -------------------------------------------------------------------------

  describe('password reset', () => {
    it('forgot always answers 202; reset is single use, revokes sessions and clears lockout', async () => {
      const unknown = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/forgot',
        payload: { email: 'nobody@example.test' },
      });
      expect(unknown.statusCode).toBe(202);
      expect(t().mailer.sent.length).toBe(0);

      const { user } = await createUser(t().deps, {
        email: 'reset@example.test',
        lockedUntil: new Date(t().clock.now().getTime() + 3_600_000),
      });
      const session = await sessionFor(t().deps, user);

      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/forgot',
        payload: { email: 'reset@example.test' },
      });
      expect(res.statusCode).toBe(202);
      const token = mailToken(t().mailer.lastTo('reset@example.test')!.text);

      const reset = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        payload: { token, password: 'brand-new-pw-42' },
      });
      expect(reset.statusCode).toBe(200);
      expect((await auditEvents('USER_PASSWORD_RESET')).some((e) => e.target_id === user.id)).toBe(true);

      // All sessions are revoked; the lockout is cleared; the new password works.
      const dead = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: session.headers });
      expectError(dead, 401, 'UNAUTHENTICATED');
      const login = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'reset@example.test', password: 'brand-new-pw-42' },
      });
      expect(login.statusCode).toBe(200);

      // Single use.
      const reuse = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        payload: { token, password: 'another-new-pw-43' },
      });
      expectError(reuse, 400, 'TOKEN_INVALID');
    });

    it('rejects expired reset tokens', async () => {
      await createUser(t().deps, { email: 'expired@example.test' });
      await t().app.inject({ method: 'POST', url: '/api/v1/auth/password/forgot', payload: { email: 'expired@example.test' } });
      const token = mailToken(t().mailer.lastTo('expired@example.test')!.text);
      t().clock.advance(61 * 60_000);
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/reset',
        payload: { token, password: 'brand-new-pw-42' },
      });
      expectError(res, 400, 'TOKEN_INVALID');
    });

    it('change requires the current password and CSRF, and revokes other sessions', async () => {
      const { user } = await createUser(t().deps);
      const current = await sessionFor(t().deps, user);
      const other = await sessionFor(t().deps, user);

      const noCsrf = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/change',
        headers: { cookie: current.headers['cookie']! },
        payload: { current_password: DEFAULT_TEST_PASSWORD, new_password: 'changed-pw-101' },
      });
      expectError(noCsrf, 403, 'CSRF_TOKEN_INVALID');

      const wrong = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/change',
        headers: current.headers,
        payload: { current_password: 'not-my-password', new_password: 'changed-pw-101' },
      });
      expectError(wrong, 400, 'PASSWORD_INCORRECT');

      const ok = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/password/change',
        headers: current.headers,
        payload: { current_password: DEFAULT_TEST_PASSWORD, new_password: 'changed-pw-101' },
      });
      expect(ok.statusCode).toBe(200);
      expect((await auditEvents('USER_PASSWORD_CHANGED')).some((e) => e.target_id === user.id)).toBe(true);

      const otherDead = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: other.headers });
      expectError(otherDead, 401, 'UNAUTHENTICATED');
      const currentAlive = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: current.headers });
      expect(currentAlive.statusCode).toBe(200);
    });
  });
});
