import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { csrfTokenFor } from '../../src/auth/csrf';
import { createUser, expectError, sessionFor, TEST_PUBLIC_BASE_URL, TEST_WEB_ORIGIN, useTestApp, type TestSession } from '../helpers';
import { registerWebTestRoutes, TEST_ROUTES } from './support/web-routes';

describe('CSRF protection', () => {
  const t = useTestApp({ modules: [], extend: registerWebTestRoutes });

  async function session(): Promise<TestSession> {
    const { user } = await createUser(t().deps);
    return sessionFor(t().deps, user);
  }

  it('derives the token as base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:" + session id))', () => {
    const expected = createHmac('sha256', 'secret').update('csrf:v1:abc').digest('base64url');
    expect(csrfTokenFor('abc', 'secret')).toBe(expected);
    expect(csrfTokenFor('abd', 'secret')).not.toBe(expected);
  });

  it('allows safe methods without a token', async () => {
    const s = await session();
    expect((await t().app.inject({ method: 'GET', url: TEST_ROUTES.me, headers: { cookie: s.cookie } })).statusCode).toBe(200);
    expect((await t().app.inject({ method: 'HEAD', url: TEST_ROUTES.me, headers: { cookie: s.cookie } })).statusCode).toBe(200);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('requires a valid X-CSRF-Token for cookie-authenticated %s', async (method) => {
    const s = await session();
    const other = await session();
    expectError(await t().app.inject({ method, url: TEST_ROUTES.state, headers: { cookie: s.cookie } }), 403, 'CSRF_TOKEN_INVALID');
    expectError(
      await t().app.inject({ method, url: TEST_ROUTES.state, headers: { cookie: s.cookie, 'x-csrf-token': 'wrong' } }),
      403,
      'CSRF_TOKEN_INVALID',
    );
    expectError(
      await t().app.inject({ method, url: TEST_ROUTES.state, headers: { cookie: s.cookie, 'x-csrf-token': other.csrfToken } }),
      403,
      'CSRF_TOKEN_INVALID',
    );
    expectError(
      await t().app.inject({ method, url: TEST_ROUTES.state, headers: { cookie: s.cookie, 'x-csrf-token': 'x'.repeat(5000) } }),
      403,
      'CSRF_TOKEN_INVALID',
    );
    const ok = await t().app.inject({ method, url: TEST_ROUTES.state, headers: s.headers });
    expect(ok.statusCode).toBe(200);
  });

  it('checks Origin and Referer against WEB_ORIGIN and the API origin', async () => {
    const s = await session();
    const post = (headers: Record<string, string>) =>
      t().app.inject({ method: 'POST', url: TEST_ROUTES.state, headers: { ...s.headers, ...headers } });
    expect((await post({ origin: TEST_WEB_ORIGIN })).statusCode).toBe(200);
    expect((await post({ origin: TEST_PUBLIC_BASE_URL })).statusCode).toBe(200);
    expect((await post({ referer: `${TEST_WEB_ORIGIN}/cases/CASE-2026-000001` })).statusCode).toBe(200);
    expectError(await post({ origin: 'https://evil.example' }), 403, 'CSRF_TOKEN_INVALID');
    expectError(await post({ origin: 'null' }), 403, 'CSRF_TOKEN_INVALID');
    expectError(await post({ origin: `${TEST_WEB_ORIGIN}.evil.example` }), 403, 'CSRF_TOKEN_INVALID');
    expectError(await post({ referer: 'https://evil.example/page' }), 403, 'CSRF_TOKEN_INVALID');
    // Origin wins over Referer.
    expectError(await post({ origin: 'https://evil.example', referer: `${TEST_WEB_ORIGIN}/` }), 403, 'CSRF_TOKEN_INVALID');
  });

  it('applies the Origin check to anonymous requests (login CSRF)', async () => {
    expect((await t().app.inject({ method: 'POST', url: TEST_ROUTES.anonymous })).statusCode).toBe(200);
    expectError(
      await t().app.inject({ method: 'POST', url: TEST_ROUTES.anonymous, headers: { origin: 'https://evil.example' } }),
      403,
      'CSRF_TOKEN_INVALID',
    );
  });

  it('exempts signed plugin requests without cookies but not with a session cookie', async () => {
    const pluginLike = await t().app.inject({
      method: 'POST',
      url: TEST_ROUTES.anonymous,
      headers: { 'x-signature': 'AAAA', origin: 'https://evil.example' },
    });
    expect(pluginLike.statusCode).toBe(200);

    const s = await session();
    const withCookie = await t().app.inject({
      method: 'POST',
      url: TEST_ROUTES.state,
      headers: { cookie: s.cookie, 'x-signature': 'AAAA' },
    });
    expectError(withCookie, 403, 'CSRF_TOKEN_INVALID');
  });

  it('does not require a token when the cookie does not resolve to a session', async () => {
    const s = await session();
    await t().deps.sessions.revokeSession(t().db, s.sessionId, 'logout');
    // Anonymous now: requireAuth answers, not the CSRF check.
    expectError(await t().app.inject({ method: 'POST', url: TEST_ROUTES.state, headers: { cookie: s.cookie } }), 401, 'UNAUTHENTICATED');
  });
});
