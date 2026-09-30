import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createContainer } from '../../src/container';
import { createDatabase } from '../../src/db/kysely';
import { createSilentLogger } from '../../src/lib/logger';
import { NoopMailer } from '../../src/mail';
import { expectError, testEnv, useTestApp, TEST_WEB_ORIGIN } from '../helpers';

describe('health, time and request context', () => {
  const t = useTestApp({ now: '2026-09-29T15:42:20.123Z' });

  it('GET /healthz is always ok and not cacheable', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /readyz reports database ok and redis disabled', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok', redis: 'disabled' } });
  });

  it('GET /api/v1/time returns the backend clock', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/time' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ server_time: '2026-09-29T15:42:20.123Z', epoch_ms: Date.parse('2026-09-29T15:42:20.123Z') });
  });

  it('adopts a valid X-Request-Id only for (claimed) signed requests and replaces invalid ones', async () => {
    const id = randomUUID();
    const adopted = await t().app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': id, 'x-signature': 'sig' } });
    expect(adopted.headers['x-request-id']).toBe(id);
    // Web requests (no signature, or with cookies) never choose their audited request id.
    const web = await t().app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': id } });
    expect(web.headers['x-request-id']).not.toBe(id);
    const withCookie = await t().app.inject({
      method: 'GET',
      url: '/healthz',
      headers: { 'x-request-id': id, 'x-signature': 'sig', cookie: 'stn_session=x' },
    });
    expect(withCookie.headers['x-request-id']).not.toBe(id);

    for (const bad of ['not-a-uuid', `${id}\r\nx-injected: 1`, 'a'.repeat(300), '00000000-0000-1000-8000-000000000000']) {
      const res = await t().app.inject({ method: 'GET', url: '/healthz', headers: { 'x-request-id': bad } });
      expect(res.headers['x-request-id']).not.toBe(bad);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('sets strict security headers', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/time' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for WEB_ORIGIN, with credentials', async () => {
    const allowed = await t().app.inject({
      method: 'OPTIONS',
      url: '/api/v1/time',
      headers: { origin: TEST_WEB_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await t().app.inject({
      method: 'OPTIONS',
      url: '/api/v1/time',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers unknown routes with the error shape', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expectError(res, 404, 'NOT_FOUND');
  });

  it('serves the OpenAPI 3.1 document', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/docs/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { openapi: string; paths: Record<string, unknown>; components: { securitySchemes: object } };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/api/v1/admin/audit', '/api/v1/time']));
    expect(Object.keys(doc.components.securitySchemes)).toEqual(
      expect.arrayContaining(['sessionCookie', 'csrfToken', 'serverSignature']),
    );
    // Swagger UI is disabled in the test configuration.
    const ui = await t().app.inject({ method: 'GET', url: '/api/docs' });
    expect(ui.statusCode).toBe(404);
  });
});

describe('readiness failures', () => {
  it('GET /readyz is 503 SERVICE_UNAVAILABLE when the database is unreachable', async () => {
    const config = loadConfig(testEnv({ DATABASE_URL: 'postgres://scpsl:scpsl@127.0.0.1:1/unreachable' }));
    const handle = createDatabase({ connectionString: config.database.url, connectionTimeoutMs: 500 });
    const deps = createContainer(config, {
      database: { db: handle.db, pool: handle.pool },
      logger: createSilentLogger(),
      mailer: new NoopMailer(),
    });
    const app = await buildApp(deps, { modules: [] });
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      const error = expectError(res, 503, 'SERVICE_UNAVAILABLE');
      expect(error.details).toEqual({ checks: { database: 'error', redis: 'disabled' } });
      // Liveness is unaffected.
      expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    } finally {
      await app.close();
      await deps.close();
      await handle.destroy();
    }
  });
});
