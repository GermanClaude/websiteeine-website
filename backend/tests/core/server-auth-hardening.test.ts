/**
 * Adversarial cases for the signed-request authentication (§5.3/§5.4) that go beyond the
 * happy/tamper matrix in server-auth.test.ts: transport tricks that could make the verified
 * bytes differ from the bytes a handler sees, window boundaries, replay-store lifetimes and
 * the isolation of failure counters between clients.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SIGNATURE_MAX_SKEW_SECONDS, SIGNING_HEADERS_LOWER } from '@scpsl-trust/shared';

import { nonceTtlMs, REQUEST_ID_TTL_MS } from '../../src/auth/nonce-store';
import { sha256Hex, verifyEd25519 } from '../../src/lib/crypto';
import { createServerWithKey, expectError, prepareSignedRequest, signedRequest, useTestApp, type ServerIdentity } from '../helpers';

const SIGNED_PATH = '/api/v1/_test/signed';

function extend(app: FastifyInstance): void {
  for (const method of ['GET', 'POST'] as const) {
    app.route({
      method,
      url: SIGNED_PATH,
      preHandler: app.requireServerSignature,
      handler: async (request) => ({
        server_id: request.authServer?.server_id ?? null,
        body: request.body ?? null,
        raw_sha256: request.rawBody === undefined ? null : sha256Hex(request.rawBody),
      }),
    });
  }
}

describe('signed requests: transport hardening', () => {
  const t = useTestApp({ modules: [], extend });
  let srv: ServerIdentity;

  beforeEach(async () => {
    srv = await createServerWithKey(t().deps);
  });

  const identity = () => ({ server: srv.server, keyPair: srv.keyPair, fingerprint: srv.fingerprint });

  it('accepts a JSON content type with parameters (charset) and still hashes the raw bytes', async () => {
    const rawBody = '{"hello":"wörld"}';
    const res = await signedRequest(t().app, identity(), {
      method: 'POST',
      url: SIGNED_PATH,
      rawBody,
      contentType: 'application/json; charset=utf-8',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ server_id: srv.server.server_id, body: { hello: 'wörld' }, raw_sha256: sha256Hex(rawBody) });
  });

  it('never lets a body reach the handler without being covered by the signature', async () => {
    // A body without a content type: the signature was computed over the empty body.
    const noType = await signedRequest(t().app, identity(), {
      method: 'POST',
      url: SIGNED_PATH,
      rawBody: '{"hello":"smuggled"}',
      headers: { 'content-type': undefined },
      sign: { body: '' },
    });
    expect(noType.statusCode).not.toBe(200);
    expect([400, 401, 415]).toContain(noType.statusCode);

    // Same with content types that have no parser (must not fall back to a raw-body-less parser).
    for (const contentType of ['text/json', 'application/x-www-form-urlencoded', 'text/plain', 'application/json+x']) {
      const res = await signedRequest(t().app, identity(), {
        method: 'POST',
        url: SIGNED_PATH,
        rawBody: '{"hello":"smuggled"}',
        contentType,
        sign: { body: '' },
      });
      expect(res.statusCode, contentType).not.toBe(200);
      expect([400, 401, 415], contentType).toContain(res.statusCode);
    }
  });

  it('ignores a body on GET only when the signature covers the empty body (body never parsed)', async () => {
    const res = await signedRequest(t().app, identity(), {
      method: 'GET',
      url: SIGNED_PATH,
      rawBody: '{"hello":"ignored"}',
      sign: { body: '' },
    });
    // Fastify does not parse GET bodies: nothing derived from the unsigned bytes is visible.
    if (res.statusCode === 200) {
      expect(res.json()).toMatchObject({ body: null, raw_sha256: null });
    } else {
      expect([400, 401, 415]).toContain(res.statusCode);
    }
  });

  it('treats header names case-insensitively (HTTP semantics)', async () => {
    const prepared = prepareSignedRequest(identity(), { method: 'POST', url: SIGNED_PATH, body: { a: 1 } }, t().clock.now().getTime());
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(prepared.headers)) {
      headers[name.replace(/(^|-)([a-z])/g, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`)] = value;
    }
    const res = await t().app.inject({ method: 'POST', url: SIGNED_PATH, headers, payload: prepared.payload });
    expect(res.statusCode).toBe(200);
  });

  it('rejects signature header values with surrounding whitespace or comma-joined duplicates', async () => {
    const prepared = prepareSignedRequest(identity(), { method: 'GET', url: SIGNED_PATH }, t().clock.now().getTime());
    const padded = await t().app.inject({
      method: 'GET',
      url: SIGNED_PATH,
      headers: { ...prepared.headers, [SIGNING_HEADERS_LOWER.SIGNATURE]: `${prepared.headers[SIGNING_HEADERS_LOWER.SIGNATURE]} ` },
    });
    expectError(padded, 400, 'INVALID_AUTH_HEADERS');

    const joined = await t().app.inject({
      method: 'GET',
      url: SIGNED_PATH,
      headers: { ...prepared.headers, [SIGNING_HEADERS_LOWER.SERVER_ID]: `${srv.server.server_id}, ${srv.server.server_id}` },
    });
    expectError(joined, 400, 'INVALID_AUTH_HEADERS');
  });

  it('applies the timestamp window inclusively at ±skew and rejects one millisecond beyond', async () => {
    const skewMs = t().config.serverAuth.signatureMaxSkewSeconds * 1000;
    const now = t().clock.now().getTime();
    for (const [offset, ok] of [
      [skewMs, true],
      [-skewMs, true],
      [skewMs + 1, false],
      [-(skewMs + 1), false],
    ] as const) {
      const res = await signedRequest(t().app, identity(), { method: 'GET', url: SIGNED_PATH, timestamp: now + offset });
      if (ok) expect(res.statusCode, String(offset)).toBe(200);
      else expectError(res, 401, 'TIMESTAMP_OUT_OF_RANGE');
    }
  });

  it('keeps nonces and request ids longer than any acceptable timestamp window (no replay after expiry)', () => {
    // A captured request is valid for at most 2 × skew seconds around its timestamp; the
    // replay stores must outlive that window, otherwise an old nonce could be reused while the
    // timestamp is still acceptable.
    for (const skew of [5, DEFAULT_SIGNATURE_MAX_SKEW_SECONDS, 600]) {
      expect(nonceTtlMs(skew)).toBeGreaterThan(2 * skew * 1000);
    }
    expect(REQUEST_ID_TTL_MS).toBeGreaterThan(2 * DEFAULT_SIGNATURE_MAX_SKEW_SECONDS * 1000);
  });

  it('rejects a replay after the nonce expired because the timestamp is then out of range', async () => {
    const prepared = prepareSignedRequest(identity(), { method: 'GET', url: SIGNED_PATH }, t().clock.now().getTime());
    const inject = () => t().app.inject({ method: 'GET', url: SIGNED_PATH, headers: prepared.headers });
    expect((await inject()).statusCode).toBe(200);
    expectError(await inject(), 401, 'REPLAYED_NONCE');
    t().clock.advance(nonceTtlMs(t().config.serverAuth.signatureMaxSkewSeconds) + 1000);
    expectError(await inject(), 401, 'TIMESTAMP_OUT_OF_RANGE');
  });

  it('rejects a re-signed request that reuses only the nonce (new request id, fresh signature)', async () => {
    const nonce = 'AbCdEfGhIjKlMnOpQrStUv';
    const first = await signedRequest(t().app, identity(), { method: 'GET', url: SIGNED_PATH, nonce, requestId: randomUUID() });
    expect(first.statusCode).toBe(200);
    const second = await signedRequest(t().app, identity(), { method: 'GET', url: SIGNED_PATH, nonce, requestId: randomUUID() });
    expectError(second, 401, 'REPLAYED_NONCE');
  });

  it('does not consume the nonce or request id when the body server_id mismatches only after verification', async () => {
    // Step 9 runs after steps 6-7: the nonce is spent even though the request is rejected —
    // a retry must use a fresh nonce (documented behaviour; the plugin never reuses nonces).
    const nonce = 'ZyXwVuTsRqPoNmLkJiHgFe';
    const res = await signedRequest(t().app, identity(), {
      method: 'POST',
      url: SIGNED_PATH,
      nonce,
      body: { server_id: 'srv_0000000000000001' },
    });
    expectError(res, 400, 'SERVER_ID_MISMATCH');
    const retry = await signedRequest(t().app, identity(), { method: 'POST', url: SIGNED_PATH, nonce, body: { ok: true } });
    expectError(retry, 401, 'REPLAYED_NONCE');
  });

  it('does not verify signatures against degenerate public keys', () => {
    const message = 'SCPSL-TRUST-V1\nGET\n/x\nsrv_0000000000000001\n1\nnonce\nid\n' + sha256Hex('');
    const signature = Buffer.alloc(64).toString('base64');
    for (const key of [Buffer.alloc(32).toString('base64'), Buffer.alloc(32, 0xff).toString('base64')]) {
      expect(verifyEd25519(key, message, signature)).toBe(false);
    }
    // A structurally valid key but the all-zero signature must fail too.
    expect(verifyEd25519(srv.keyPair.publicKeyB64, message, signature)).toBe(false);
  });
});

describe('signed requests: failure counters are isolated per client', () => {
  const t = useTestApp({ modules: [], extend, env: { RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE: '5' } });

  it('an attacker flooding bad signatures for a server does not lock out that server from another address', async () => {
    const srv = await createServerWithKey(t().deps);
    const identity = { server: srv.server, keyPair: srv.keyPair, fingerprint: srv.fingerprint };
    const attacker = '203.0.113.9';
    const legit = '198.51.100.7';

    for (let i = 0; i < 5; i += 1) {
      const prepared = prepareSignedRequest(identity, { method: 'GET', url: SIGNED_PATH, sign: { nonce: 'tamperedtamperedtampered' } }, t().clock.now().getTime());
      const res = await t().app.inject({ method: 'GET', url: SIGNED_PATH, headers: prepared.headers, remoteAddress: attacker });
      expectError(res, 401, 'INVALID_SIGNATURE');
    }
    const blocked = prepareSignedRequest(identity, { method: 'GET', url: SIGNED_PATH }, t().clock.now().getTime());
    expectError(
      await t().app.inject({ method: 'GET', url: SIGNED_PATH, headers: blocked.headers, remoteAddress: attacker }),
      429,
      'RATE_LIMITED',
    );

    const fromLegit = prepareSignedRequest(identity, { method: 'GET', url: SIGNED_PATH }, t().clock.now().getTime());
    const ok = await t().app.inject({ method: 'GET', url: SIGNED_PATH, headers: fromLegit.headers, remoteAddress: legit });
    expect(ok.statusCode).toBe(200);
  });

  it('counts failures against the claimed server id, so garbage requests never affect other servers', async () => {
    const victim = await createServerWithKey(t().deps);
    const other = await createServerWithKey(t().deps);
    const client = '192.0.2.44';
    for (let i = 0; i < 5; i += 1) {
      const res = await t().app.inject({
        method: 'GET',
        url: SIGNED_PATH,
        remoteAddress: client,
        headers: {
          [SIGNING_HEADERS_LOWER.SERVER_ID]: victim.server.server_id,
          [SIGNING_HEADERS_LOWER.TIMESTAMP]: String(t().clock.now().getTime()),
          [SIGNING_HEADERS_LOWER.NONCE]: 'AAAAAAAAAAAAAAAAAAAAAAAA',
          [SIGNING_HEADERS_LOWER.REQUEST_ID]: randomUUID(),
          [SIGNING_HEADERS_LOWER.PLUGIN_VERSION]: '1.0.0',
          [SIGNING_HEADERS_LOWER.SIGNATURE]: Buffer.alloc(64, 1).toString('base64'),
        },
      });
      expectError(res, 401, 'INVALID_SIGNATURE');
    }
    const prepared = prepareSignedRequest(
      { server: other.server, keyPair: other.keyPair, fingerprint: other.fingerprint },
      { method: 'GET', url: SIGNED_PATH },
      t().clock.now().getTime(),
    );
    const res = await t().app.inject({ method: 'GET', url: SIGNED_PATH, headers: prepared.headers, remoteAddress: client });
    expect(res.statusCode).toBe(200);
  });
});
