/**
 * Human-readable identifier formats (ARCHITECTURE §2.3) that are not part of request signing.
 */

/** Crockford base32 alphabet (no I, L, O, U). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const SERVER_ID_PREFIX = 'srv_';
export const SERVER_ID_RANDOM_LENGTH = 16;

/** `sreg_` + 43 chars base64url (32 random bytes). */
export const REGISTRATION_TOKEN_PREFIX = 'sreg_';
export const REGISTRATION_TOKEN_REGEX = /^sreg_[A-Za-z0-9_-]{43}$/;

/** `CASE-<yyyy>-<6 digit per-year counter>`. */
export const CASE_NUMBER_REGEX = /^CASE-(\d{4})-(\d{6})$/;
export const CASE_COUNTER_MAX = 999_999;

/** In-game account link code, e.g. `LNK-7K4X92` (§6.6). */
export const LINK_CODE_REGEX = /^LNK-[0-9A-HJKMNP-TV-Z]{6}$/;

/** users.username: 3–32 `[A-Za-z0-9_.-]`. */
export const USERNAME_REGEX = /^[A-Za-z0-9_.-]{3,32}$/;

/** Lowercase hex SHA-256 digest. */
export const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

/** User token (email verification / password reset): base64url of ≥ 24 random bytes. */
export const USER_TOKEN_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

export function formatCaseNumber(year: number, counter: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`Case year out of range: ${year}`);
  }
  if (!Number.isInteger(counter) || counter < 1 || counter > CASE_COUNTER_MAX) {
    throw new RangeError(`Case counter out of range: ${counter}`);
  }
  return `CASE-${year}-${String(counter).padStart(6, '0')}`;
}

export function parseCaseNumber(value: string): { year: number; counter: number } | null {
  const match = CASE_NUMBER_REGEX.exec(value);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const counter = Number(match[2]);
  if (counter < 1) return null;
  return { year: Number(match[1]), counter };
}

export function isCaseNumber(value: unknown): value is string {
  return typeof value === 'string' && parseCaseNumber(value) !== null;
}

/** Public reviewer pseudonym, e.g. `Reviewer #184`. */
export function formatReviewerPseudonym(reviewerNumber: number): string {
  if (!Number.isInteger(reviewerNumber) || reviewerNumber < 1) {
    throw new RangeError(`Invalid reviewer number: ${reviewerNumber}`);
  }
  return `Reviewer #${reviewerNumber}`;
}
