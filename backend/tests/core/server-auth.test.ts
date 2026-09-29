import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { SIGNING_HEADERS_LOWER } from '@scpsl-trust/shared';

import { generateEd25519KeyPair, signEd25519 } from '../../src/lib/crypto';
import { MemoryShortLivedStore } from '../../src/redis/store';
import { verifyServerSignature } from '../../src/auth/server-auth';
import {
  addServerKey,
  createServerWithKey,
  expectError,
  prepareSignedRequest,
  randomNonce,
  signedRequest,
  useTestApp,
  type ServerIdentity,
  type TestApp,
} from '../helpers';

const SIGNED_PATH = '/api/v1/_test/signed';

/** Test routes behind requireServerSignature (no feature modules, so no path conflicts). */
function extend(app: FastifyInstance): void {
  for (const method of ['GET', 'POST', 'PUT'] as const) {
    app.route({
      method,
      url: SIGNED_PATH,
      preHandler: app.requireServerSignature,
      handler: async (request) => ({ server: request.authServer, body: request.body ?? null }),
    });
  }
}

function identityOf(server: ServerIdentity, overrides: Partial<{ fingerprint: string | undefined }> = {}) {
  return {
    server: server.server,
    keyPair: server.keyPair,
    ...(Object.hasOwn(overrides, 'fingerprint') ? { fingerprint: overrides.fingerprint } : { fingerprint: server.fingerprint }),
  };
}

function runSuite(label: string, options: { redis: boolean }): void {
  describe(`server signature authentication (${label})`, () => {
    const t = useTestApp({ modules: [], extend, redis: options.redis });
    let srv: ServerIdentity;

    beforeEach(async () => {
      srv = await createServerWithKey(t().deps);
    });

    const app = (): TestApp['app'] => t().app;

    it('accepts a valid signed POST and exposes request.authServer', async () => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        body: { server_id: srv.server.server_id, hello: 'world' },
        pluginVersion: '1.2.3',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { server: Record<string, unknown>; body: unknown };
      expect(body.server).toEqual({
        id: srv.server.id,
        server_id: srv.server.server_id,
        key_id: srv.key?.id,
        fingerprint: srv.fingerprint,
        plugin_version: '1.2.3',
        name: srv.server.name,
        owner_user_id: srv.owner.id,
      });
      expect(body.body).toEqual({ server_id: srv.server.server_id, hello: 'world' });
      const row = await t().db.selectFrom('servers').selectAll().where('id', '=', srv.server.id).executeTakeFirstOrThrow();
      expect(row.plugin_version).toBe('1.2.3');
      expect(row.last_seen_at?.getTime()).toBe(t().clock.now().getTime());
    });

    it('accepts GET with a query string signed exactly as sent', async () => {
      const res = await signedRequest(app(), identityOf(srv), { method: 'GET', url: `${SIGNED_PATH}?b=2&a=%C3%A4%20x` });
      expect(res.statusCode).toBe(200);
    });

    it('accepts requests without X-Key-Fingerprint', async () => {
      const res = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, includeFingerprint: false });
      expect(res.statusCode).toBe(200);
    });

    it('hashes the raw body bytes (whitespace and unicode are significant)', async () => {
      const pretty = '{\n  "note": "Grüße 🎯 — 你好",\n  "n": 1\n}';
      const ok = await signedRequest(app(), identityOf(srv), { method: 'POST', url: SIGNED_PATH, rawBody: pretty });
      expect(ok.statusCode).toBe(200);
      const reserialized = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        rawBody: pretty,
        sign: { body: JSON.stringify(JSON.parse(pretty)) },
      });
      expectError(reserialized, 401, 'INVALID_SIGNATURE');
    });

    it('rejects an invalid signature', async () => {
      const bogus = signEd25519(generateEd25519KeyPair().privateKey, 'something else');
      const res = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, sign: { signature: bogus } });
      expectError(res, 401, 'INVALID_SIGNATURE');
    });

    it('rejects a flipped signature bit', async () => {
      const good = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH });
      expect(good.statusCode).toBe(200);
      const signature = Buffer.from(signEd25519(srv.keyPair.privateKey, 'x'), 'base64');
      signature[10] = (signature[10] ?? 0) ^ 0x01;
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'GET',
        url: SIGNED_PATH,
        sign: { signature: signature.toString('base64') },
      });
      expectError(res, 401, 'INVALID_SIGNATURE');
    });

    it.each([
      ['body', { sign: { body: '{"hello":"mars"}' } }],
      ['path', { sign: { url: '/api/v1/_test/other' } }],
      ['query value', { url: `${SIGNED_PATH}?x=2`, sign: { url: `${SIGNED_PATH}?x=1` } }],
      ['query order', { url: `${SIGNED_PATH}?b=2&a=1`, sign: { url: `${SIGNED_PATH}?a=1&b=2` } }],
      ['query encoding', { url: `${SIGNED_PATH}?q=%61`, sign: { url: `${SIGNED_PATH}?q=a` } }],
      ['method', { sign: { method: 'PUT' } }],
      ['timestamp', { sign: { timestamp: 1 } }],
      ['nonce', { sign: { nonce: 'AAAAAAAAAAAAAAAAAAAAAAAA' } }],
      ['request id', { sign: { requestId: randomUUID() } }],
      ['server id', { sign: { serverId: 'srv_0000000000000001' } }],
    ])('rejects a tampered %s', async (_name, tamper) => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        body: { hello: 'world' },
        ...tamper,
      });
      expectError(res, 401, 'INVALID_SIGNATURE');
    });

    it('rejects a body added to a request signed without one', async () => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        body: { injected: true },
        sign: { body: '' },
      });
      expectError(res, 401, 'INVALID_SIGNATURE');
    });

    it('rejects a request signed with another key', async () => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'GET',
        url: SIGNED_PATH,
        sign: { privateKey: generateEd25519KeyPair().privateKey },
      });
      expectError(res, 401, 'INVALID_SIGNATURE');
    });

    it('rejects a request signed with another server key', async () => {
      const other = await createServerWithKey(t().deps);
      const res = await signedRequest(app(), { server: srv.server, keyPair: other.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expectError(res, 401, 'INVALID_SIGNATURE');
      const withOtherFingerprint = await signedRequest(
        app(),
        { server: srv.server, keyPair: other.keyPair, fingerprint: other.fingerprint },
        { method: 'GET', url: SIGNED_PATH },
      );
      expectError(withOtherFingerprint, 401, 'NO_ACTIVE_KEY');
    });

    it('enforces the timestamp window in both directions', async () => {
      const skewMs = t().config.serverAuth.signatureMaxSkewSeconds * 1000;
      const now = t().clock.now().getTime();
      expectError(
        await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, timestamp: now - skewMs - 1 }),
        401,
        'TIMESTAMP_OUT_OF_RANGE',
      );
      expectError(
        await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, timestamp: now + skewMs + 1 }),
        401,
        'TIMESTAMP_OUT_OF_RANGE',
      );
      expectError(
        await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, timestamp: 0 }),
        401,
        'TIMESTAMP_OUT_OF_RANGE',
      );
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, timestamp: now - skewMs })).statusCode).toBe(200);
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, timestamp: now + skewMs })).statusCode).toBe(200);
    });

    it('requires every signing header', async () => {
      for (const header of [
        SIGNING_HEADERS_LOWER.SERVER_ID,
        SIGNING_HEADERS_LOWER.TIMESTAMP,
        SIGNING_HEADERS_LOWER.NONCE,
        SIGNING_HEADERS_LOWER.REQUEST_ID,
        SIGNING_HEADERS_LOWER.PLUGIN_VERSION,
        SIGNING_HEADERS_LOWER.SIGNATURE,
      ]) {
        const res = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, headers: { [header]: undefined } });
        const error = expectError(res, 401, 'MISSING_AUTH_HEADERS');
        expect(error.details).toEqual({ missing: [header] });
      }
      const bare = await app().inject({ method: 'GET', url: SIGNED_PATH });
      expectError(bare, 401, 'MISSING_AUTH_HEADERS');
    });

    it.each([
      [SIGNING_HEADERS_LOWER.SERVER_ID, 'srv_ILLEGAL0000000'],
      [SIGNING_HEADERS_LOWER.SERVER_ID, "srv_7k4x92m8pq174kf9' OR 1=1"],
      [SIGNING_HEADERS_LOWER.TIMESTAMP, '1790000000000.5'],
      [SIGNING_HEADERS_LOWER.TIMESTAMP, '-1790000000000'],
      [SIGNING_HEADERS_LOWER.TIMESTAMP, '01790000000000'],
      [SIGNING_HEADERS_LOWER.TIMESTAMP, '99999999999999999999'],
      [SIGNING_HEADERS_LOWER.NONCE, 'short'],
      [SIGNING_HEADERS_LOWER.NONCE, 'has spaces in the nonce value'],
      [SIGNING_HEADERS_LOWER.REQUEST_ID, 'not-a-uuid'],
      [SIGNING_HEADERS_LOWER.REQUEST_ID, '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
      [SIGNING_HEADERS_LOWER.PLUGIN_VERSION, 'v1'],
      [SIGNING_HEADERS_LOWER.PLUGIN_VERSION, '1.0.0\u0000'],
      [SIGNING_HEADERS_LOWER.SIGNATURE, 'not base64!'],
      [SIGNING_HEADERS_LOWER.SIGNATURE, Buffer.alloc(63).toString('base64')],
      [SIGNING_HEADERS_LOWER.KEY_FINGERPRINT, 'SHA256:ABC'],
      [SIGNING_HEADERS_LOWER.KEY_FINGERPRINT, 'MD5:00'],
    ])('rejects malformed %s (%s)', async (header, value) => {
      const res = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, headers: { [header]: value } });
      const error = expectError(res, 400, 'INVALID_AUTH_HEADERS');
      expect(error.details).toEqual({ invalid: [header] });
    });

    it('rejects duplicated signing headers', async () => {
      const res = await app().inject({
        method: 'GET',
        url: SIGNED_PATH,
        headers: {
          [SIGNING_HEADERS_LOWER.SERVER_ID]: srv.server.server_id,
          [SIGNING_HEADERS_LOWER.TIMESTAMP]: String(t().clock.now().getTime()),
          [SIGNING_HEADERS_LOWER.NONCE]: [randomNonce(), randomNonce()],
          [SIGNING_HEADERS_LOWER.REQUEST_ID]: randomUUID(),
          [SIGNING_HEADERS_LOWER.PLUGIN_VERSION]: '1.0.0',
          [SIGNING_HEADERS_LOWER.SIGNATURE]: signEd25519(srv.keyPair.privateKey, 'x'),
        },
      });
      expectError(res, 400, 'INVALID_AUTH_HEADERS');
    });

    it('rejects a replayed nonce but not after an invalid signature', async () => {
      const nonce = randomNonce();
      // An invalid signature must not consume the nonce (no nonce-store pollution).
      const forged = await signedRequest(app(), identityOf(srv), {
        method: 'GET',
        url: SIGNED_PATH,
        nonce,
        sign: { privateKey: generateEd25519KeyPair().privateKey },
      });
      expectError(forged, 401, 'INVALID_SIGNATURE');
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, nonce })).statusCode).toBe(200);
      const replay = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, nonce });
      expectError(replay, 401, 'REPLAYED_NONCE');
    });

    it('scopes nonces per server', async () => {
      const other = await createServerWithKey(t().deps);
      const nonce = randomNonce();
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, nonce })).statusCode).toBe(200);
      expect((await signedRequest(app(), identityOf(other), { method: 'GET', url: SIGNED_PATH, nonce })).statusCode).toBe(200);
    });

    it('rejects a duplicate request id (case-insensitive)', async () => {
      const requestId = randomUUID();
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, requestId })).statusCode).toBe(200);
      expectError(await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, requestId }), 409, 'DUPLICATE_REQUEST_ID');
      expectError(
        await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, requestId: requestId.toUpperCase() }),
        409,
        'DUPLICATE_REQUEST_ID',
      );
    });

    it('rejects a revoked key selected by fingerprint and a server whose only key is revoked', async () => {
      const revoked = await addServerKey(t().deps, srv.server, { status: 'revoked' });
      const byFingerprint = await signedRequest(
        app(),
        { server: srv.server, keyPair: revoked.keyPair, fingerprint: revoked.fingerprint },
        { method: 'GET', url: SIGNED_PATH },
      );
      expectError(byFingerprint, 401, 'KEY_REVOKED');
      // Without fingerprint the active key is used, so the revoked key's signature is invalid.
      const withoutFingerprint = await signedRequest(app(), { server: srv.server, keyPair: revoked.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expectError(withoutFingerprint, 401, 'INVALID_SIGNATURE');

      const lonely = await createServerWithKey(t().deps, { keyStatus: 'revoked' });
      const res = await signedRequest(app(), { server: lonely.server, keyPair: lonely.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expectError(res, 401, 'KEY_REVOKED');
    });

    it('rejects a server without any key', async () => {
      const keyless = await createServerWithKey(t().deps, { keyStatus: null });
      const res = await signedRequest(app(), { server: keyless.server, keyPair: keyless.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expectError(res, 401, 'NO_ACTIVE_KEY');
    });

    it('accepts a retiring key within the grace period and rejects it afterwards', async () => {
      const graceMs = 5 * 60_000;
      const retiring = await addServerKey(t().deps, srv.server, {
        status: 'retiring',
        retiringUntil: new Date(t().clock.now().getTime() + graceMs),
      });
      const withFingerprint = { server: srv.server, keyPair: retiring.keyPair, fingerprint: retiring.fingerprint };
      const inGrace = await signedRequest(app(), withFingerprint, { method: 'GET', url: SIGNED_PATH });
      expect(inGrace.statusCode).toBe(200);
      expect((inGrace.json() as { server: { key_id: string } }).server.key_id).toBe(retiring.key.id);
      const inGraceNoFp = await signedRequest(app(), { server: srv.server, keyPair: retiring.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expect(inGraceNoFp.statusCode).toBe(200);

      t().clock.advance(graceMs + 1);
      try {
        expectError(await signedRequest(app(), withFingerprint, { method: 'GET', url: SIGNED_PATH }), 401, 'NO_ACTIVE_KEY');
        expectError(
          await signedRequest(app(), { server: srv.server, keyPair: retiring.keyPair }, { method: 'GET', url: SIGNED_PATH }),
          401,
          'INVALID_SIGNATURE',
        );
        // The active key keeps working.
        expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH })).statusCode).toBe(200);
      } finally {
        t().clock.advance(-(graceMs + 1));
      }
    });

    it('uses X-Key-Fingerprint to select the verification key', async () => {
      const retiring = await addServerKey(t().deps, srv.server, { status: 'retiring' });
      // Signed with the retiring key but claiming the active key → verified against the active key only.
      const mismatch = await signedRequest(
        app(),
        { server: srv.server, keyPair: retiring.keyPair, fingerprint: srv.fingerprint },
        { method: 'GET', url: SIGNED_PATH },
      );
      expectError(mismatch, 401, 'INVALID_SIGNATURE');
      const active = await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH });
      expect((active.json() as { server: { key_id: string } }).server.key_id).toBe(srv.key?.id);
    });

    it.each([
      ['suspended', 403, 'SERVER_SUSPENDED'],
      ['revoked', 403, 'SERVER_REVOKED'],
    ] as const)('rejects a %s server', async (status, httpStatus, code) => {
      await t().db.updateTable('servers').set({ status }).where('id', '=', srv.server.id).execute();
      expectError(await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH }), httpStatus, code);
    });

    it('rejects a pending (never registered) server', async () => {
      const pending = await createServerWithKey(t().deps, { status: 'pending' });
      const res = await signedRequest(app(), { server: pending.server, keyPair: pending.keyPair }, { method: 'GET', url: SIGNED_PATH });
      expectError(res, 401, 'NO_ACTIVE_KEY');
    });

    it('rejects an unknown server', async () => {
      const res = await signedRequest(
        app(),
        { server: { server_id: 'srv_zzzzzzzzzzzzzzzz' }, keyPair: srv.keyPair },
        { method: 'GET', url: SIGNED_PATH },
      );
      expectError(res, 401, 'UNKNOWN_SERVER');
    });

    it('rejects a body server_id that differs from X-Server-Id', async () => {
      const other = await createServerWithKey(t().deps);
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        body: { server_id: other.server.server_id },
      });
      expectError(res, 400, 'SERVER_ID_MISMATCH');
      const typed = await signedRequest(app(), identityOf(srv), { method: 'POST', url: SIGNED_PATH, body: { server_id: 42 } });
      expectError(typed, 400, 'SERVER_ID_MISMATCH');
      const nullId = await signedRequest(app(), identityOf(srv), { method: 'POST', url: SIGNED_PATH, body: { server_id: null } });
      expect(nullId.statusCode).toBe(200);
    });

    it('rejects malformed JSON and prototype pollution before authentication', async () => {
      const broken = await signedRequest(app(), identityOf(srv), { method: 'POST', url: SIGNED_PATH, rawBody: '{"a":' });
      expectError(broken, 400, 'VALIDATION_FAILED');
      const polluted = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        rawBody: '{"__proto__":{"admin":true}}',
      });
      expectError(polluted, 400, 'VALIDATION_FAILED');
      const ctor = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        rawBody: '{"constructor":{"prototype":{"admin":true}}}',
      });
      expectError(ctor, 400, 'VALIDATION_FAILED');
    });

    it('throttles last_seen_at updates but records plugin version changes', async () => {
      const first = t().clock.now();
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH })).statusCode).toBe(200);
      t().clock.advance(10_000);
      expect((await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH })).statusCode).toBe(200);
      let row = await t().db.selectFrom('servers').selectAll().where('id', '=', srv.server.id).executeTakeFirstOrThrow();
      expect(row.last_seen_at?.getTime()).toBe(first.getTime());

      t().clock.advance(1_000);
      expect(
        (await signedRequest(app(), identityOf(srv), { method: 'GET', url: SIGNED_PATH, pluginVersion: '2.0.0' })).statusCode,
      ).toBe(200);
      row = await t().db.selectFrom('servers').selectAll().where('id', '=', srv.server.id).executeTakeFirstOrThrow();
      expect(row.plugin_version).toBe('2.0.0');
      expect(row.last_seen_at?.getTime()).toBe(first.getTime() + 11_000);
      t().clock.advance(-11_000);
    });

    it('rejects non-JSON bodies on signed routes (no body may bypass the signature)', async () => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        rawBody: 'server_id=srv_other',
        contentType: 'text/plain',
        sign: { body: '' },
      });
      expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    });

    it('does not require a CSRF token for signed requests without cookies', async () => {
      const res = await signedRequest(app(), identityOf(srv), {
        method: 'POST',
        url: SIGNED_PATH,
        body: { a: 1 },
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(200);
    });
  });
}

describe('verifyServerSignature (without HTTP)', () => {
  const t = useTestApp({ modules: [] });

  it('verifies steps 1-7 and 9 and rejects parsed bodies without raw bytes', async () => {
    const srv = await createServerWithKey(t().deps);
    const deps = {
      db: t().db,
      nonceStore: t().deps.nonceStore,
      clock: t().clock,
      maxSkewSeconds: t().config.serverAuth.signatureMaxSkewSeconds,
    };
    const body = Buffer.from(JSON.stringify({ server_id: srv.server.server_id }));
    const prepared = prepareSignedRequest(identityOf(srv), { method: 'POST', url: '/api/v1/x', rawBody: body }, t().clock.now().getTime());
    const server = await verifyServerSignature(deps, {
      method: 'POST',
      url: '/api/v1/x',
      headers: prepared.headers,
      rawBody: body,
      body: JSON.parse(body.toString('utf8')) as unknown,
    });
    expect(server).toMatchObject({ id: srv.server.id, server_id: srv.server.server_id, key_id: srv.key?.id });

    const again = prepareSignedRequest(identityOf(srv), { method: 'POST', url: '/api/v1/x' }, t().clock.now().getTime());
    await expect(
      verifyServerSignature(deps, { method: 'POST', url: '/api/v1/x', headers: again.headers, rawBody: undefined, body: 'smuggled' }),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });

    const mismatch = prepareSignedRequest(identityOf(srv), { method: 'POST', url: '/api/v1/x', body: { server_id: 'srv_0000000000000001' } }, t().clock.now().getTime());
    await expect(
      verifyServerSignature(deps, {
        method: 'POST',
        url: '/api/v1/x',
        headers: mismatch.headers,
        rawBody: mismatch.payload,
        body: { server_id: 'srv_0000000000000001' },
      }),
    ).rejects.toMatchObject({ code: 'SERVER_ID_MISMATCH' });
  });
});

runSuite('memory store', { redis: false });
runSuite('redis store', { redis: true });

describe('repeated authentication failures', () => {
  const t = useTestApp({ modules: [], extend, env: { RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE: '3' } });

  it('answers 429 after too many failures from a client and recovers after the window', async () => {
    const srv = await createServerWithKey(t().deps);
    const forged = { sign: { privateKey: generateEd25519KeyPair().privateKey } };
    for (let i = 0; i < 3; i += 1) {
      expectError(await signedRequest(t().app, identityOf(srv), { method: 'GET', url: SIGNED_PATH, ...forged }), 401, 'INVALID_SIGNATURE');
    }
    const limited = await signedRequest(t().app, identityOf(srv), { method: 'GET', url: SIGNED_PATH });
    const error = expectError(limited, 429, 'RATE_LIMITED');
    expect(error.details).toEqual({ retry_after_seconds: expect.any(Number) });

    t().clock.advance(61_000);
    expect((await signedRequest(t().app, identityOf(srv), { method: 'GET', url: SIGNED_PATH })).statusCode).toBe(200);
    expect(t().store).toBeInstanceOf(MemoryShortLivedStore);
  });
});
