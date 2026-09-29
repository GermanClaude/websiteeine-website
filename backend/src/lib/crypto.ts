/**
 * Cryptographic primitives (Node `crypto` only, ARCHITECTURE §1.1):
 * hashing, HMAC, random tokens, constant-time comparison, Ed25519 (raw 32-byte keys,
 * §2.3/§5) and AES-256-GCM secret encryption (`v1:<iv>:<ct>:<tag>`, §4).
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';

import { KEY_FINGERPRINT_PREFIX, PUBLIC_KEY_B64_REGEX, SIGNATURE_B64_REGEX } from '@scpsl-trust/shared';

export type BinaryLike = string | Buffer | Uint8Array;

function toBuffer(data: BinaryLike): Buffer {
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

/** Lowercase hex SHA-256 (strings are hashed as UTF-8). */
export function sha256Hex(data: BinaryLike): string {
  return createHash('sha256').update(toBuffer(data)).digest('hex');
}

export function hmacSha256(key: BinaryLike, data: BinaryLike): Buffer {
  return createHmac('sha256', toBuffer(key)).update(toBuffer(data)).digest();
}

export function hmacSha256Hex(key: BinaryLike, data: BinaryLike): string {
  return hmacSha256(key, data).toString('hex');
}

/** `bytes` random bytes as unpadded base64url (32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 1024) throw new RangeError('randomToken: 16-1024 bytes');
  return randomBytes(bytes).toString('base64url');
}

/** Storage form of a bearer token: sha256 hex of its UTF-8 bytes. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

/**
 * Constant-time string comparison. Both sides are hashed first, so neither the content
 * nor the length of the expected value leaks through timing.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Ed25519
// ---------------------------------------------------------------------------

/** DER prefixes wrapping raw Ed25519 keys (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Decodes canonical padded base64 of exactly 32 bytes; throws TypeError otherwise. */
export function decodePublicKeyB64(publicKeyB64: string): Buffer {
  if (typeof publicKeyB64 !== 'string' || !PUBLIC_KEY_B64_REGEX.test(publicKeyB64)) {
    throw new TypeError('Public key must be canonical base64 of 32 bytes');
  }
  const raw = Buffer.from(publicKeyB64, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== publicKeyB64) {
    throw new TypeError('Public key must be canonical base64 of 32 bytes');
  }
  return raw;
}

/** Ed25519 public KeyObject from the base64 raw key (§2.3). Throws TypeError on invalid input. */
export function ed25519PublicKeyFromRaw(publicKeyB64: string): KeyObject {
  const raw = decodePublicKeyB64(publicKeyB64);
  try {
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch (err) {
    throw new TypeError('Public key is not a valid Ed25519 key', { cause: err });
  }
}

/** Ed25519 private KeyObject from a 32-byte seed. */
export function ed25519PrivateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new TypeError('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8' });
}

/** Raw 32-byte public key (base64) of an Ed25519 key object (public or private). */
export function ed25519RawPublicKeyB64(key: KeyObject): string {
  const publicKey = key.type === 'private' ? createPublicKey(key) : key;
  const der = publicKey.export({ format: 'der', type: 'spki' });
  if (der.length !== ED25519_SPKI_PREFIX.length + 32 || !der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new TypeError('Not an Ed25519 key');
  }
  return der.subarray(ED25519_SPKI_PREFIX.length).toString('base64');
}

/**
 * Verifies a base64 Ed25519 signature. Never throws: malformed keys or signatures, or
 * any crypto failure, yield `false`.
 */
export function verifyEd25519(publicKey: string | KeyObject, message: BinaryLike, signatureB64: string): boolean {
  try {
    if (typeof signatureB64 !== 'string' || !SIGNATURE_B64_REGEX.test(signatureB64)) return false;
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length !== 64) return false;
    const key = typeof publicKey === 'string' ? ed25519PublicKeyFromRaw(publicKey) : publicKey;
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return cryptoVerify(null, toBuffer(message), key, signature);
  } catch {
    return false;
  }
}

/** Base64 Ed25519 signature (deterministic). */
export function signEd25519(privateKey: KeyObject, message: BinaryLike): string {
  return cryptoSign(null, toBuffer(message), privateKey).toString('base64');
}

export interface Ed25519KeyPair {
  /** Base64 of the 32 raw public-key bytes (wire format). */
  publicKeyB64: string;
  privateKey: KeyObject;
  /** 32-byte private seed as hex (never log or transmit outside tests/tools). */
  seedHex: string;
}

/** Fresh Ed25519 key pair (or deterministic from `seed`). */
export function generateEd25519KeyPair(seed: Uint8Array = randomBytes(32)): Ed25519KeyPair {
  const privateKey = ed25519PrivateKeyFromSeed(seed);
  return { publicKeyB64: ed25519RawPublicKeyB64(privateKey), privateKey, seedHex: Buffer.from(seed).toString('hex') };
}

/** `SHA256:` + lowercase hex SHA-256 over the 32 raw public-key bytes (§2.3). */
export function keyFingerprint(publicKeyB64: string): string {
  return `${KEY_FINGERPRINT_PREFIX}${sha256Hex(decodePublicKeyB64(publicKeyB64))}`;
}

// ---------------------------------------------------------------------------
// AES-256-GCM secret encryption
// ---------------------------------------------------------------------------

const SECRET_FORMAT_VERSION = 'v1';
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError('Encryption key must be 32 bytes');
}

/**
 * Encrypts a secret: `v1:<iv b64>:<ciphertext b64>:<tag b64>`. `aad` (optional) binds the
 * ciphertext to a context (e.g. a row id); the same value is required for decryption.
 */
export function encryptSecret(plaintext: BinaryLike, key: Buffer, aad?: string): string {
  assertKey(key);
  const data = toBuffer(plaintext);
  if (data.length === 0) throw new TypeError('Cannot encrypt an empty secret');
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SECRET_FORMAT_VERSION, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':');
}

/** Decrypts `encryptSecret` output. Throws on any tampering, wrong key or wrong aad. */
export function decryptSecret(encoded: string, key: Buffer, aad?: string): Buffer {
  assertKey(key);
  const parts = typeof encoded === 'string' ? encoded.split(':') : [];
  if (parts.length !== 4 || parts[0] !== SECRET_FORMAT_VERSION) throw new TypeError('Unsupported secret format');
  const [, ivB64 = '', ctB64 = '', tagB64 = ''] = parts;
  if (!B64.test(ivB64) || !B64.test(ctB64) || !B64.test(tagB64)) throw new TypeError('Malformed encrypted secret');
  const iv = Buffer.from(ivB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES || ciphertext.length === 0) {
    throw new TypeError('Malformed encrypted secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_BYTES });
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** encryptSecret/decryptSecret bound to one key (DATA_ENCRYPTION_KEY). */
export interface SecretBox {
  encrypt(plaintext: BinaryLike, aad?: string): string;
  decrypt(encoded: string, aad?: string): Buffer;
}

export function createSecretBox(key: Buffer): SecretBox {
  assertKey(key);
  const keyCopy = Buffer.from(key);
  return {
    encrypt: (plaintext, aad) => encryptSecret(plaintext, keyCopy, aad),
    decrypt: (encoded, aad) => decryptSecret(encoded, keyCopy, aad),
  };
}
