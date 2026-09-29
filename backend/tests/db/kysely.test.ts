import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { describe, expect, it } from 'vitest';

import { createDatabase, createPool, parseInt8 } from '../../src/db/kysely';
import type { Database, NewEvidence } from '../../src/db/types';
import { useTestDatabase } from '../helpers/test-db';
import { catchPgError } from './assertions';
import { insertPlayer, insertUser } from './fixtures';

describe('parseInt8', () => {
  it('parses safe integers', () => {
    expect(parseInt8('0')).toBe(0);
    expect(parseInt8('-42')).toBe(-42);
    expect(parseInt8('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects values outside the safe integer range', () => {
    expect(() => parseInt8('9007199254740992')).toThrow(RangeError);
    expect(() => parseInt8('-9223372036854775808')).toThrow(RangeError);
  });
});

describe('createPool / createDatabase', () => {
  it('validates options', () => {
    expect(() => createPool({ connectionString: '  ' })).toThrow(/empty/);
    expect(() => createPool({ connectionString: 'postgres://x@localhost/x', poolMax: 0 })).toThrow(RangeError);
    expect(() => createPool({ connectionString: 'postgres://x@localhost/x', statementTimeoutMs: -1 })).toThrow(RangeError);
    expect(() => createPool({ connectionString: 'postgres://x@localhost/x', poolMax: 1.5 })).toThrow(RangeError);
  });
});

describe('pg type parsing and session settings', () => {
  const getDb = useTestDatabase();

  it('returns int8 values and counts as numbers', async () => {
    const { db } = getDb();
    const result = await sql<{ big: number; count: number; arr: (number | null)[] }>`
      SELECT 9007199254740991::bigint AS big, count(*) AS count, ARRAY[1, NULL, 3]::bigint[] AS arr FROM users
    `.execute(db);
    expect(result.rows[0]).toEqual({ big: Number.MAX_SAFE_INTEGER, count: 0, arr: [1, null, 3] });
  });

  it('fails the query (not the process) for int8 values beyond 2^53 and keeps the pool usable', async () => {
    const { db } = getDb();
    await expect(sql`SELECT 9007199254740993::bigint AS big`.execute(db)).rejects.toThrow(RangeError);
    await expect(sql`SELECT ARRAY[9007199254740993]::bigint[] AS big`.execute(db)).rejects.toThrow(RangeError);
    const again = await sql<{ one: number }>`SELECT 1 AS one`.execute(db);
    expect(again.rows[0]?.one).toBe(1);
  });

  it('keeps numeric as string, parses timestamptz to Date, text[] and jsonb natively', async () => {
    const { db } = getDb();
    const result = await sql<{ num: string; ts: Date; tags: string[]; doc: unknown }>`
      SELECT 12345678901234567890.123::numeric AS num,
             '2026-09-29T15:42:20.123Z'::timestamptz AS ts,
             ARRAY['a', 'b,c', 'd"e']::text[] AS tags,
             '{"a": [1, {"b": null}]}'::jsonb AS doc
    `.execute(db);
    const row = result.rows[0];
    expect(row?.num).toBe('12345678901234567890.123');
    expect(row?.ts).toBeInstanceOf(Date);
    expect(row?.ts.toISOString()).toBe('2026-09-29T15:42:20.123Z');
    expect(row?.tags).toEqual(['a', 'b,c', 'd"e']);
    expect(row?.doc).toEqual({ a: [1, { b: null }] });
  });

  it('runs sessions in UTC', async () => {
    const { db } = getDb();
    const result = await sql<{ tz: string }>`SELECT current_setting('TimeZone') AS tz`.execute(db);
    expect(result.rows[0]?.tz).toBe('UTC');
  });

  it('round-trips typed rows through Kysely (dates, arrays, citext)', async () => {
    const { db } = getDb();
    const user = await insertUser(db, { email: 'roundtrip@example.test', last_login_at: '2026-01-02T03:04:05.678Z' });
    expect(user.last_login_at?.toISOString()).toBe('2026-01-02T03:04:05.678Z');
    expect(user.created_at).toBeInstanceOf(Date);
    const found = await db.selectFrom('users').select('id').where('email', '=', 'RoundTrip@Example.TEST').executeTakeFirst();
    expect(found?.id).toBe(user.id);

    const player = await insertPlayer(db);
    const signal = await db
      .insertInto('player_signals')
      .values({ player_id: player.id, signal: 'young_account', source: 'account-age', detail_codes: ['a_b', 'c-d'] })
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(signal.detail_codes).toEqual(['a_b', 'c-d']);
  });

  it('destroy() ends the pool even when Kysely itself never ran a query', async () => {
    const handle = createDatabase({ connectionString: getDb().url, poolMax: 1 });
    await handle.pool.query('SELECT 1');
    await handle.destroy();
    expect(handle.pool.ended).toBe(true);
  });

  it('applies statement_timeout when configured', async () => {
    const handle = createDatabase({ connectionString: getDb().url, poolMax: 1, statementTimeoutMs: 100 });
    try {
      const error = await catchPgError(sql`SELECT pg_sleep(2)`.execute(handle.db));
      expect(error.code).toBe('57014');
    } finally {
      await handle.destroy();
      await handle.destroy(); // idempotent
    }
  });
});

describe('Database types (compile-time guarantees)', () => {
  it('forbid updating append-only and immutable columns and invalid enum values', () => {
    // Never executed: tsc verifies each @ts-expect-error is really an error.
    const compileOnly = (db: Kysely<Database>): void => {
      // @ts-expect-error audit events are append-only
      void db.updateTable('audit_events').set({ hash: 'x' });
      // @ts-expect-error reviews are append-only
      void db.updateTable('reviews').set({ comment: 'x' });
      // @ts-expect-error evidence content is immutable
      void db.updateTable('evidence').set({ sha256: 'x' });
      // @ts-expect-error policy versions keep their settings
      void db.updateTable('server_policies').set({ whitelist_url: 'https://x' });
      // @ts-expect-error confirmations cannot move to another case
      void db.updateTable('case_server_confirmations').set({ case_id: 'x' });
      // @ts-expect-error primary keys never change
      void db.updateTable('users').set({ id: 'x' });
      // @ts-expect-error not a UserRole
      void db.updateTable('users').set({ role: 'root' });
      // @ts-expect-error not an AuditAction (event names are upper-case)
      void db.selectFrom('audit_events').selectAll().where('action', '=', 'report_created');

      void db.updateTable('evidence').set({ status: 'verified', superseded_by_evidence_id: 'x' });
      void db.updateTable('server_policies').set({ is_active: false });
      void db.updateTable('case_server_confirmations').set({ revoked_at: new Date(), revoked_by: 'x' });

      const evidence: NewEvidence = {
        case_id: 'x',
        type: 'link',
        title: 't',
        external_url: 'https://x',
        // @ts-expect-error superseded_by_evidence_id cannot be set on insert
        superseded_by_evidence_id: 'x',
      };
      void evidence;
    };
    expect(typeof compileOnly).toBe('function');
  });
});
