/**
 * 2FA: TOTP enrollment, login with TOTP / recovery codes, replay protection,
 * mfa_token single use and expiry, role-based enrollment requirement.
 */
import { describe, expect, it } from 'vitest';

import { requirePermission } from '../../../src/auth/rbac';
import { generateTotpCode } from '../../../src/auth/totp';
import { recoveryCodeHash } from '../../../src/modules/auth/service';
import { MODULES } from '../../../src/modules';
import { createUser, expectError, sessionFor, useTestApp, DEFAULT_TEST_PASSWORD, type TestSession } from '../../helpers';

const authModules = MODULES.filter((m) => ['auth', 'users'].includes(m.name));

describe('two-factor authentication', () => {
  const t = useTestApp({
    now: '2026-09-29T12:00:00.000Z',
    modules: authModules,
    extend: (app) => {
      // A protected route for the MFA-enrollment check (a stand-in for any staff route).
      app.get('/api/v1/_test/protected', { preHandler: requirePermission('case:view_staff') }, async () => ({ ok: true }));
    },
  });

  async function login(email: string, password = DEFAULT_TEST_PASSWORD) {
    return t().app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  }

  async function login2fa(mfaToken: string, code: string) {
    return t().app.inject({ method: 'POST', url: '/api/v1/auth/login/2fa', payload: { mfa_token: mfaToken, code } });
  }

  async function auditCount(action: string, targetId: string): Promise<number> {
    const rows = await t().db
      .selectFrom('audit_events')
      .select('event_id')
      .where('action', '=', action)
      .where('target_id', '=', targetId)
      .execute();
    return rows.length;
  }

  // -------------------------------------------------------------------------
  // Login with TOTP
  // -------------------------------------------------------------------------

  it('runs the full TOTP login flow with replay protection', async () => {
    const { user, totpSecret } = await createUser(t().deps, { email: 'totp@example.test', totp: true });
    const first = await login('totp@example.test');
    expect(first.statusCode).toBe(200);
    const { mfa_required, mfa_token } = first.json();
    expect(mfa_required).toBe(true);
    expect(first.cookies.find((c) => c.name === 'stn_session')).toBeUndefined(); // no session yet

    const code = generateTotpCode(totpSecret!, t().clock.now());
    const done = await login2fa(mfa_token, code);
    expect(done.statusCode).toBe(200);
    const body = done.json();
    expect(body.session.mfa_verified).toBe(true);
    expect(done.cookies.find((c) => c.name === 'stn_session')).toBeDefined();
    expect(await auditCount('USER_LOGIN_SUCCEEDED', user.id)).toBe(1);

    // mfa_token is single use: replaying it after success fails.
    const replayToken = await login2fa(mfa_token, generateTotpCode(totpSecret!, t().clock.now()));
    expectError(replayToken, 401, 'MFA_TOKEN_INVALID');

    // Same TOTP step cannot be used again (fresh login, same code).
    const second = await login('totp@example.test');
    const replayCode = await login2fa(second.json().mfa_token, code);
    expectError(replayCode, 401, 'INVALID_MFA_CODE');

    // The next step works.
    t().clock.advance(30_000);
    const third = await login('totp@example.test');
    const nextCode = generateTotpCode(totpSecret!, t().clock.now());
    const ok = await login2fa(third.json().mfa_token, nextCode);
    expect(ok.statusCode).toBe(200);
  });

  it('does not consume the mfa_token on a wrong code, and expires it after 5 minutes', async () => {
    const { totpSecret } = await createUser(t().deps, { email: 'retry@example.test', totp: true });
    const res = await login('retry@example.test');
    const token = res.json().mfa_token as string;

    expectError(await login2fa(token, '000000'), 401, 'INVALID_MFA_CODE');
    const ok = await login2fa(token, generateTotpCode(totpSecret!, t().clock.now()));
    expect(ok.statusCode).toBe(200);

    const res2 = await login('retry@example.test');
    const token2 = res2.json().mfa_token as string;
    t().clock.advance(5 * 60_000 + 1000);
    expectError(await login2fa(token2, generateTotpCode(totpSecret!, t().clock.now())), 401, 'MFA_TOKEN_INVALID');
  });

  it('accepts a recovery code exactly once and audits its use', async () => {
    const { user } = await createUser(t().deps, { email: 'recovery@example.test', totp: true });
    const codes = ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'];
    await t().db
      .insertInto('user_recovery_codes')
      .values(codes.map((code) => ({ user_id: user.id, code_hash: recoveryCodeHash(code), created_at: t().clock.now() })))
      .execute();

    const res = await login('recovery@example.test');
    const done = await login2fa(res.json().mfa_token, 'aaaa-bbbb-cccc'); // case-insensitive
    expect(done.statusCode).toBe(200);
    expect(await auditCount('USER_RECOVERY_CODE_USED', user.id)).toBe(1);

    // Single use.
    const res2 = await login('recovery@example.test');
    expectError(await login2fa(res2.json().mfa_token, 'AAAA-BBBB-CCCC'), 401, 'INVALID_MFA_CODE');
    const res3 = await login('recovery@example.test');
    expect((await login2fa(res3.json().mfa_token, 'DDDD-EEEE-FFFF')).statusCode).toBe(200);
  });

  it('rejects a malformed mfa_token', async () => {
    expectError(await login2fa('not-a-real-token-1234567890', '123456'), 401, 'MFA_TOKEN_INVALID');
  });

  // -------------------------------------------------------------------------
  // Enrollment (setup / enable / disable / recovery codes)
  // -------------------------------------------------------------------------

  it('enrolls TOTP: setup, wrong code, enable with recovery codes, session effects', async () => {
    const { user } = await createUser(t().deps, { email: 'enroll@example.test' });
    const current = await sessionFor(t().deps, user);
    const other = await sessionFor(t().deps, user);

    const setup = await t().app.inject({ method: 'POST', url: '/api/v1/auth/2fa/setup', headers: current.headers });
    expect(setup.statusCode).toBe(200);
    const { secret, otpauth_uri } = setup.json();
    expect(otpauth_uri).toContain('otpauth://totp/');

    const bad = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enable',
      headers: current.headers,
      payload: { code: '000000' },
    });
    expectError(bad, 401, 'INVALID_MFA_CODE');

    const enable = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/enable',
      headers: current.headers,
      payload: { code: generateTotpCode(secret, t().clock.now()) },
    });
    expect(enable.statusCode).toBe(200);
    const recoveryCodes = enable.json().recovery_codes as string[];
    expect(recoveryCodes.length).toBe(10);
    expect(await auditCount('USER_2FA_ENABLED', user.id)).toBe(1);

    const row = await t().db.selectFrom('users').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(row.totp_enabled_at).not.toBeNull();
    expect(row.totp_secret_enc).not.toContain(secret); // stored encrypted

    // Other sessions revoked, current one marked mfa_verified.
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: other.headers }), 401, 'UNAUTHENTICATED');
    const session = await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: current.headers });
    expect(session.json().session.mfa_verified).toBe(true);

    // Setup again while enabled → conflict.
    expectError(await t().app.inject({ method: 'POST', url: '/api/v1/auth/2fa/setup', headers: current.headers }), 409, 'MFA_ALREADY_ENABLED');
  });

  it('refuses enable without setup, and expires the pending secret after 10 minutes', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/auth/2fa/enable', headers: session.headers, payload: { code: '123456' } }),
      409,
      'MFA_SETUP_NOT_STARTED',
    );

    const setup = await t().app.inject({ method: 'POST', url: '/api/v1/auth/2fa/setup', headers: session.headers });
    const { secret } = setup.json();
    t().clock.advance(10 * 60_000 + 1000);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/2fa/enable',
        headers: session.headers,
        payload: { code: generateTotpCode(secret, t().clock.now()) },
      }),
      409,
      'MFA_SETUP_NOT_STARTED',
    );
  });

  it('disables 2FA for players but refuses it for roles that require 2FA', async () => {
    const player = await createUser(t().deps, { totp: true });
    const playerSession = await sessionFor(t().deps, player.user);

    const wrongPw = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: playerSession.headers,
      payload: { password: 'wrong-password-1', code: generateTotpCode(player.totpSecret!, t().clock.now()) },
    });
    expectError(wrongPw, 400, 'PASSWORD_INCORRECT');

    const ok = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: playerSession.headers,
      payload: { password: DEFAULT_TEST_PASSWORD, code: generateTotpCode(player.totpSecret!, t().clock.now()) },
    });
    expect(ok.statusCode).toBe(200);
    const row = await t().db.selectFrom('users').selectAll().where('id', '=', player.user.id).executeTakeFirstOrThrow();
    expect(row.totp_secret_enc).toBeNull();
    expect(row.totp_enabled_at).toBeNull();
    expect(await auditCount('USER_2FA_DISABLED', player.user.id)).toBe(1);

    t().clock.advance(60_000);
    const reviewer = await createUser(t().deps, { role: 'reviewer', totp: true });
    const reviewerSession = await sessionFor(t().deps, reviewer.user);
    const refused = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/disable',
      headers: reviewerSession.headers,
      payload: { password: DEFAULT_TEST_PASSWORD, code: generateTotpCode(reviewer.totpSecret!, t().clock.now()) },
    });
    const body = expectError(refused, 403, 'FORBIDDEN');
    expect(body.message).toContain('required for your role');
  });

  it('regenerates recovery codes (old ones stop working) and requires password + code', async () => {
    const { user, totpSecret } = await createUser(t().deps, { totp: true });
    const session = await sessionFor(t().deps, user);
    await t().db
      .insertInto('user_recovery_codes')
      .values({ user_id: user.id, code_hash: recoveryCodeHash('OLDC-ODES-HERE'), created_at: t().clock.now() })
      .execute();

    const bad = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/recovery-codes',
      headers: session.headers,
      payload: { password: DEFAULT_TEST_PASSWORD, code: '000000' },
    });
    expectError(bad, 401, 'INVALID_MFA_CODE');

    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/recovery-codes',
      headers: session.headers,
      payload: { password: DEFAULT_TEST_PASSWORD, code: generateTotpCode(totpSecret!, t().clock.now()) },
    });
    expect(res.statusCode).toBe(200);
    const codes = res.json().recovery_codes as string[];
    expect(codes.length).toBe(10);

    const hashes = await t().db.selectFrom('user_recovery_codes').select('code_hash').where('user_id', '=', user.id).execute();
    expect(hashes.length).toBe(10);
    expect(hashes.map((h) => h.code_hash)).not.toContain(recoveryCodeHash('OLDC-ODES-HERE'));
    expect(hashes.map((h) => h.code_hash).sort()).toEqual(codes.map(recoveryCodeHash).sort());
  });

  it('refuses 2FA operations when not enabled', async () => {
    const { user } = await createUser(t().deps);
    const session = await sessionFor(t().deps, user);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/2fa/recovery-codes',
        headers: session.headers,
        payload: { password: DEFAULT_TEST_PASSWORD, code: '123456' },
      }),
      409,
      'MFA_NOT_ENABLED',
    );
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/2fa/disable',
        headers: session.headers,
        payload: { password: DEFAULT_TEST_PASSWORD, code: '123456' },
      }),
      409,
      'MFA_NOT_ENABLED',
    );
  });

  // -------------------------------------------------------------------------
  // Role-based enrollment requirement
  // -------------------------------------------------------------------------

  it('flags reviewer sessions without 2FA and blocks protected routes, but not /auth/* or /me', async () => {
    const { user } = await createUser(t().deps, { role: 'reviewer', email: 'needs2fa@example.test' });
    const res = await login('needs2fa@example.test');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mfa_required).toBe(false); // no 2FA enrolled yet
    expect(body.mfa_enrollment_required).toBe(true);

    const cookie = `stn_session=${res.cookies.find((c) => c.name === 'stn_session')!.value}`;
    const headers = { cookie, 'x-csrf-token': body.csrf_token as string };

    const blocked = await t().app.inject({ method: 'GET', url: '/api/v1/_test/protected', headers });
    expectError(blocked, 403, 'MFA_ENROLLMENT_REQUIRED');

    // /auth/* and /me stay usable so the user can enroll.
    expect((await t().app.inject({ method: 'GET', url: '/api/v1/auth/session', headers })).statusCode).toBe(200);
    expect((await t().app.inject({ method: 'GET', url: '/api/v1/me', headers })).statusCode).toBe(200);
    expect((await t().app.inject({ method: 'POST', url: '/api/v1/auth/2fa/setup', headers })).statusCode).toBe(200);

    // A reviewer WITH 2FA passes the protected route.
    const enrolled = await createUser(t().deps, { role: 'reviewer', totp: true });
    const enrolledSession: TestSession = await sessionFor(t().deps, enrolled.user);
    expect((await t().app.inject({ method: 'GET', url: '/api/v1/_test/protected', headers: enrolledSession.headers })).statusCode).toBe(200);
    expect(user.id).toBeDefined();
  });
});
