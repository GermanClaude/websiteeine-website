import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api, authEvents, buildQueryString, getCsrfToken, resetClientState, setCsrfToken } from '../src/api/client';
import { errorResponse, jsonResponse, mockFetch } from './helpers';

describe('buildQueryString', () => {
  it('skips empty values and repeats arrays', () => {
    expect(buildQueryString({ a: 1, b: undefined, c: null, d: '', e: ['x', 'y'], f: false })).toBe('?a=1&e=x&e=y&f=false');
    expect(buildQueryString({})).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });
});

describe('api client', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => {
    resetClientState();
  });

  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('sends the CSRF header on POST but not on GET', async () => {
    setCsrfToken('tok-123');
    const mock = mockFetch(() => jsonResponse(200, { ok: true }));
    restore = mock.restore;

    await api.get('/things', { query: { page: 2 } });
    await api.post('/things', { name: 'x' });

    expect(mock.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/things?page=2' });
    expect(mock.calls[0]?.headers['x-csrf-token']).toBeUndefined();
    expect(mock.calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/things', body: { name: 'x' } });
    expect(mock.calls[1]?.headers['x-csrf-token']).toBe('tok-123');
    expect(mock.calls[1]?.headers['content-type']).toBe('application/json');
  });

  it('loads the CSRF token from GET /auth/session when none is held yet', async () => {
    const mock = mockFetch((call) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, { csrf_token: 'fresh' });
      return jsonResponse(200, { ok: true });
    });
    restore = mock.restore;

    await api.post('/things', {});

    expect(mock.calls.map((call) => call.url)).toEqual(['/api/v1/auth/session', '/api/v1/things']);
    expect(mock.calls[1]?.headers['x-csrf-token']).toBe('fresh');
    expect(getCsrfToken()).toBe('fresh');
  });

  it('parses the error envelope into ApiError', async () => {
    const mock = mockFetch(() => errorResponse(400, 'VALIDATION_FAILED', 'Request validation failed', [{ path: 'body.email', message: 'Invalid email' }]));
    restore = mock.restore;
    setCsrfToken('tok');

    const error = await api.post('/auth/register', {}).catch((caught: unknown) => caught);
    expect(ApiError.is(error)).toBe(true);
    if (!ApiError.is(error)) throw new Error('unreachable');
    expect(error.status).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toBe('Request validation failed');
    expect(error.requestId).toBe('req-err-1');
    expect(error.validationIssues).toEqual([{ path: 'body.email', message: 'Invalid email' }]);
  });

  it('falls back to a generic ApiError for non-JSON failures', async () => {
    const mock = mockFetch(() => new Response('Bad gateway', { status: 502, headers: { 'x-request-id': 'r-502' } }));
    restore = mock.restore;

    const error = await api.get('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('HTTP_502');
    expect((error as ApiError).requestId).toBe('r-502');
  });

  it('refreshes the CSRF token and retries once after 403 CSRF_TOKEN_INVALID', async () => {
    setCsrfToken('stale');
    const mock = mockFetch((call) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, { csrf_token: 'renewed' });
      if (call.headers['x-csrf-token'] === 'stale') return errorResponse(403, 'CSRF_TOKEN_INVALID', 'CSRF token is missing or invalid');
      return jsonResponse(200, { ok: true });
    });
    restore = mock.restore;

    const result = await api.post<{ ok: boolean }>('/things', {});

    expect(result).toEqual({ ok: true });
    expect(mock.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /api/v1/things', 'GET /api/v1/auth/session', 'POST /api/v1/things']);
    expect(mock.calls[2]?.headers['x-csrf-token']).toBe('renewed');
  });

  it('does not retry a CSRF failure more than once', async () => {
    setCsrfToken('stale');
    const mock = mockFetch((call) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, { csrf_token: 'renewed' });
      return errorResponse(403, 'CSRF_TOKEN_INVALID', 'CSRF token is missing or invalid');
    });
    restore = mock.restore;

    await expect(api.post('/things', {})).rejects.toMatchObject({ status: 403, code: 'CSRF_TOKEN_INVALID' });
    expect(mock.calls.filter((call) => call.url === '/api/v1/things')).toHaveLength(2);
  });

  it('emits an unauthenticated event and clears the token on 401', async () => {
    setCsrfToken('tok');
    const listener = vi.fn();
    const unsubscribe = authEvents.onUnauthenticated(listener);
    const mock = mockFetch(() => errorResponse(401, 'UNAUTHENTICATED', 'Authentication required'));
    restore = mock.restore;

    await expect(api.get('/me')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCsrfToken()).toBeNull();
    unsubscribe();
  });

  it('returns undefined for empty bodies', async () => {
    setCsrfToken('tok');
    const mock = mockFetch(() => new Response(null, { status: 204 }));
    restore = mock.restore;
    await expect(api.post('/auth/logout')).resolves.toBeUndefined();
  });

  it('wraps network failures as ApiError with status 0', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    restore = () => {
      globalThis.fetch = original;
    };
    const error = await api.get('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).isNetworkError).toBe(true);
  });
});
