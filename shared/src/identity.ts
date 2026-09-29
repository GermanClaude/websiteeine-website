/**
 * Player identity helpers (ARCHITECTURE §2.2).
 * A player is `{ type, id }`; the canonical string form (SCP:SL UserId) is `<id>@<type>`.
 */
import { PLAYER_ID_TYPES, isPlayerIdType, type PlayerIdType } from './enums';

export interface PlayerRef {
  type: PlayerIdType;
  id: string;
}

/** Raw id validation per type: steam 17 digits, discord 17–20 digits, northwood `[a-z0-9_.-]{1,64}`. */
export const PLAYER_ID_PATTERNS: Readonly<Record<PlayerIdType, RegExp>> = Object.freeze({
  steam: /^\d{17}$/,
  discord: /^\d{17,20}$/,
  northwood: /^[a-z0-9_.-]{1,64}$/,
});

/** Longest possible canonical user id (`<64 chars>@northwood`). */
export const USER_ID_MAX_LENGTH = 64 + 1 + Math.max(...PLAYER_ID_TYPES.map((type) => type.length));

export function isValidPlayerId(type: PlayerIdType, id: string): boolean {
  const pattern = PLAYER_ID_PATTERNS[type];
  return pattern !== undefined && typeof id === 'string' && pattern.test(id);
}

export function isPlayerRef(value: unknown): value is PlayerRef {
  if (typeof value !== 'object' || value === null) return false;
  const { type, id } = value as { type?: unknown; id?: unknown };
  return isPlayerIdType(type) && typeof id === 'string' && isValidPlayerId(type, id);
}

/** `{ type: 'steam', id: '765…' }` → `765…@steam`. Throws on an invalid reference. */
export function toUserId(ref: PlayerRef): string {
  if (!isPlayerRef(ref)) throw new TypeError('Invalid player reference');
  return `${ref.id}@${ref.type}`;
}

/**
 * Parses a canonical user id. Accepts a URL-encoded `@` (`%40`) for path parameters.
 * Returns null for anything invalid (unknown type, bad id format, extra separators).
 */
export function parseUserId(value: string): PlayerRef | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > USER_ID_MAX_LENGTH + 2) return null;
  const decoded = value.replace(/%40/gi, '@');
  const at = decoded.indexOf('@');
  if (at <= 0 || at !== decoded.lastIndexOf('@')) return null;
  const id = decoded.slice(0, at);
  const type = decoded.slice(at + 1);
  if (!isPlayerIdType(type) || !isValidPlayerId(type, id)) return null;
  return { type, id };
}

/** Like parseUserId but throws a TypeError on invalid input. */
export function parseUserIdOrThrow(value: string): PlayerRef {
  const ref = parseUserId(value);
  if (ref === null) throw new TypeError('Invalid player user id');
  return ref;
}

/** True only for the canonical `<id>@<type>` form (no URL encoding). */
export function isCanonicalUserId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ref = parseUserId(value);
  return ref !== null && `${ref.id}@${ref.type}` === value;
}

export function samePlayer(a: PlayerRef, b: PlayerRef): boolean {
  return a.type === b.type && a.id === b.id;
}
