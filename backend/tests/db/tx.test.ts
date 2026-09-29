import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_OPERATION_SQLSTATE,
  getPgError,
  isCheckViolation,
  isForbiddenOperation,
  isForeignKeyViolation,
  isNotNullViolation,
  isRetryableTransactionError,
  isUniqueViolation,
} from '../../src/db/errors';
import { allocateCaseNumber, formatCaseNumber, nextAuditSeq, nextCaseCounterValue, nextReviewerNumber } from '../../src/db/sequences';
import { withTransaction } from '../../src/db/tx';
import { useTestDatabase } from '../helpers/test-db';
import { catchPgError } from './assertions';
import { insertCase, insertPlayer, insertUser } from './fixtures';

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
}

describe('withTransaction', () => {
  const getDb = useTestDatabase();

  async function userExists(username: string): Promise<boolean> {
    const row = await getDb().db.selectFrom('users').select('id').where('username', '=', username).executeTakeFirst();
    return row !== undefined;
  }

  it('commits and returns the callback result', async () => {
    const id = await withTransaction(getDb().db, async (trx) => (await insertUser(trx, { username: 'tx_commit' })).id);
    expect(typeof id).toBe('string');
    expect(await userExists('tx_commit')).toBe(true);
  });

  it('rolls back when the callback throws', async () => {
    const failure = new Error('boom');
    await expect(
      withTransaction(getDb().db, async (trx) => {
        await insertUser(trx, { username: 'tx_rollback' });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await userExists('tx_rollback')).toBe(false);
  });

  it('joins an outer transaction; an inner failure rolls back everything', async () => {
    const { db } = getDb();
    await expect(
      withTransaction(db, async (outer) => {
        await insertUser(outer, { username: 'tx_outer' });
        await withTransaction(outer, async (inner) => {
          expect(inner).toBe(outer);
          await insertUser(inner, { username: 'tx_inner' });
        });
        throw new Error('outer fails');
      }),
    ).rejects.toThrow('outer fails');
    expect(await userExists('tx_outer')).toBe(false);
    expect(await userExists('tx_inner')).toBe(false);
  });

  it('applies the requested isolation level and access mode', async () => {
    const { db } = getDb();
    const level = await withTransaction(
      db,
      async (trx) =>
        (await sql<{ level: string }>`SELECT current_setting('transaction_isolation') AS level`.execute(trx)).rows[0]?.level,
      { isolation: 'serializable' },
    );
    expect(level).toBe('serializable');

    const readOnly = await catchPgError(
      withTransaction(db, (trx) => insertUser(trx, { username: 'tx_readonly' }), { readOnly: true }),
    );
    expect(readOnly.code).toBe('25006');
  });

  it('refuses a stricter isolation level inside a weaker outer transaction', async () => {
    const { db } = getDb();
    await expect(
      withTransaction(db, (outer) => withTransaction(outer, async () => 1, { isolation: 'serializable' })),
    ).rejects.toThrow(/surrounding transaction/);
    await expect(
      withTransaction(db, (outer) => withTransaction(outer, async () => 2, { isolation: 'repeatable read' }), {
        isolation: 'serializable',
      }),
    ).resolves.toBe(2);
  });

  it('retries serialization failures only when asked to', async () => {
    const { db } = getDb();
    const serializationFailure = Object.assign(new Error('could not serialize access'), { code: '40001' });
    let attempts = 0;
    const result = await withTransaction(
      db,
      async () => {
        attempts += 1;
        if (attempts < 3) throw serializationFailure;
        return 'ok';
      },
      { isolation: 'serializable', retries: 3 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);

    attempts = 0;
    await expect(
      withTransaction(db, async () => {
        attempts += 1;
        throw serializationFailure;
      }),
    ).rejects.toBe(serializationFailure);
    expect(attempts).toBe(1);

    attempts = 0;
    await expect(
      withTransaction(
        db,
        async () => {
          attempts += 1;
          throw new Error('not retryable');
        },
        { retries: 5 },
      ),
    ).rejects.toThrow('not retryable');
    expect(attempts).toBe(1);
    await expect(withTransaction(db, async () => 1, { retries: -1 })).rejects.toThrow(RangeError);
  });

  it('retries a real serialization conflict', async () => {
    const { db } = getDb();
    const player = await insertPlayer(db);
    let attempts = 0;
    let releaseFirst: () => void = () => undefined;
    const firstHasRead = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalRead: () => void = () => undefined;
    const readDone = new Promise<void>((resolve) => {
      signalRead = resolve;
    });

    const conflicting = withTransaction(
      db,
      async (trx) => {
        attempts += 1;
        await trx.selectFrom('players').select('display_name').where('id', '=', player.id).execute();
        if (attempts === 1) {
          signalRead();
          await firstHasRead;
        }
        await trx.updateTable('players').set({ display_name: `A${attempts}` }).where('id', '=', player.id).execute();
        return attempts;
      },
      { isolation: 'serializable', retries: 2 },
    );
    await readDone;
    await db.updateTable('players').set({ display_name: 'B' }).where('id', '=', player.id).execute();
    releaseFirst();
    expect(await conflicting).toBe(2);
  });
});

describe('pg error helpers', () => {
  const getDb = useTestDatabase();

  it('classify constraint violations and trigger errors', async () => {
    const { db } = getDb();
    const user = await insertUser(db);
    const unique = await captureError(insertUser(db, { email: user.email }));
    expect(isUniqueViolation(unique)).toBe(true);
    expect(isUniqueViolation(unique, 'users_email_key')).toBe(true);
    expect(isUniqueViolation(unique, 'users_username_key')).toBe(false);
    expect(isCheckViolation(unique)).toBe(false);

    const check = await captureError(insertUser(db, { role: 'player', failed_login_count: -1 }));
    expect(isCheckViolation(check, 'users_failed_login_count_check')).toBe(true);

    const fk = await captureError(insertCase(db, '00000000-0000-4000-8000-000000000002'));
    expect(isForeignKeyViolation(fk)).toBe(true);
    expect(isForeignKeyViolation(fk, 'cases_player_id_fkey')).toBe(true);

    const notNull = await captureError(sql`INSERT INTO players (id_type) VALUES ('steam')`.execute(db));
    expect(isNotNullViolation(notNull)).toBe(true);
    expect(isNotNullViolation(notNull, 'external_id')).toBe(true);
    expect(isNotNullViolation(notNull, 'id_type')).toBe(false);

    await insertCase(db, (await insertPlayer(db)).id);
    const forbidden = await captureError(sql`DELETE FROM cases`.execute(db));
    expect(isForbiddenOperation(forbidden)).toBe(true);
    expect(getPgError(forbidden)).toMatchObject({ code: FORBIDDEN_OPERATION_SQLSTATE, table: 'cases' });
  });

  it('ignore non-database errors and look through one level of cause', () => {
    const network = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(getPgError(network)).toBeUndefined();
    expect(isUniqueViolation(network)).toBe(false);
    expect(getPgError('23505')).toBeUndefined();
    expect(getPgError({ code: '23505' })).toBeUndefined();
    expect(getPgError(null)).toBeUndefined();

    const wrapped = new Error('repository failed', {
      cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'users_email_key' }),
    });
    expect(isUniqueViolation(wrapped, 'users_email_key')).toBe(true);
    expect(isRetryableTransactionError(Object.assign(new Error('deadlock'), { code: '40P01' }))).toBe(true);
    expect(isRetryableTransactionError(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
  });
});

describe('sequences', () => {
  const getDb = useTestDatabase();

  it('allocates case numbers per year', async () => {
    const { db } = getDb();
    expect(await allocateCaseNumber(db, 2026)).toBe('CASE-2026-000001');
    expect(await allocateCaseNumber(db, 2026)).toBe('CASE-2026-000002');
    expect(await allocateCaseNumber(db, 2027)).toBe('CASE-2027-000001');
    expect(await nextCaseCounterValue(db, 2026)).toBe(3);
    expect(await allocateCaseNumber(db)).toMatch(new RegExp(`^CASE-${new Date().getUTCFullYear()}-\\d{6}$`));
  });

  it('rolls back a counter increment together with its transaction', async () => {
    const { db } = getDb();
    await expect(
      withTransaction(db, async (trx) => {
        await nextCaseCounterValue(trx, 2030);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await nextCaseCounterValue(db, 2030)).toBe(1);
  });

  it('validates case number inputs', async () => {
    expect(formatCaseNumber(2026, 1337)).toBe('CASE-2026-001337');
    expect(() => formatCaseNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatCaseNumber(2026, 1_000_000)).toThrow(RangeError);
    expect(() => formatCaseNumber(1999, 1)).toThrow(RangeError);
    await expect(nextCaseCounterValue(getDb().db, 10_000)).rejects.toThrow(RangeError);
    await expect(nextCaseCounterValue(getDb().db, 2026.5)).rejects.toThrow(RangeError);
  });

  it('hands out increasing reviewer numbers and audit sequence values', async () => {
    const { db } = getDb();
    const first = await nextReviewerNumber(db);
    const second = await nextReviewerNumber(db);
    expect(second).toBe(first + 1);
    const seqA = await nextAuditSeq(db);
    const seqB = await nextAuditSeq(db);
    expect(typeof seqA).toBe('number');
    expect(seqB).toBeGreaterThan(seqA);
  });
});
