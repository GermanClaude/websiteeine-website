import { Writable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AppError } from '../../src/lib/errors';
import { buildTestApp, expectError, useTestApp } from '../helpers';

function routes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/api/v1/_test/app-error', async () => {
    throw new AppError('CONFLICT_OF_INTEREST', 'You reported this case', { case: 'CASE-2026-000001' });
  });
  r.get('/api/v1/_test/app-error-500', async () => {
    throw new AppError('INTERNAL_ERROR', 'leaky internal detail /etc/passwd', { secret: 'x' });
  });
  r.get('/api/v1/_test/crash', async () => {
    throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db:5432');
  });
  r.get('/api/v1/_test/unique', async () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint "x"'), { code: '23505', constraint: 'x' });
  });
  r.get('/api/v1/_test/forbidden-op', async () => {
    throw Object.assign(new Error('history is immutable'), { code: 'TN403' });
  });
  r.post(
    '/api/v1/_test/validate/:id',
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        querystring: z.object({ mode: z.enum(['a', 'b']).optional() }),
        body: z.object({ player: z.object({ id: z.string().min(3) }), count: z.number().int() }),
      },
    },
    async () => ({ ok: true }),
  );
  r.get(
    '/api/v1/_test/bad-response',
    { schema: { response: { 200: z.object({ id: z.uuid() }) } } },
    async () => ({ id: 'not-a-uuid', password_hash: 'secret' }) as unknown as { id: string },
  );
  r.get(
    '/api/v1/_test/strip-response',
    { schema: { response: { 200: z.object({ id: z.string() }) } } },
    async () => ({ id: 'a', password_hash: 'never-leaks' }),
  );
  r.post('/api/v1/_test/echo', async (request) => ({ body: request.body ?? null, raw_length: request.rawBody?.length ?? null }));
}

const VALID_UUID = '0b9f1e7c-2a4d-4c6e-8f10-3a5b7c9d1e2f';

describe('error handler', () => {
  const t = useTestApp({ modules: [], extend: routes });

  it('maps AppError to its catalogue status with message and details', async () => {
    const error = expectError(await t().app.inject({ method: 'GET', url: '/api/v1/_test/app-error' }), 409, 'CONFLICT_OF_INTEREST');
    expect(error.message).toBe('You reported this case');
    expect(error.details).toEqual({ case: 'CASE-2026-000001' });
  });

  it('never exposes messages or details of 5xx errors', async () => {
    const appError = expectError(await t().app.inject({ method: 'GET', url: '/api/v1/_test/app-error-500' }), 500, 'INTERNAL_ERROR');
    expect(appError.message).toBe('Internal server error');
    expect(appError.details).toBeUndefined();

    const crash = await t().app.inject({ method: 'GET', url: '/api/v1/_test/crash' });
    const error = expectError(crash, 500, 'INTERNAL_ERROR');
    expect(error.message).toBe('Internal server error');
    expect(crash.body).not.toContain('hunter2');
    expect(crash.body).not.toContain('ECONNREFUSED');
  });

  it('maps unhandled database constraint errors to safe 409s', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/_test/unique' }), 409, 'CONFLICT');
    const op = await t().app.inject({ method: 'GET', url: '/api/v1/_test/forbidden-op' });
    expectError(op, 409, 'INVALID_STATE');
    expect(op.body).not.toContain('immutable');
  });

  it('turns zod validation errors into VALIDATION_FAILED with paths', async () => {
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/_test/validate/${VALID_UUID}`,
      payload: { player: { id: 'x' }, count: 1.5 },
    });
    const error = expectError(res, 400, 'VALIDATION_FAILED');
    expect(error.details).toEqual(
      expect.arrayContaining([
        { path: 'player.id', message: expect.any(String) },
        { path: 'count', message: expect.any(String) },
      ]),
    );

    const params = expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/_test/validate/not-a-uuid', payload: { player: { id: 'abc' }, count: 1 } }),
      400,
      'VALIDATION_FAILED',
    );
    expect(params.details).toEqual([{ path: 'params.id', message: expect.any(String) }]);

    const query = expectError(
      await t().app.inject({ method: 'POST', url: `/api/v1/_test/validate/${VALID_UUID}?mode=z`, payload: { player: { id: 'abc' }, count: 1 } }),
      400,
      'VALIDATION_FAILED',
    );
    expect(query.details).toEqual([{ path: 'querystring.mode', message: expect.any(String) }]);

    const missing = expectError(await t().app.inject({ method: 'POST', url: `/api/v1/_test/validate/${VALID_UUID}` }), 400, 'VALIDATION_FAILED');
    expect(missing.details).toBeDefined();
  });

  it('strips unknown keys from responses and fails closed on schema mismatches', async () => {
    const stripped = await t().app.inject({ method: 'GET', url: '/api/v1/_test/strip-response' });
    expect(stripped.json()).toEqual({ id: 'a' });
    const bad = await t().app.inject({ method: 'GET', url: '/api/v1/_test/bad-response' });
    expectError(bad, 500, 'INTERNAL_ERROR');
    expect(bad.body).not.toContain('password_hash');
  });

  it('handles body parsing errors', async () => {
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'application/json' }, payload: '{"a":' }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'text/plain' }, payload: 'hi' }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
    const big = JSON.stringify({ data: 'x'.repeat(1_048_577) });
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'application/json' }, payload: big }),
      413,
      'PAYLOAD_TOO_LARGE',
    );
  });

  it('keeps the raw body and accepts empty JSON bodies', async () => {
    const raw = '{ "a" : 1 }';
    const echoed = await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'application/json' }, payload: raw });
    expect(echoed.json()).toEqual({ body: { a: 1 }, raw_length: raw.length });
    const empty = await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'application/json' }, payload: '' });
    expect(empty.json()).toEqual({ body: null, raw_length: 0 });
    const charset = await t().app.inject({
      method: 'POST',
      url: '/api/v1/_test/echo',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload: '{"ü":"✓"}',
    });
    expect(charset.json()).toEqual({ body: { ü: '✓' }, raw_length: Buffer.byteLength('{"ü":"✓"}') });
  });

  it('rejects prototype poisoning', async () => {
    for (const payload of ['{"__proto__":{"x":1}}', '{"a":{"__proto__":{"x":1}}}', '{"constructor":{"prototype":{"x":1}}}']) {
      expectError(
        await t().app.inject({ method: 'POST', url: '/api/v1/_test/echo', headers: { 'content-type': 'application/json' }, payload }),
        400,
        'VALIDATION_FAILED',
      );
    }
    // A plain "constructor" key without prototype is fine.
    const ok = await t().app.inject({
      method: 'POST',
      url: '/api/v1/_test/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"constructor":"x"}',
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe('error logging', () => {
  it('logs unexpected errors with stack server-side only', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    const t = await buildTestApp({ modules: [], extend: routes, logger: pino({ level: 'info' }, stream) });
    try {
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/_test/crash' });
      expect(res.statusCode).toBe(500);
      const errorLine = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line['msg'] === 'request failed');
      expect(errorLine).toBeDefined();
      expect(JSON.stringify(errorLine)).toContain('stack');
      expect(errorLine?.['request_id']).toBe(res.headers['x-request-id']);
      const completed = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line['msg'] === 'request completed');
      expect(completed).toMatchObject({ method: 'GET', route: '/api/v1/_test/crash', status_code: 500, result: 'server_error' });
      expect(typeof completed?.['latency_ms']).toBe('number');
    } finally {
      await t.close();
    }
  });
});

describe('rate limiting', () => {
  it('limits requests per IP and answers RATE_LIMITED with Retry-After', async () => {
    const t = await buildTestApp({ modules: [], extend: routes, env: { RATE_LIMIT_GLOBAL_PER_MINUTE: '3' } });
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await t.app.inject({ method: 'GET', url: '/api/v1/time' })).statusCode).toBe(200);
      }
      const limited = await t.app.inject({ method: 'GET', url: '/api/v1/time' });
      const error = expectError(limited, 429, 'RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();
      expect(error.details).toEqual({ retry_after_seconds: expect.any(Number) });
      // Unknown routes are limited too; health probes never are.
      expectError(await t.app.inject({ method: 'GET', url: '/api/v1/nope' }), 429, 'RATE_LIMITED');
      expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      // Other clients are unaffected.
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/time', remoteAddress: '198.51.100.9' })).statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });

  it('applies per-route limits from deps.rateLimits', async () => {
    const t = await buildTestApp({
      modules: [],
      env: { RATE_LIMIT_AUTH_PER_MINUTE: '2' },
      extend: (app) => {
        app.post('/api/v1/_test/login', { config: { rateLimit: app.deps.rateLimits.auth } }, async () => ({ ok: true }));
      },
    });
    try {
      expect((await t.app.inject({ method: 'POST', url: '/api/v1/_test/login' })).statusCode).toBe(200);
      expect((await t.app.inject({ method: 'POST', url: '/api/v1/_test/login' })).statusCode).toBe(200);
      expectError(await t.app.inject({ method: 'POST', url: '/api/v1/_test/login' }), 429, 'RATE_LIMITED');
    } finally {
      await t.close();
    }
  });

  it('uses Redis for counters when configured', async () => {
    const t = await buildTestApp({ modules: [], redis: true, env: { RATE_LIMIT_GLOBAL_PER_MINUTE: '2' } });
    try {
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/time' })).statusCode).toBe(200);
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/time' })).statusCode).toBe(200);
      expectError(await t.app.inject({ method: 'GET', url: '/api/v1/time' }), 429, 'RATE_LIMITED');
      const keys = await t.redis?.keys('*');
      expect(keys).toBeDefined();
    } finally {
      await t.close();
    }
  });

  it('can be disabled', async () => {
    const t = await buildTestApp({ modules: [], env: { RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_GLOBAL_PER_MINUTE: '1' } });
    try {
      for (let i = 0; i < 3; i += 1) expect((await t.app.inject({ method: 'GET', url: '/api/v1/time' })).statusCode).toBe(200);
    } finally {
      await t.close();
    }
  });
});
