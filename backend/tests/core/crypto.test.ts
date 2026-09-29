import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  LINK_CODE_REGEX,
  REGISTRATION_TOKEN_REGEX,
  SERVER_ID_REGEX,
} from '@scpsl-trust/shared';

import { decryptTotpSecret, encryptTotpSecret, generateTotpCode, generateTotpSecret, totpStep } from '../../src/auth/totp';
import {
  createSecretBox,
  decodePublicKeyB64,
  decryptSecret,
  encryptSecret,
  generateEd25519KeyPair,
  hashToken,
  hmacSha256,
  keyFingerprint,
  randomToken,
  sha256Hex,
  timingSafeEqualStr,
} from '../../src/lib/crypto';
import { formatCaseNumber, generateLinkCode, generateRegistrationToken, generateServerId } from '../../src/lib/ids';
import { paginatedResult, toOffset } from '../../src/lib/pagination';
import { createAdjustableClock, createFixedClock } from '../../src/lib/time';

/** users.totp_secret_enc / overwatch secret_enc CHECK regex. */
const DB_SECRET_FORMAT = /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

describe('hashing and tokens', () => {
  it('computes SHA-256 and HMAC-SHA256 (RFC 4231 case 2)', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(Buffer.alloc(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hmacSha256('Jefe', 'what do ya want for nothing?').toString('hex')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('generates unique base64url tokens and hashes them', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(48)).toHaveLength(64);
    expect(() => randomToken(8)).toThrow(RangeError);
    expect(hashToken('abc')).toBe(sha256Hex('abc'));
  });

  it('compares strings in constant time', () => {
    expect(timingSafeEqualStr('same', 'same')).toBe(true);
    expect(timingSafeEqualStr('same', 'Same')).toBe(false);
    expect(timingSafeEqualStr('short', 'longer value')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});

describe('Ed25519 helpers', () => {
  it('derives SHA256 fingerprints of the raw key', () => {
    const pair = generateEd25519KeyPair();
    expect(keyFingerprint(pair.publicKeyB64)).toBe(`SHA256:${sha256Hex(Buffer.from(pair.publicKeyB64, 'base64'))}`);
  });

  it('rejects non-canonical public key encodings', () => {
    const pair = generateEd25519KeyPair();
    expect(decodePublicKeyB64(pair.publicKeyB64)).toHaveLength(32);
    const raw = Buffer.from(pair.publicKeyB64, 'base64');
    for (const bad of [raw.toString('base64').replace(/=$/, ''), raw.toString('base64url'), `${pair.publicKeyB64} `, 'AAAA']) {
      expect(() => decodePublicKeyB64(bad)).toThrow(TypeError);
    }
    // Non-zero padding bits are a second encoding of the same key.
    const lastChar = pair.publicKeyB64.charAt(42);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const alias = alphabet.charAt(alphabet.indexOf(lastChar) + 1);
    expect(() => decodePublicKeyB64(`${pair.publicKeyB64.slice(0, 42)}${alias}=`)).toThrow(TypeError);
  });
});

describe('AES-256-GCM secret encryption', () => {
  const key = randomBytes(32);

  it('round-trips and uses a random IV (DB format v1:iv:ct:tag)', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a).toMatch(DB_SECRET_FORMAT);
    expect(decryptSecret(a, key).toString('utf8')).toBe('JBSWY3DPEHPK3PXP');
    const binary = randomBytes(32);
    expect(decryptSecret(encryptSecret(binary, key), key).equals(binary)).toBe(true);
  });

  it('detects tampering of iv, ciphertext and tag, wrong keys and wrong AAD', () => {
    const encoded = encryptSecret('top secret', key, 'row-1');
    const parts = encoded.split(':');
    const flip = (b64: string): string => {
      const buffer = Buffer.from(b64, 'base64');
      buffer[0] = (buffer[0] ?? 0) ^ 0x01;
      return buffer.toString('base64');
    };
    for (const index of [1, 2, 3]) {
      const tampered = parts.map((part, i) => (i === index ? flip(part) : part)).join(':');
      expect(() => decryptSecret(tampered, key, 'row-1')).toThrow();
    }
    expect(() => decryptSecret(encoded, randomBytes(32), 'row-1')).toThrow();
    expect(() => decryptSecret(encoded, key, 'row-2')).toThrow();
    expect(() => decryptSecret(encoded, key)).toThrow();
    expect(decryptSecret(encoded, key, 'row-1').toString()).toBe('top secret');
  });

  it('rejects malformed input, empty secrets and bad keys', () => {
    for (const bad of ['', 'v2:a:b:c', 'v1:a:b', 'v1:!!:b:c', 'v1:AAAA:AAAA:AAAA', `v1:${'A'.repeat(16)}::${'A'.repeat(24)}`]) {
      expect(() => decryptSecret(bad, key)).toThrow();
    }
    expect(() => encryptSecret('', key)).toThrow(TypeError);
    expect(() => encryptSecret('x', randomBytes(16))).toThrow(TypeError);
    expect(() => createSecretBox(randomBytes(31))).toThrow(TypeError);
  });

  it('binds TOTP secrets to their user', () => {
    const box = createSecretBox(key);
    const secret = generateTotpSecret();
    const encrypted = encryptTotpSecret(box, 'user-a', secret);
    expect(encrypted).toMatch(DB_SECRET_FORMAT);
    expect(decryptTotpSecret(box, 'user-a', encrypted)).toBe(secret);
    expect(() => decryptTotpSecret(box, 'user-b', encrypted)).toThrow();
    const at = new Date('2026-09-29T15:42:20Z');
    expect(generateTotpCode(secret, at)).toMatch(/^\d{6}$/);
    expect(totpStep(at)).toBe(Math.floor(at.getTime() / 30_000));
  });
});

describe('identifiers', () => {
  it('generates server ids, registration tokens and link codes in their formats', () => {
    const serverIds = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = generateServerId();
      expect(id).toMatch(SERVER_ID_REGEX);
      serverIds.add(id);
      expect(generateRegistrationToken()).toMatch(REGISTRATION_TOKEN_REGEX);
      expect(generateLinkCode()).toMatch(LINK_CODE_REGEX);
    }
    expect(serverIds.size).toBe(500);
  });

  it('formats case numbers', () => {
    expect(formatCaseNumber(2026, 1337)).toBe('CASE-2026-001337');
    expect(() => formatCaseNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatCaseNumber(2026, 1_000_000)).toThrow(RangeError);
  });
});

describe('time and pagination helpers', () => {
  it('provides fixed and adjustable clocks', () => {
    const fixed = createFixedClock('2026-01-01T00:00:00Z');
    expect(fixed.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    const clock = createAdjustableClock('2026-01-01T00:00:00Z');
    clock.advanceSeconds(90);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z');
    clock.set(0);
    expect(clock.now().getTime()).toBe(0);
    expect(() => createFixedClock('nope')).toThrow(RangeError);
  });

  it('computes offsets and page envelopes defensively', () => {
    expect(toOffset({ page: 3, page_size: 25 })).toEqual({ limit: 25, offset: 50 });
    expect(toOffset({ page: -5, page_size: 10_000 })).toEqual({ limit: 100, offset: 0 });
    expect(toOffset({})).toEqual({ limit: 25, offset: 0 });
    expect(paginatedResult([1, 2], 7, { page: 2, page_size: 2 })).toEqual({ items: [1, 2], page: 2, page_size: 2, total: 7 });
  });
});
