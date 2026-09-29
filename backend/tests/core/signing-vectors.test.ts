/**
 * shared/test-vectors/signing.json verified with the backend crypto (lib/crypto) and
 * end-to-end through requireServerSignature.
 */
import { readFileSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildCanonicalRequest,
  buildRegistrationPopMessage,
  buildRotationPopMessage,
  SIGNING_HEADERS,
} from '@scpsl-trust/shared';

import {
  ed25519PrivateKeyFromSeed,
  ed25519PublicKeyFromRaw,
  ed25519RawPublicKeyB64,
  keyFingerprint,
  sha256Hex,
  signEd25519,
  verifyEd25519,
} from '../../src/lib/crypto';
import { MemoryShortLivedStore } from '../../src/redis/store';
import { createUser, expectError, useTestApp } from '../helpers';

interface KeyVector {
  seed_hex: string;
  public_key_hex: string;
  public_key_b64: string;
  fingerprint: string;
}

interface RequestVector {
  name: string;
  method: string;
  path_with_query: string;
  server_id: string;
  timestamp: string;
  nonce: string;
  request_id: string;
  body: string;
  body_base64: string;
  body_sha256_hex: string;
  canonical: string;
  signature_b64: string;
  headers?: Record<string, string>;
  public_key_b64?: string;
}

interface SigningVectors {
  rfc8032_test_1: { seed_hex: string; public_key_hex: string; message_hex: string; signature_hex: string };
  key: KeyVector;
  rotation_key: KeyVector;
  requests: RequestVector[];
  negative: RequestVector[];
  registration_pop: { registration_token: string; public_key_b64: string; timestamp: number; message: string; signature_b64: string };
  rotation_pop: { server_id: string; new_public_key_b64: string; timestamp: number; message: string; signature_b64: string };
  pop_negative: Array<{ name: string; message: string; signature_b64: string; public_key_b64: string }>;
}

const vectors = JSON.parse(
  readFileSync(new URL('../../../shared/test-vectors/signing.json', import.meta.url), 'utf8'),
) as SigningVectors;

describe('signing vectors with lib/crypto', () => {
  it('passes RFC 8032 test 1', () => {
    const v = vectors.rfc8032_test_1;
    const key = ed25519PrivateKeyFromSeed(Buffer.from(v.seed_hex, 'hex'));
    expect(Buffer.from(ed25519RawPublicKeyB64(key), 'base64').toString('hex')).toBe(v.public_key_hex);
    const signature = signEd25519(key, Buffer.from(v.message_hex, 'hex'));
    expect(Buffer.from(signature, 'base64').toString('hex')).toBe(v.signature_hex);
    expect(verifyEd25519(Buffer.from(v.public_key_hex, 'hex').toString('base64'), Buffer.from(v.message_hex, 'hex'), signature)).toBe(true);
  });

  it.each([vectors.key, vectors.rotation_key])('derives public key and fingerprint ($fingerprint)', (key) => {
    const privateKey = ed25519PrivateKeyFromSeed(Buffer.from(key.seed_hex, 'hex'));
    expect(ed25519RawPublicKeyB64(privateKey)).toBe(key.public_key_b64);
    expect(keyFingerprint(key.public_key_b64)).toBe(key.fingerprint);
    expect(ed25519PublicKeyFromRaw(key.public_key_b64).asymmetricKeyType).toBe('ed25519');
  });

  it.each(vectors.requests)('verifies and re-signs $name', (request) => {
    const body = Buffer.from(request.body_base64, 'base64');
    expect(sha256Hex(body)).toBe(request.body_sha256_hex);
    const canonical = buildCanonicalRequest({
      method: request.method,
      pathWithQuery: request.path_with_query,
      serverId: request.server_id,
      timestamp: request.timestamp,
      nonce: request.nonce,
      requestId: request.request_id,
      bodySha256Hex: sha256Hex(body),
    });
    expect(canonical).toBe(request.canonical);
    expect(verifyEd25519(vectors.key.public_key_b64, canonical, request.signature_b64)).toBe(true);
    const privateKey = ed25519PrivateKeyFromSeed(Buffer.from(vectors.key.seed_hex, 'hex'));
    expect(signEd25519(privateKey, canonical)).toBe(request.signature_b64);
  });

  it.each(vectors.negative)('rejects $name', (request) => {
    expect(verifyEd25519(request.public_key_b64 ?? vectors.key.public_key_b64, request.canonical, request.signature_b64)).toBe(false);
  });

  it('verifies the proof-of-possession vectors', () => {
    const reg = vectors.registration_pop;
    expect(buildRegistrationPopMessage(reg.registration_token, reg.public_key_b64, reg.timestamp)).toBe(reg.message);
    expect(verifyEd25519(reg.public_key_b64, reg.message, reg.signature_b64)).toBe(true);
    const rot = vectors.rotation_pop;
    expect(buildRotationPopMessage(rot.server_id, rot.new_public_key_b64, rot.timestamp)).toBe(rot.message);
    expect(verifyEd25519(rot.new_public_key_b64, rot.message, rot.signature_b64)).toBe(true);
    for (const negative of vectors.pop_negative) {
      expect(verifyEd25519(negative.public_key_b64, negative.message, negative.signature_b64), negative.name).toBe(false);
    }
  });

  it('never throws on malformed keys or signatures', () => {
    const message = 'x';
    const valid = vectors.requests[0]?.signature_b64 ?? '';
    for (const key of ['', 'AAAA', 'not base64', Buffer.alloc(31).toString('base64'), `${vectors.key.public_key_b64}x`]) {
      expect(verifyEd25519(key, message, valid)).toBe(false);
    }
    for (const signature of ['', 'AAAA', '!!!', Buffer.alloc(64).toString('base64').replace(/==$/, '')]) {
      expect(verifyEd25519(vectors.key.public_key_b64, message, signature)).toBe(false);
    }
    expect(() => ed25519PublicKeyFromRaw('AAAA')).toThrow(TypeError);
  });
});

describe('signing vectors through requireServerSignature', () => {
  function extend(app: FastifyInstance): void {
    app.route({
      method: ['GET', 'POST', 'PUT'],
      url: '/api/v1/*',
      preHandler: app.requireServerSignature,
      handler: async (request) => ({ server_id: request.authServer?.server_id ?? null }),
    });
  }
  const t = useTestApp({ modules: [], extend });

  beforeAll(async () => {
    const owner = (await createUser(t().deps, { role: 'server_admin' })).user;
    const server = await t()
      .db.insertInto('servers')
      .values({ server_id: vectors.requests[0]?.server_id ?? '', name: 'Vector Server', owner_user_id: owner.id, status: 'active' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await t()
      .db.insertInto('server_keys')
      .values({ server_id: server.id, public_key: vectors.key.public_key_b64, fingerprint: vectors.key.fingerprint, status: 'active' })
      .execute();
  });

  function inject(request: RequestVector) {
    t().clock.set(Number(request.timestamp));
    (t().store as MemoryShortLivedStore).clear();
    const headers: Record<string, string> = request.headers ?? {
      [SIGNING_HEADERS.SERVER_ID]: request.server_id,
      [SIGNING_HEADERS.TIMESTAMP]: request.timestamp,
      [SIGNING_HEADERS.NONCE]: request.nonce,
      [SIGNING_HEADERS.REQUEST_ID]: request.request_id,
      [SIGNING_HEADERS.PLUGIN_VERSION]: '1.0.0',
      [SIGNING_HEADERS.SIGNATURE]: request.signature_b64,
    };
    const body = Buffer.from(request.body_base64, 'base64');
    return t().app.inject({
      method: request.method.toUpperCase() as 'GET' | 'POST' | 'PUT',
      url: request.path_with_query,
      headers: body.length > 0 ? { ...headers, 'content-type': 'application/json' } : headers,
      ...(body.length > 0 ? { payload: body } : {}),
    });
  }

  it.each(vectors.requests)('accepts $name', async (request) => {
    const res = await inject(request);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ server_id: request.server_id });
  });

  // Raw non-ASCII request targets cannot be sent over HTTP/1.1; covered at the crypto level.
  const httpNegatives = vectors.negative.filter((request) => /^[\x21-\x7e]+$/.test(request.path_with_query));

  it.each(httpNegatives)('rejects $name', async (request) => {
    const res = await inject(request);
    if (request.server_id !== vectors.requests[0]?.server_id) {
      expectError(res, 401, 'UNKNOWN_SERVER');
    } else {
      expectError(res, 401, 'INVALID_SIGNATURE');
    }
  });
});
