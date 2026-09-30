/**
 * SQL for the auth module: users by credential, single-use tokens (email verification /
 * password reset) and recovery codes. No business logic here.
 */
import { sql } from 'kysely';

import type { UserTokenType } from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db/tx';
import type { SessionRow, UserRow, UserTokenRow } from '../../db/types';

export function findUserByEmail(db: DbExecutor, email: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('email', '=', email.toLowerCase()).executeTakeFirst();
}

export function findUserById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

/** Atomically increments failed_login_count and returns the updated row. */
export function incrementFailedLogins(db: DbExecutor, userId: string): Promise<UserRow | undefined> {
  return db
    .updateTable('users')
    .set((eb) => ({ failed_login_count: eb('failed_login_count', '+', 1), updated_at: sql`now()` }))
    .where('id', '=', userId)
    .returningAll()
    .executeTakeFirst();
}

export async function insertUserToken(
  db: DbExecutor,
  input: { user_id: string; type: UserTokenType; token_hash: string; expires_at: Date; created_at: Date },
): Promise<void> {
  await db.insertInto('user_tokens').values(input).execute();
}

/**
 * Consumes a single-use token: marks it used if it matches type + hash, is unused and not
 * expired. Returns the row or undefined. The UPDATE is atomic, so a token can never be
 * consumed twice even under concurrent requests.
 */
export function consumeUserToken(
  db: DbExecutor,
  type: UserTokenType,
  tokenHash: string,
  now: Date,
): Promise<UserTokenRow | undefined> {
  return db
    .updateTable('user_tokens')
    .set({ used_at: now })
    .where('type', '=', type)
    .where('token_hash', '=', tokenHash)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returningAll()
    .executeTakeFirst();
}

/** Invalidates every unused token of a type for a user (before issuing a fresh one). */
export async function invalidateUserTokens(db: DbExecutor, userId: string, type: UserTokenType, now: Date): Promise<void> {
  await db
    .updateTable('user_tokens')
    .set({ used_at: now })
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where('used_at', 'is', null)
    .execute();
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

export async function replaceRecoveryCodes(db: DbExecutor, userId: string, codeHashes: readonly string[], now: Date): Promise<void> {
  await db.deleteFrom('user_recovery_codes').where('user_id', '=', userId).execute();
  if (codeHashes.length === 0) return;
  await db
    .insertInto('user_recovery_codes')
    .values(codeHashes.map((code_hash) => ({ user_id: userId, code_hash, created_at: now })))
    .execute();
}

export async function deleteRecoveryCodes(db: DbExecutor, userId: string): Promise<void> {
  await db.deleteFrom('user_recovery_codes').where('user_id', '=', userId).execute();
}

/** Marks an unused recovery code as used (single use, atomic). Returns true when consumed. */
export async function consumeRecoveryCode(db: DbExecutor, userId: string, codeHash: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('user_recovery_codes')
    .set({ used_at: now })
    .where('user_id', '=', userId)
    .where('code_hash', '=', codeHash)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/** True when the user has an unused recovery code with this hash (no consumption). */
export async function hasUnusedRecoveryCode(db: DbExecutor, userId: string, codeHash: string): Promise<boolean> {
  const row = await db
    .selectFrom('user_recovery_codes')
    .select('id')
    .where('user_id', '=', userId)
    .where('code_hash', '=', codeHash)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Sessions (listing; mutations go through deps.sessions)
// ---------------------------------------------------------------------------

export function listActiveSessions(db: DbExecutor, userId: string, now: Date): Promise<SessionRow[]> {
  return db
    .selectFrom('sessions')
    .selectAll()
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null)
    .where('expires_at', '>', now)
    .where('idle_expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .execute();
}

export function findOwnSession(db: DbExecutor, userId: string, sessionId: string): Promise<SessionRow | undefined> {
  return db.selectFrom('sessions').selectAll().where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst();
}
