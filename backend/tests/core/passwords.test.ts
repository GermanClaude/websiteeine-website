import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import {
  ARGON2_PARAMS,
  checkPasswordPolicy,
  describePasswordProblems,
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from '../../src/lib/passwords';

describe('password hashing (argon2id m=19456 t=2 p=1)', () => {
  it('hashes with the documented parameters and verifies', async () => {
    const hash = await hashPassword('Correct-horse-42');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'Correct-horse-42')).toBe(true);
    expect(await verifyPassword(hash, 'correct-horse-42')).toBe(false);
    expect(needsRehash(hash)).toBe(false);
    expect(ARGON2_PARAMS).toEqual({ type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  });

  it('flags hashes with other parameters for rehash', async () => {
    const weaker = await argon2.hash('Correct-horse-42', { type: argon2.argon2id, memoryCost: 4096, timeCost: 1, parallelism: 1 });
    expect(needsRehash(weaker)).toBe(true);
    expect(needsRehash('not a hash')).toBe(true);
  });

  it('never throws on malformed hashes or oversized input', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$broken', 'x')).toBe(false);
    const hash = await hashPassword('Correct-horse-42');
    expect(await verifyPassword(hash, 'x'.repeat(10_000))).toBe(false);
    await expect(hashPassword('x'.repeat(129))).rejects.toThrow(RangeError);
    await expect(hashPassword('')).rejects.toThrow(RangeError);
  });

  it('provides a dummy verification for timing equalization', async () => {
    expect(await verifyDummyPassword('anything')).toBe(false);
  });
});

describe('password policy', () => {
  const identity = { email: 'alice@example.org', username: 'alice_admin' };

  it('accepts reasonable passwords', () => {
    expect(checkPasswordPolicy('Tr0ub4dor&3-horse', identity)).toEqual([]);
    expect(checkPasswordPolicy('correct horse battery staple', identity)).toEqual([]);
  });

  it.each([
    ['short1!', 'too_short'],
    ['x'.repeat(129), 'too_long'],
    ['alice@example.org', 'equals_identity'],
    ['ALICE_ADMIN', 'equals_identity'],
    ['my-alice_admin-pass', 'contains_identity'],
    ['password123', 'common'],
    ['aaaaaaaaaaaa', 'repetitive'],
    ['abcabcabcabc', 'repetitive'],
    ['onlylowercase', 'low_variety'],
  ] as const)('rejects %s (%s)', (password, problem) => {
    expect(checkPasswordPolicy(password, identity)).toContain(problem);
    expect(describePasswordProblems(checkPasswordPolicy(password, identity)).length).toBeGreaterThan(0);
  });
});
