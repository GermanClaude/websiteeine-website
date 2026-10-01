import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { useTestDatabase } from '../helpers/test-db';
import { SCHEMA_MANIFEST } from './schema-manifest';
import type { ColumnKind } from './schema-manifest';

const KIND_BY_UDT: Record<string, ColumnKind> = {
  uuid: 'string',
  text: 'string',
  citext: 'string',
  bpchar: 'string',
  int4: 'number',
  int8: 'number',
  numeric: 'string',
  bool: 'boolean',
  timestamptz: 'date',
  _text: 'string[]',
  jsonb: 'json',
};

describe('database schema', () => {
  const getDb = useTestDatabase();

  it('matches the Kysely Database interface column by column (kind, nullability, defaults)', async () => {
    const { db } = getDb();
    const result = await sql<{
      table_name: string;
      column_name: string;
      udt_name: string;
      is_nullable: string;
      has_default: boolean;
    }>`
      SELECT table_name, column_name, udt_name, is_nullable, column_default IS NOT NULL AS has_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `.execute(db);

    const actual: Record<string, Record<string, [ColumnKind | string, boolean, boolean]>> = {};
    for (const row of result.rows) {
      const nullable = row.is_nullable === 'YES';
      const table = (actual[row.table_name] ??= {});
      table[row.column_name] = [KIND_BY_UDT[row.udt_name] ?? `unmapped:${row.udt_name}`, nullable, nullable || row.has_default];
    }
    expect(actual).toEqual(SCHEMA_MANIFEST);
  });

  it('installs the required extensions and sequences', async () => {
    const { db } = getDb();
    const extensions = await sql<{ extname: string }>`SELECT extname FROM pg_extension ORDER BY extname`.execute(db);
    expect(extensions.rows.map((row) => row.extname)).toEqual(expect.arrayContaining(['citext', 'pgcrypto']));

    const sequences = await sql<{ name: string; owner: string | null }>`
      SELECT c.relname AS name, d.refobjid::regclass::text || '.' || a.attname AS owner
      FROM pg_class c
      LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
      LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
      WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
      ORDER BY c.relname
    `.execute(db);
    expect(sequences.rows).toEqual([
      { name: 'audit_events_seq', owner: 'audit_events.seq' },
      { name: 'users_reviewer_number_seq', owner: 'users.reviewer_number' },
    ]);
  });

  it('has a non-partial index leading with the columns of every foreign key', async () => {
    const { db } = getDb();
    const result = await sql<{ table_name: string; constraint_name: string }>`
      SELECT c.conrelid::regclass::text AS table_name, c.conname AS constraint_name
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indpred IS NULL
            AND ARRAY(SELECT unnest((i.indkey::int2[])[0:cardinality(c.conkey) - 1]))
                = ARRAY(SELECT unnest(c.conkey))
        )
      ORDER BY 1, 2
    `.execute(db);
    expect(result.rows).toEqual([]);
  });

  it('documents the key tables with comments', async () => {
    const { db } = getDb();
    const result = await sql<{ relname: string }>`
      SELECT c.relname
      FROM pg_class c
      WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
        AND obj_description(c.oid, 'pg_class') IS NULL
        AND c.relname <> 'schema_migrations'
      ORDER BY 1
    `.execute(db);
    expect(result.rows).toEqual([]);
  });

  it('protects every history table with DELETE and TRUNCATE triggers', async () => {
    const { db } = getDb();
    const result = await sql<{ table_name: string; trigger_name: string }>`
      SELECT c.relname AS table_name, t.tgname AS trigger_name
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
        AND (t.tgname LIKE '%\\_forbid\\_delete' OR t.tgname LIKE '%\\_forbid\\_truncate')
      ORDER BY 1, 2
    `.execute(db);
    const protectedTables = [
      'appeals',
      'audit_events',
      'bypasses',
      'case_server_confirmations',
      'cases',
      'evidence',
      'evidence_reviews',
      'reports',
      'reviews',
      'security_events',
      'server_policies',
      'server_policy_rules',
      'whitelist_requests',
    ];
    expect(result.rows).toEqual(
      protectedTables.flatMap((table) => [
        { table_name: table, trigger_name: `${table}_forbid_delete` },
        { table_name: table, trigger_name: `${table}_forbid_truncate` },
      ]),
    );
  });
});
