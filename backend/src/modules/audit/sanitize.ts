/**
 * Audit metadata sanitizer (ARCHITECTURE §9.1: metadata never contains passwords, tokens,
 * keys, raw IPs or evidence content). Applied to every event before hashing, so the stored
 * and hashed metadata are identical.
 *
 * - keys that name secrets (password, token, secret, private_key, ip, cookie, code, …) are dropped;
 * - string values that are IP addresses are replaced by "[redacted]";
 * - values are reduced to JSON types (Date → ISO string, bigint → string, NUL removed);
 * - depth, array length, string length and total size are bounded.
 */
import ipaddr from 'ipaddr.js';

export const AUDIT_METADATA_LIMITS = Object.freeze({
  MAX_DEPTH: 6,
  MAX_KEYS: 64,
  MAX_ARRAY_ITEMS: 100,
  MAX_STRING_LENGTH: 2_000,
  MAX_TOTAL_BYTES: 16_384,
});

export const REDACTED = '[redacted]';

/** Key tokens (after splitting snake/camel/kebab case) that mark a key as sensitive. */
const SENSITIVE_TOKENS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'passphrase',
  'secret',
  'token',
  'cookie',
  'authorization',
  'signature',
  'seed',
  'otp',
  'totp',
  'ip',
  'ipv4',
  'ipv6',
  'credential',
  'credentials',
  'apikey',
  'privatekey',
]);

/** Whole (normalized) keys that are sensitive although none of their tokens is. */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'code',
  'mfa_code',
  'recovery_code',
  'recovery_codes',
  'private_key',
  'secret_key',
  'api_key',
  'access_key',
  'session_key',
  'signing_key',
  'ip_address',
  'remote_address',
  'x_forwarded_for',
  'content',
  'file_content',
  'body',
  'raw_body',
]);

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s.-]+/g, '_');
}

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return normalized.split('_').some((token) => SENSITIVE_TOKENS.has(token));
}

function looksLikeIp(value: string): boolean {
  if (value.length < 7 || value.length > 64) return false;
  if (ipaddr.IPv4.isValidFourPartDecimal(value)) return true;
  return value.includes(':') && ipaddr.IPv6.isValid(value);
}

function sanitizeString(value: string): string {
  const cleaned = value.replace(/\u0000/g, '');
  if (looksLikeIp(cleaned.trim())) return REDACTED;
  return cleaned.length > AUDIT_METADATA_LIMITS.MAX_STRING_LENGTH
    ? `${cleaned.slice(0, AUDIT_METADATA_LIMITS.MAX_STRING_LENGTH)}…`
    : cleaned;
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return sanitizeString(value);
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (depth >= AUDIT_METADATA_LIMITS.MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) {
    return value
      .slice(0, AUDIT_METADATA_LIMITS.MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1))
      .map((item) => (item === undefined ? null : item));
  }
  // Buffers, Maps, class instances, … may carry content: never recorded.
  if (!isPlainObject(value)) return undefined;
  return sanitizeObject(value, depth + 1);
}

function sanitizeObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= AUDIT_METADATA_LIMITS.MAX_KEYS) break;
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || isSensitiveKey(key)) continue;
    const value = sanitizeValue(input[key], depth);
    if (value === undefined) continue;
    out[key.replace(/\u0000/g, '')] = value;
    count += 1;
  }
  return out;
}

export interface SanitizeResult {
  metadata: Record<string, unknown>;
  /** True when the metadata exceeded MAX_TOTAL_BYTES and was replaced. */
  truncated: boolean;
}

/** Sanitized, JSON-safe copy of event metadata. */
export function sanitizeAuditMetadata(input: Record<string, unknown> | null | undefined): SanitizeResult {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
    return { metadata: {}, truncated: false };
  }
  const metadata = sanitizeObject(input, 0);
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > AUDIT_METADATA_LIMITS.MAX_TOTAL_BYTES) {
    return { metadata: { metadata_truncated: true }, truncated: true };
  }
  return { metadata, truncated: false };
}
