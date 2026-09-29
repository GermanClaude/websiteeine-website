/**
 * Human-readable identifiers (ARCHITECTURE §2.3). All randomness comes from the CSPRNG.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import {
  CROCKFORD_ALPHABET,
  formatCaseNumber as sharedFormatCaseNumber,
  REGISTRATION_TOKEN_PREFIX,
  SERVER_ID_PREFIX,
  SERVER_ID_RANDOM_LENGTH,
} from '@scpsl-trust/shared';

const CROCKFORD_LOWER = CROCKFORD_ALPHABET.toLowerCase();

/** `count` Crockford base32 characters from 5-bit groups of fresh random bytes (uniform). */
function randomCrockford(count: number, alphabet: string): string {
  const bytes = randomBytes(Math.ceil((count * 5) / 8));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < count) {
      bits -= 5;
      out += alphabet.charAt((value >>> bits) & 0x1f);
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

/** `srv_` + 16 lowercase Crockford base32 chars (80 random bits). */
export function generateServerId(): string {
  return `${SERVER_ID_PREFIX}${randomCrockford(SERVER_ID_RANDOM_LENGTH, CROCKFORD_LOWER)}`;
}

/** `sreg_` + 43 chars base64url (32 random bytes); shown once, stored hashed. */
export function generateRegistrationToken(): string {
  return `${REGISTRATION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** In-game account link code `LNK-XXXXXX` (30 random bits, §6.6). */
export function generateLinkCode(): string {
  return `LNK-${randomCrockford(6, CROCKFORD_ALPHABET)}`;
}

/** `CASE-<yyyy>-<6-digit counter>`. */
export function formatCaseNumber(year: number, counter: number): string {
  return sharedFormatCaseNumber(year, counter);
}

export function generateUuid(): string {
  return randomUUID();
}
