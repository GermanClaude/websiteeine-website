/**
 * TOTP (RFC 6238, ARCHITECTURE §12.2) parameters and the storage format of
 * users.totp_secret_enc, shared by the auth module, CLIs and test factories:
 *
 *   totp_secret_enc = secretBox.encrypt(<base32 secret>, "totp:v1:" + users.id)
 *
 * The AAD binds the ciphertext to its user row (a copied ciphertext does not decrypt for
 * another user).
 */
import { Secret, TOTP } from 'otpauth';

import type { SecretBox } from '../lib/crypto';

export const TOTP_ISSUER = 'SCP:SL Trust Network';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = 'SHA1';

export function totpSecretAad(userId: string): string {
  return `totp:v1:${userId}`;
}

/** Fresh 160-bit secret, base32 encoded. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function encryptTotpSecret(secretBox: SecretBox, userId: string, base32Secret: string): string {
  return secretBox.encrypt(base32Secret, totpSecretAad(userId));
}

export function decryptTotpSecret(secretBox: SecretBox, userId: string, encrypted: string): string {
  return secretBox.decrypt(encrypted, totpSecretAad(userId)).toString('utf8');
}

export function createTotp(base32Secret: string, label = 'account'): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
    secret: Secret.fromBase32(base32Secret),
  });
}

/** Current TOTP code at `at` (tests, tools). */
export function generateTotpCode(base32Secret: string, at: Date): string {
  return createTotp(base32Secret).generate({ timestamp: at.getTime() });
}

/** TOTP time step of an instant (for users.totp_last_used_step replay protection). */
export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}
