/**
 * Password hashing (Argon2id, m=19456 KiB, t=2, p=1 — ARCHITECTURE §1.1) and the password
 * policy of §12.2 (10–128 chars, not equal to email/username) plus basic weakness checks.
 */
import argon2 from 'argon2';

import { LIMITS } from '@scpsl-trust/shared';

export const ARGON2_PARAMS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0 || password.length > LIMITS.PASSWORD_MAX) {
    throw new RangeError('Password length out of range');
  }
  return argon2.hash(password, ARGON2_PARAMS);
}

/** Constant-work verification; false for malformed hashes (never throws). */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > LIMITS.PASSWORD_MAX) return false;
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash uses other parameters than ARGON2_PARAMS (re-hash on login). */
export function needsRehash(passwordHash: string): boolean {
  try {
    return argon2.needsRehash(passwordHash, {
      memoryCost: ARGON2_PARAMS.memoryCost,
      timeCost: ARGON2_PARAMS.timeCost,
      parallelism: ARGON2_PARAMS.parallelism,
    });
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same work as a real verification (unknown account, locked account, …) so
 * response timing does not reveal whether an email exists (§12.2). Always resolves false.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= argon2.hash('dummy-password-for-timing-equalization', ARGON2_PARAMS);
  await verifyPassword(await dummyHash, typeof password === 'string' ? password.slice(0, LIMITS.PASSWORD_MAX) : '');
  return false;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'equals_identity'
  | 'contains_identity'
  | 'common'
  | 'repetitive'
  | 'low_variety';

/** A small deny-list of the most common passwords (checked case-insensitively). */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  '1234567890',
  '0123456789',
  '1q2w3e4r5t',
  '1qaz2wsx3edc',
  'abcdefghij',
  'administrator',
  'changeme123',
  'football123',
  'iloveyou123',
  'letmein1234',
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'qwertyuiop',
  'qwerty12345',
  'qwerty123456',
  'superadmin',
  'welcome123',
  'trustno1234',
  'scpsl-trust',
  'scpsltrust123',
]);

export interface PasswordIdentity {
  email?: string | null;
  username?: string | null;
}

function characterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes += 1;
  if (/[A-Z]/.test(password)) classes += 1;
  if (/[0-9]/.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/.test(password)) classes += 1;
  return classes;
}

/** Returns every rule the password violates (empty = acceptable). */
export function checkPasswordPolicy(password: string, identity: PasswordIdentity = {}): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < LIMITS.PASSWORD_MIN) problems.push('too_short');
  if (password.length > LIMITS.PASSWORD_MAX) problems.push('too_long');

  const lowered = password.toLowerCase();
  const identities = [identity.email ?? '', identity.username ?? '', (identity.email ?? '').split('@')[0] ?? '']
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  if (identities.some((value) => value === lowered)) problems.push('equals_identity');
  else if (identities.some((value) => value.length >= 4 && lowered.includes(value))) problems.push('contains_identity');

  if (COMMON_PASSWORDS.has(lowered)) problems.push('common');
  if (new Set(password).size <= 3 || /(.)\1{5,}/.test(password)) problems.push('repetitive');
  // Long passphrases may use a single class; short passwords need some variety.
  if (password.length < 16 && characterClasses(password) < 2) problems.push('low_variety');
  return problems;
}

const PROBLEM_TEXT: Record<PasswordProblem, string> = {
  too_short: `must be at least ${LIMITS.PASSWORD_MIN} characters`,
  too_long: `must be at most ${LIMITS.PASSWORD_MAX} characters`,
  equals_identity: 'must not equal the email or username',
  contains_identity: 'must not contain the email or username',
  common: 'is too common',
  repetitive: 'is too repetitive',
  low_variety: 'needs at least two character classes (or 16+ characters)',
};

export function describePasswordProblems(problems: readonly PasswordProblem[]): string[] {
  return problems.map((problem) => `Password ${PROBLEM_TEXT[problem]}`);
}
