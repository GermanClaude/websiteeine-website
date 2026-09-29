import { getPgError } from '../../src/db/errors';
import type { PgErrorInfo } from '../../src/db/errors';
import type { DbExecutor, DbTransaction } from '../../src/db/tx';

/** Awaits `promise`, expecting a PostgreSQL error, and returns it. */
export async function catchPgError(promise: Promise<unknown>): Promise<PgErrorInfo> {
  try {
    await promise;
  } catch (err) {
    const pgError = getPgError(err);
    if (pgError === undefined) throw err;
    return pgError;
  }
  throw new Error('Expected the statement to fail, but it succeeded');
}

const ROLLBACK = Symbol('rollback');

/** Runs `fn` in a transaction that is always rolled back; returns fn's result. */
export async function inRolledBackTransaction<T>(db: DbExecutor, fn: (trx: DbTransaction) => Promise<T>): Promise<T> {
  const holder: { value?: T } = {};
  try {
    await db.transaction().execute(async (trx) => {
      holder.value = await fn(trx);
      throw ROLLBACK;
    });
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return holder.value as T;
}
