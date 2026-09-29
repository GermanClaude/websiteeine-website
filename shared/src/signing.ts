/**
 * Server request signing and Overwatch proof-code derivation (ARCHITECTURE §5, §10.2).
 *
 * Pure string/byte manipulation only — no crypto. Callers hash/sign/HMAC with their
 * platform crypto (Node `crypto`, BouncyCastle in the plugin). Every builder here is
 * mirrored in C# and verified against shared/test-vectors.
 */
import { CROCKFORD_ALPHABET, SHA256_HEX_REGEX } from './formats';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SIGNING_VERSION = 'SCPSL-TRUST-V1';
export const REGISTRATION_POP_VERSION = 'SCPSL-TRUST-REGISTER-V1';
export const ROTATION_POP_VERSION = 'SCPSL-TRUST-ROTATE-V1';
export const PROOF_MESSAGE_VERSION = 'SCPSL-TRUST-PROOF-V1';

/** Signed-request headers as sent by the plugin (§5.3). */
export const SIGNING_HEADERS = {
  SERVER_ID: 'X-Server-Id',
  TIMESTAMP: 'X-Timestamp',
  NONCE: 'X-Nonce',
  REQUEST_ID: 'X-Request-Id',
  KEY_FINGERPRINT: 'X-Key-Fingerprint',
  PLUGIN_VERSION: 'X-Plugin-Version',
  SIGNATURE: 'X-Signature',
} as const;
export type SigningHeader = (typeof SIGNING_HEADERS)[keyof typeof SIGNING_HEADERS];

/** Lower-case header names (Node's `IncomingHttpHeaders` keys). */
export const SIGNING_HEADERS_LOWER = {
  SERVER_ID: 'x-server-id',
  TIMESTAMP: 'x-timestamp',
  NONCE: 'x-nonce',
  REQUEST_ID: 'x-request-id',
  KEY_FINGERPRINT: 'x-key-fingerprint',
  PLUGIN_VERSION: 'x-plugin-version',
  SIGNATURE: 'x-signature',
} as const;
export type SigningHeaderLower = (typeof SIGNING_HEADERS_LOWER)[keyof typeof SIGNING_HEADERS_LOWER];

/** Headers that must be present on every signed request (X-Key-Fingerprint is optional). */
export const REQUIRED_SIGNING_HEADERS_LOWER: readonly SigningHeaderLower[] = Object.freeze([
  SIGNING_HEADERS_LOWER.SERVER_ID,
  SIGNING_HEADERS_LOWER.TIMESTAMP,
  SIGNING_HEADERS_LOWER.NONCE,
  SIGNING_HEADERS_LOWER.REQUEST_ID,
  SIGNING_HEADERS_LOWER.PLUGIN_VERSION,
  SIGNING_HEADERS_LOWER.SIGNATURE,
]);

/** SHA-256 of the empty byte string (hash used for requests without body). */
export const EMPTY_BODY_SHA256_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const KEY_FINGERPRINT_PREFIX = 'SHA256:';
export const DEFAULT_SIGNATURE_MAX_SKEW_SECONDS = 60;
/** Allowed |now − timestamp| for registration / rotation proof of possession (§5.2). */
export const POP_MAX_SKEW_SECONDS = 300;
export const DEFAULT_KEY_ROTATION_GRACE_SECONDS = 600;

// ---------------------------------------------------------------------------
// Validation regexes
// ---------------------------------------------------------------------------

/** X-Nonce: 16–64 chars base64url. */
export const NONCE_REGEX = /^[A-Za-z0-9_-]{16,64}$/;
/** server_id: `srv_` + 16 chars lowercase Crockford base32. */
export const SERVER_ID_REGEX = /^srv_[0-9a-hjkmnp-tv-z]{16}$/;
/** X-Request-Id: UUID v4 (hex case-insensitive; used verbatim in the canonical string). */
export const REQUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Key fingerprint: `SHA256:` + 64 lowercase hex chars. */
export const KEY_FINGERPRINT_REGEX = /^SHA256:[0-9a-f]{64}$/;
/** X-Timestamp: unix epoch milliseconds, decimal without sign or leading zeros. */
export const TIMESTAMP_MS_REGEX = /^(?:0|[1-9][0-9]{0,15})$/;
/** Canonical padded base64 of exactly 32 bytes (padding bits zero). */
export const BASE64_32_BYTES_REGEX = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
/** Ed25519 public key: canonical base64 of the 32 raw bytes. */
export const PUBLIC_KEY_B64_REGEX = BASE64_32_BYTES_REGEX;
/** Canonical padded base64 of exactly 64 bytes (Ed25519 signature). */
export const SIGNATURE_B64_REGEX = /^[A-Za-z0-9+/]{85}[AQgw]==$/;
/** X-Plugin-Version: semantic version. */
export const PLUGIN_VERSION_REGEX =
  /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-[0-9A-Za-z.-]{1,32})?(?:\+[0-9A-Za-z.-]{1,32})?$/;
/** HTTP method token after upper-casing. */
const METHOD_REGEX = /^[A-Z]{1,16}$/;
/** Characters that can never appear in a request target or canonical field. */
const FORBIDDEN_FIELD_CHARS = /[\x00-\x20\x7f]/;

// ---------------------------------------------------------------------------
// Canonical request (§5.3)
// ---------------------------------------------------------------------------

export interface CanonicalRequestParts {
  /** HTTP method; upper-cased by the builder. */
  method: string;
  /** Path including the query string exactly as sent, e.g. `/api/v1/servers/policy?x=1`. */
  pathWithQuery: string;
  serverId: string;
  /** Unix epoch milliseconds (number, or the decimal X-Timestamp header value). */
  timestamp: number | string;
  nonce: string;
  requestId: string;
  /** Lowercase hex SHA-256 of the raw body bytes (EMPTY_BODY_SHA256_HEX for no body). */
  bodySha256Hex: string;
}

function assertField(name: string, value: string): void {
  if (value.length === 0) throw new TypeError(`Canonical request field "${name}" must not be empty`);
  if (FORBIDDEN_FIELD_CHARS.test(value)) {
    throw new TypeError(`Canonical request field "${name}" contains whitespace or control characters`);
  }
}

/** Decimal representation of a unix-ms timestamp; throws on anything non-canonical. */
export function formatTimestampMs(timestamp: number | string): string {
  if (typeof timestamp === 'number') {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError('Timestamp must be a non-negative safe integer (unix ms)');
    }
    return String(timestamp);
  }
  if (!TIMESTAMP_MS_REGEX.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
    throw new TypeError('Timestamp must be a canonical decimal unix-ms value');
  }
  return timestamp;
}

/**
 * Builds the string that is signed with Ed25519 (UTF-8, `\n` separators, no trailing newline):
 * SCPSL-TRUST-V1, METHOD, path?query, server_id, timestamp, nonce, request_id, body sha256 hex.
 */
export function buildCanonicalRequest(parts: CanonicalRequestParts): string {
  const method = parts.method.toUpperCase();
  if (!METHOD_REGEX.test(method)) throw new TypeError('Invalid HTTP method');
  if (!parts.pathWithQuery.startsWith('/')) throw new TypeError('pathWithQuery must start with "/"');
  assertField('pathWithQuery', parts.pathWithQuery);
  assertField('serverId', parts.serverId);
  assertField('nonce', parts.nonce);
  assertField('requestId', parts.requestId);
  if (!SHA256_HEX_REGEX.test(parts.bodySha256Hex)) {
    throw new TypeError('bodySha256Hex must be 64 lowercase hex characters');
  }
  return [
    SIGNING_VERSION,
    method,
    parts.pathWithQuery,
    parts.serverId,
    formatTimestampMs(parts.timestamp),
    parts.nonce,
    parts.requestId,
    parts.bodySha256Hex,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Proof of possession (§5.2, §5.5)
// ---------------------------------------------------------------------------

/** `SCPSL-TRUST-REGISTER-V1\n<token>\n<public_key b64>\n<timestamp ms>` — signed by the new key. */
export function buildRegistrationPopMessage(
  registrationToken: string,
  publicKeyB64: string,
  timestampMs: number | string,
): string {
  assertField('registrationToken', registrationToken);
  assertField('publicKey', publicKeyB64);
  return [REGISTRATION_POP_VERSION, registrationToken, publicKeyB64, formatTimestampMs(timestampMs)].join('\n');
}

/** `SCPSL-TRUST-ROTATE-V1\n<server_id>\n<new_public_key b64>\n<timestamp ms>` — signed by the NEW key. */
export function buildRotationPopMessage(
  serverId: string,
  newPublicKeyB64: string,
  timestampMs: number | string,
): string {
  assertField('serverId', serverId);
  assertField('newPublicKey', newPublicKeyB64);
  return [ROTATION_POP_VERSION, serverId, newPublicKeyB64, formatTimestampMs(timestampMs)].join('\n');
}

// ---------------------------------------------------------------------------
// Overwatch proof codes (§10.2)
// ---------------------------------------------------------------------------

/** Crockford base32 alphabet used for proof codes. */
export const PROOF_ALPHABET = CROCKFORD_ALPHABET;
/** `XXX-XXX` over PROOF_ALPHABET. */
export const PROOF_CODE_REGEX = /^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/;
/** Windows accepted by the proof API relative to the timestamp's window, in check order. */
export const PROOF_ACCEPTED_WINDOW_OFFSETS: readonly (-1 | 0 | 1)[] = Object.freeze([0, -1, 1] as const);

export const OVERWATCH_MIN_INTERVAL_SECONDS = 5;
export const OVERWATCH_MAX_INTERVAL_SECONDS = 60;
export const OVERWATCH_DEFAULT_INTERVAL_SECONDS = 10;
export const OVERWATCH_HEARTBEAT_INTERVAL_SECONDS = 30;

export interface ProofMessageParts {
  sessionId: string;
  serverId: string;
  /** Canonical `<id>@<type>` of the spectated player. */
  targetUserId: string;
  /** Canonical `<id>@<type>` of the spectating staff member. */
  spectatorUserId: string;
  /** floor(unix_seconds / interval_seconds). */
  window: number;
}

function assertProofField(name: string, value: string): void {
  assertField(name, value);
  if (value.includes('|')) throw new TypeError(`Proof message field "${name}" must not contain "|"`);
}

/** `SCPSL-TRUST-PROOF-V1|session|server|target|spectator|window` — HMAC-SHA256 input. */
export function buildProofMessage(parts: ProofMessageParts): string {
  assertProofField('sessionId', parts.sessionId);
  assertProofField('serverId', parts.serverId);
  assertProofField('targetUserId', parts.targetUserId);
  assertProofField('spectatorUserId', parts.spectatorUserId);
  if (!Number.isSafeInteger(parts.window) || parts.window < 0) {
    throw new TypeError('Proof window must be a non-negative safe integer');
  }
  return [
    PROOF_MESSAGE_VERSION,
    parts.sessionId,
    parts.serverId,
    parts.targetUserId,
    parts.spectatorUserId,
    String(parts.window),
  ].join('|');
}

function assertInterval(intervalSeconds: number): void {
  if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1) {
    throw new RangeError('intervalSeconds must be a positive integer');
  }
}

/** w = floor(unix_seconds / interval_seconds). */
export function proofWindow(unixSeconds: number, intervalSeconds: number): number {
  assertInterval(intervalSeconds);
  if (!Number.isFinite(unixSeconds) || unixSeconds < 0) {
    throw new RangeError('unixSeconds must be a non-negative finite number');
  }
  return Math.floor(Math.floor(unixSeconds) / intervalSeconds);
}

/** Window of a unix-milliseconds timestamp. */
export function proofWindowFromMs(epochMs: number, intervalSeconds: number): number {
  if (!Number.isFinite(epochMs) || epochMs < 0) throw new RangeError('epochMs must be a non-negative finite number');
  return proofWindow(Math.floor(epochMs / 1000), intervalSeconds);
}

/** Window bounds in unix seconds: [startSeconds, endSeconds) (end exclusive). */
export function proofWindowBounds(window: number, intervalSeconds: number): { startSeconds: number; endSeconds: number } {
  assertInterval(intervalSeconds);
  if (!Number.isSafeInteger(window) || window < 0) throw new RangeError('window must be a non-negative integer');
  return { startSeconds: window * intervalSeconds, endSeconds: (window + 1) * intervalSeconds };
}

/**
 * Proof code from an HMAC-SHA256 digest: v = big-endian uint32(mac[0..3]) >>> 2 (30 bits),
 * six 5-bit groups from the most significant end → `XXX-XXX`.
 */
export function proofCodeFromMac(mac: Uint8Array): string {
  if (mac.length < 4) throw new RangeError('MAC must contain at least 4 bytes');
  const b0 = mac[0] ?? 0;
  const b1 = mac[1] ?? 0;
  const b2 = mac[2] ?? 0;
  const b3 = mac[3] ?? 0;
  const value = (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0) >>> 2;
  let chars = '';
  for (let i = 0; i < 6; i += 1) {
    chars += PROOF_ALPHABET.charAt((value >>> (25 - 5 * i)) & 0x1f);
  }
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/**
 * Normalizes user input to `XXX-XXX`: trims, upper-cases, drops spaces/dashes and maps the
 * Crockford aliases O→0, I→1, L→1. Returns null when the input is not a valid code.
 */
export function normalizeProofCode(input: string): string | null {
  if (input.length > 16) return null;
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (compact.length !== 6) return null;
  for (const char of compact) {
    if (!PROOF_ALPHABET.includes(char)) return null;
  }
  return `${compact.slice(0, 3)}-${compact.slice(3)}`;
}
