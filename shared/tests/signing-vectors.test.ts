import { describe, expect, it } from 'vitest';
import {
  buildCanonicalRequest,
  buildRegistrationPopMessage,
  buildRotationPopMessage,
  KEY_FINGERPRINT_REGEX,
  KeyRotateRequestSchema,
  NONCE_REGEX,
  PLUGIN_VERSION_REGEX,
  PUBLIC_KEY_B64_REGEX,
  REQUEST_ID_REGEX,
  SERVER_ID_REGEX,
  ServerRegisterRequestSchema,
  SIGNATURE_B64_REGEX,
  SIGNING_HEADERS,
  TIMESTAMP_MS_REGEX,
} from '../src';
import {
  keyFingerprint,
  privateKeyFromSeed,
  publicKeyFromRaw,
  rawPublicKey,
  sha256Hex,
  signEd25519,
  verifyEd25519,
} from '../scripts/vectors/node-crypto';
import type { SignedRequestInputs } from '../scripts/vectors/types';
import { loadSigningVectors } from './helpers/vectors';

const vectors = loadSigningVectors();

function canonicalOf(inputs: SignedRequestInputs): string {
  return buildCanonicalRequest({
    method: inputs.method,
    pathWithQuery: inputs.path_with_query,
    serverId: inputs.server_id,
    timestamp: inputs.timestamp,
    nonce: inputs.nonce,
    requestId: inputs.request_id,
    bodySha256Hex: inputs.body_sha256_hex,
  });
}

function verifyWith(publicKeyB64: string, message: string, signatureB64: string): boolean {
  return verifyEd25519(publicKeyFromRaw(Buffer.from(publicKeyB64, 'base64')), message, Buffer.from(signatureB64, 'base64'));
}

describe('signing.json — keys', () => {
  it('matches the RFC 8032 §7.1 TEST 1 known answer (raw key <-> KeyObject conversion)', () => {
    const rfc = vectors.rfc8032_test_1;
    const key = privateKeyFromSeed(Buffer.from(rfc.seed_hex, 'hex'));
    expect(rawPublicKey(key).toString('hex')).toBe(rfc.public_key_hex);
    expect(signEd25519(key, Buffer.from(rfc.message_hex, 'hex')).toString('hex')).toBe(rfc.signature_hex);
  });

  it.each([
    ['key', vectors.key, '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'],
    ['rotation_key', vectors.rotation_key, '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f'],
  ])('%s derives public key and fingerprint from its fixed seed', (_name, key, seedHex) => {
    expect(key.seed_hex).toBe(seedHex);
    const raw = rawPublicKey(privateKeyFromSeed(Buffer.from(key.seed_hex, 'hex')));
    expect(raw.toString('hex')).toBe(key.public_key_hex);
    expect(raw.toString('base64')).toBe(key.public_key_b64);
    expect(key.public_key_b64).toMatch(PUBLIC_KEY_B64_REGEX);
    expect(key.fingerprint).toBe(keyFingerprint(raw));
    expect(key.fingerprint).toMatch(KEY_FINGERPRINT_REGEX);
  });
});

describe('signing.json — signed requests', () => {
  it('covers the required request shapes', () => {
    expect(vectors.requests.length).toBeGreaterThanOrEqual(6);
    const methods = new Set(vectors.requests.map((r) => r.method.toUpperCase()));
    expect(methods).toEqual(new Set(['GET', 'POST', 'PUT']));
    expect(vectors.requests.some((r) => r.path_with_query.includes('?'))).toBe(true);
    expect(vectors.requests.some((r) => r.body === '' && r.method === 'POST')).toBe(true);
    expect(vectors.requests.some((r) => /[^\u0000-\u007f]/.test(r.body))).toBe(true);
  });

  it.each(vectors.requests.map((r) => [r.name, r] as const))('%s: canonical string, hash and signature', (_name, request) => {
    const bodyBytes = Buffer.from(request.body_base64, 'base64');
    expect(bodyBytes.equals(Buffer.from(request.body, 'utf8'))).toBe(true);
    expect(sha256Hex(bodyBytes)).toBe(request.body_sha256_hex);

    const canonical = canonicalOf(request);
    expect(canonical).toBe(request.canonical);
    expect(canonical).toBe(
      [
        'SCPSL-TRUST-V1',
        request.method.toUpperCase(),
        request.path_with_query,
        request.server_id,
        request.timestamp,
        request.nonce,
        request.request_id,
        request.body_sha256_hex,
      ].join('\n'),
    );
    expect(canonical.endsWith('\n')).toBe(false);

    expect(verifyWith(vectors.key.public_key_b64, canonical, request.signature_b64)).toBe(true);
    // Ed25519 is deterministic: re-signing yields the identical signature.
    const resigned = signEd25519(privateKeyFromSeed(Buffer.from(vectors.key.seed_hex, 'hex')), canonical);
    expect(resigned.toString('base64')).toBe(request.signature_b64);
  });

  it.each(vectors.requests.map((r) => [r.name, r] as const))('%s: headers are well-formed', (_name, request) => {
    const headers = request.headers;
    expect(headers[SIGNING_HEADERS.SERVER_ID]).toMatch(SERVER_ID_REGEX);
    expect(headers[SIGNING_HEADERS.TIMESTAMP]).toMatch(TIMESTAMP_MS_REGEX);
    expect(headers[SIGNING_HEADERS.NONCE]).toMatch(NONCE_REGEX);
    expect(headers[SIGNING_HEADERS.NONCE]).toHaveLength(24);
    expect(headers[SIGNING_HEADERS.REQUEST_ID]).toMatch(REQUEST_ID_REGEX);
    expect(headers[SIGNING_HEADERS.PLUGIN_VERSION]).toMatch(PLUGIN_VERSION_REGEX);
    expect(headers[SIGNING_HEADERS.SIGNATURE]).toMatch(SIGNATURE_B64_REGEX);
    expect(headers[SIGNING_HEADERS.SIGNATURE]).toBe(request.signature_b64);
    const fingerprint = headers[SIGNING_HEADERS.KEY_FINGERPRINT];
    if (fingerprint !== undefined) expect(fingerprint).toBe(vectors.key.fingerprint);
  });

  it('the rotate request carries the rotation PoP as its body', () => {
    const rotate = vectors.requests.find((r) => r.name === 'post_key_rotate');
    expect(rotate).toBeDefined();
    expect(JSON.parse(rotate?.body ?? 'null')).toEqual(vectors.rotation_pop.request_body);
  });
});

describe('signing.json — negative cases', () => {
  it('covers every tampered component', () => {
    const names = vectors.negative.map((n) => n.name);
    for (const expected of [
      'tampered_body',
      'tampered_path',
      'tampered_query',
      'tampered_timestamp',
      'tampered_nonce',
      'tampered_method',
      'tampered_server_id',
      'tampered_request_id',
      'wrong_key',
      'signature_bit_flip',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(vectors.negative.map((n) => [n.name, n] as const))('%s must not verify', (_name, vector) => {
    expect(vector.expected_valid).toBe(false);
    expect(sha256Hex(Buffer.from(vector.body, 'utf8'))).toBe(vector.body_sha256_hex);
    const canonical = canonicalOf(vector);
    expect(canonical).toBe(vector.canonical);
    expect(verifyWith(vector.public_key_b64, canonical, vector.signature_b64)).toBe(false);
    const original = vectors.requests.find((r) => r.name === vector.based_on);
    expect(original).toBeDefined();
    if (vector.name !== 'wrong_key' && vector.name !== 'signature_bit_flip') {
      expect(canonical).not.toBe(original?.canonical);
    }
  });
});

describe('signing.json — proof of possession', () => {
  it('registration PoP message and signature', () => {
    const pop = vectors.registration_pop;
    const message = buildRegistrationPopMessage(pop.registration_token, pop.public_key_b64, pop.timestamp);
    expect(message).toBe(pop.message);
    expect(message).toBe(`SCPSL-TRUST-REGISTER-V1\n${pop.registration_token}\n${pop.public_key_b64}\n${pop.timestamp}`);
    expect(verifyWith(pop.public_key_b64, message, pop.signature_b64)).toBe(true);
    expect(ServerRegisterRequestSchema.safeParse(pop.request_body).success).toBe(true);
  });

  it('rotation PoP is signed by the NEW key only', () => {
    const pop = vectors.rotation_pop;
    const message = buildRotationPopMessage(pop.server_id, pop.new_public_key_b64, pop.timestamp);
    expect(message).toBe(pop.message);
    expect(message).toBe(`SCPSL-TRUST-ROTATE-V1\n${pop.server_id}\n${pop.new_public_key_b64}\n${pop.timestamp}`);
    expect(verifyWith(pop.new_public_key_b64, message, pop.signature_b64)).toBe(true);
    expect(verifyWith(vectors.key.public_key_b64, message, pop.signature_b64)).toBe(false);
    expect(pop.new_key_fingerprint).toBe(vectors.rotation_key.fingerprint);
    expect(pop.current_key_fingerprint).toBe(vectors.key.fingerprint);
    expect(KeyRotateRequestSchema.safeParse(pop.request_body).success).toBe(true);
  });

  it.each(vectors.pop_negative.map((n) => [n.name, n] as const))('%s must not verify', (_name, vector) => {
    expect(verifyWith(vector.public_key_b64, vector.message, vector.signature_b64)).toBe(false);
  });
});
