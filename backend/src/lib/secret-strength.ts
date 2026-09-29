/**
 * Heuristic strength checks for configuration secrets (ARCHITECTURE §16: production refuses
 * missing/weak secrets). A secret passes when it carries at least 32 bytes of material,
 * has an estimated entropy of at least 128 bits and is not an obvious placeholder.
 * Generate secrets with `openssl rand -base64 32` (or `-hex 32`).
 */

export const MIN_SECRET_BYTES = 32;
export const MIN_SECRET_ENTROPY_BITS = 128;

export type SecretWeakness = 'too_short' | 'low_entropy' | 'placeholder' | 'repetitive';

const PLACEHOLDER_PATTERN =
  /change[-_ ]?me|changeit|replace[-_ ]?me|example|placeholder|secret|password|dummy|insecure|default|sample|development|testing/i;
const HEX = /^[0-9a-fA-F]+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Bytes of key material the string encodes (hex / base64 decode, else UTF-8 length). */
export function secretMaterialBytes(secret: string): number {
  if (HEX.test(secret) && secret.length % 2 === 0) return secret.length / 2;
  if (BASE64.test(secret) || BASE64URL.test(secret)) {
    const unpadded = secret.replace(/=+$/, '');
    return Math.floor((unpadded.length * 6) / 8);
  }
  return Buffer.byteLength(secret, 'utf8');
}

/** Empirical Shannon entropy of the character distribution × length (upper-bound estimate). */
export function estimateEntropyBits(secret: string): number {
  const chars = [...secret];
  if (chars.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of chars) counts.set(char, (counts.get(char) ?? 0) + 1);
  let perChar = 0;
  for (const count of counts.values()) {
    const p = count / chars.length;
    perChar -= p * Math.log2(p);
  }
  return perChar * chars.length;
}

/** Weaknesses of a secret (empty array = acceptable). The secret itself is never echoed. */
export function assessSecret(secret: string): SecretWeakness[] {
  const problems: SecretWeakness[] = [];
  if (secretMaterialBytes(secret) < MIN_SECRET_BYTES) problems.push('too_short');
  if (estimateEntropyBits(secret) < MIN_SECRET_ENTROPY_BITS) problems.push('low_entropy');
  if (PLACEHOLDER_PATTERN.test(secret)) problems.push('placeholder');
  if (new Set(secret).size < 10 || /(.)\1{7,}/.test(secret)) problems.push('repetitive');
  return problems;
}

/** Weaknesses of a raw 32-byte key (e.g. DATA_ENCRYPTION_KEY). */
export function assessKeyBytes(key: Buffer): SecretWeakness[] {
  const problems: SecretWeakness[] = [];
  if (key.length < MIN_SECRET_BYTES) problems.push('too_short');
  if (new Set(key).size < 12) problems.push('repetitive');
  return problems;
}
