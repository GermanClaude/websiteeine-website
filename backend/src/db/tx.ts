/**
 * Transaction helpers.
 *
 * Services accept a `DbExecutor` so they can run standalone or inside a
 * caller's transaction (e.g. business change + audit event, ARCHITECTURE §9.1).
 */
import { sql } from 'kysely';
import type { Kysely, Transaction } from 'kysely';

import { isRetryableTransactionError } from './errors';
import type { Database } from './types';

export type DbExecutor = Kysely<Database> | Transaction<Database>;
export type DbTransaction = Transaction<Database>;

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

export interface TransactionOptions {
  /** Isolation level of a new transaction (default: server default, read committed). */
  isolation?: IsolationLevel;
  /** Start the transaction READ ONLY. */
  readOnly?: boolean;
  /**
   * Retries of the whole callback after a serialization failure / deadlock
   * (default 0). Only use with idempotent callbacks without external side effects.
   */
  retries?: number;
}

const ISOLATION_RANK: Record<IsolationLevel, number> = {
  'read committed': 0,
  'repeatable read': 1,
  serializable: 2,
};

function isIsolationLevel(value: string): value is IsolationLevel {
  return Object.hasOwn(ISOLATION_RANK, value);
}

async function assertOuterIsolation(trx: DbTransaction, required: IsolationLevel): Promise<void> {
  const result = await sql<{ transaction_isolation: string }>`SHOW transaction_isolation`.execute(trx);
  const current = result.rows[0]?.transaction_isolation ?? 'read committed';
  const rank = isIsolationLevel(current) ? ISOLATION_RANK[current] : 0;
  if (rank < ISOLATION_RANK[required]) {
    throw new Error(
      `withTransaction: requested isolation "${required}" but the surrounding transaction runs at "${current}"`,
    );
  }
}

/**
 * Runs `fn` in a transaction and returns its result; rolls back when it throws.
 *
 * If `db` already is a transaction, `fn` joins it (no savepoint): the outer
 * transaction owns commit/rollback. Requesting a stricter isolation level than
 * the outer transaction provides throws, and `readOnly`/`retries` are ignored.
 */
export async function withTransaction<T>(
  db: DbExecutor,
  fn: (trx: DbTransaction) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  if (db.isTransaction) {
    const trx = db as DbTransaction;
    if (options.isolation !== undefined) await assertOuterIsolation(trx, options.isolation);
    return fn(trx);
  }

  const retries = options.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new RangeError('withTransaction: retries must be an integer between 0 and 10');
  }

  for (let attempt = 0; ; attempt += 1) {
    let builder = db.transaction();
    if (options.isolation !== undefined) builder = builder.setIsolationLevel(options.isolation);
    if (options.readOnly === true) builder = builder.setAccessMode('read only');
    try {
      return await builder.execute(fn);
    } catch (err) {
      if (attempt >= retries || !isRetryableTransactionError(err)) throw err;
    }
  }
}
