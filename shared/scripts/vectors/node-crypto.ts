/**
 * Node crypto helpers for generating / verifying test vectors (scripts and tests only —
 * never imported from src/, which must stay runtime-agnostic).
 *
 * Ed25519 raw key <-> Node KeyObject:
 * Node has no "raw" import for Ed25519, so the 32 raw bytes are wrapped in fixed DER prefixes
 * (RFC 8410, OID 1.3.101.112 = 06 03 2B 65 70):
 *   private seed (32 B) -> PKCS#8: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 || seed
 *   public key  (32 B) -> SPKI:   30 2a 30 05 06 03 2b 65 70 03 21 00             || public
 * The reverse direction exports DER and drops the prefix (last 32 bytes).
 * BouncyCastle (plugin) uses the raw bytes directly: Ed25519PrivateKeyParameters(seed) /
 * Ed25519PublicKeyParameters(publicKey).
 */
import { createHash, createHmac, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
export const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new RangeError('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export function publicKeyFromRaw(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new RangeError('Ed25519 public key must be 32 bytes');
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
}

/** Raw 32-byte public key of a private or public KeyObject. */
export function rawPublicKey(key: KeyObject): Buffer {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('Unexpected SPKI encoding for Ed25519 public key');
  }
  return der.subarray(ED25519_SPKI_PREFIX.length);
}

export function signEd25519(privateKey: KeyObject, message: string | Uint8Array): Buffer {
  return sign(null, typeof message === 'string' ? Buffer.from(message, 'utf8') : message, privateKey);
}

export function verifyEd25519(publicKey: KeyObject, message: string | Uint8Array, signature: Uint8Array): boolean {
  return verify(null, typeof message === 'string' ? Buffer.from(message, 'utf8') : message, publicKey, signature);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256')
    .update(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
    .digest('hex');
}

/** `SHA256:` + lowercase hex SHA-256 of the raw 32 public-key bytes. */
export function keyFingerprint(rawPublic: Uint8Array): string {
  return `SHA256:${sha256Hex(rawPublic)}`;
}

export function hmacSha256(key: Uint8Array, message: string): Buffer {
  return createHmac('sha256', key).update(Buffer.from(message, 'utf8')).digest();
}

/** Deterministic pseudo-random bytes for fixtures (NOT for real secrets). */
export function fixtureBytes(label: string, length: number): Buffer {
  const out: Buffer[] = [];
  let counter = 0;
  while (Buffer.concat(out).length < length) {
    out.push(createHash('sha256').update(`scpsl-trust-fixture:${label}:${counter}`).digest());
    counter += 1;
  }
  return Buffer.concat(out).subarray(0, length);
}

export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
