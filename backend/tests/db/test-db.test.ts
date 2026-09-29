import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { loadMigrationFiles } from '../../src/db/migrator';
import { nextAuditSeq, nextReviewerNumber } from '../../src/db/sequences';
import { resolveMigrationsDir } from '../../src/db/paths';
import { createTestDatabase, testAdminUrl, testDatabaseUrl } from '../helpers/test-db';
import { createWorld, insertUser } from './fixtures';

async function databaseExists(name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: testAdminUrl() });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

describe('createTestDatabase', () => {
  it('creates isolated, fully migrated databases and drops them on destroy', async () => {
    const [a, b] = await Promise.all([createTestDatabase(), createTestDatabase()]);
    try {
      expect(a.name).not.toBe(b.name);
      expect(a.name).toMatch(/^scpsl_trust_test_[0-9a-z]+_[0-9a-f]{8}$/);
      expect(a.url).toBe(testDatabaseUrl(a.name));

      const versions = (await loadMigrationFiles(resolveMigrationsDir())).map((file) => file.version);
      const applied = await a.db.selectFrom('schema_migrations').select('version').orderBy('version').execute();
      expect(applied.map((row) => row.version)).toEqual(versions);

      await insertUser(a.db, { username: 'only_in_a' });
      const inB = await b.db.selectFrom('users').select('id').where('username', '=', 'only_in_a').executeTakeFirst();
      expect(inB).toBeUndefined();
    } finally {
      await Promise.all([a.destroy(), b.destroy()]);
    }
    expect(await databaseExists(a.name)).toBe(false);
    await a.destroy(); // idempotent
  });

  it('can create an empty database without migrations', async () => {
    const empty = await createTestDatabase({ migrate: false });
    try {
      const result = await empty.pool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(result.rows[0]?.n).toBe(0);
    } finally {
      await empty.destroy();
    }
  });

  it('reset() wipes all data, including protected history tables, and restarts sequences', async () => {
    const testDb = await createTestDatabase();
    try {
      await createWorld(testDb.db);
      const firstReviewer = await nextReviewerNumber(testDb.db);
      await nextAuditSeq(testDb.db);

      await testDb.reset();

      for (const table of ['users', 'cases', 'audit_events', 'evidence', 'reviews'] as const) {
        const rows = await testDb.db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
        expect(rows.n, table).toBe(0);
      }
      const migrations = await testDb.db.selectFrom('schema_migrations').select('version').execute();
      expect(migrations.length).toBeGreaterThan(0);
      expect(await nextReviewerNumber(testDb.db)).toBe(firstReviewer);
      expect(await nextAuditSeq(testDb.db)).toBe(1);

      // Protection triggers are active again after the reset.
      await createWorld(testDb.db);
      await expect(testDb.db.deleteFrom('cases').execute()).rejects.toMatchObject({ code: 'TN403' });
    } finally {
      await testDb.destroy();
    }
  });
});
