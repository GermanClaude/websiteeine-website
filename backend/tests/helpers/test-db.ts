/**
 * Disposable PostgreSQL databases for integration tests.
 *
 *   const testDb = await createTestDatabase();   // migrated, isolated database
 *   await testDb.db.selectFrom('users')...       // Kysely<Database>
 *   await testDb.reset();                        // optional: wipe all data
 *   await testDb.destroy();                      // DROP DATABASE ... WITH (FORCE)
 *
 * or, inside a vitest file:  const getDb = useTestDatabase();  ... getDb().db
 *
 * Speed: all migrations are applied once into a template database named after
 * a fingerprint of the migration files (scpsl_trust_tpl_<hash>); every test
 * database is a cheap CREATE DATABASE ... TEMPLATE copy. Template creation is
 * serialized across parallel vitest workers with an advisory lock, and a
 * changed migration set automatically produces a new template.
 *
 * Admin connection: TEST_DATABASE_ADMIN_URL
 * (default postgres://scpsl:scpsl@localhost:5432/postgres); the role needs
 * CREATEDB. reset() additionally needs superuser (session_replication_role).
 */
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Kysely } from 'kysely';
import pg from 'pg';
import type { Pool } from 'pg';
import { afterAll, beforeAll } from 'vitest';

import { createDatabase } from '../../src/db/kysely';
import { loadMigrationFiles, runMigrations } from '../../src/db/migrator';
import { resolveMigrationsDir } from '../../src/db/paths';
import type { Database } from '../../src/db/types';

const DEFAULT_ADMIN_URL = 'postgres://scpsl:scpsl@localhost:5432/postgres';
const TEST_DB_PREFIX = 'scpsl_trust_test_';
const TEMPLATE_PREFIX = 'scpsl_trust_tpl_';
const TEMPLATE_READY_COMMENT = 'scpsl-trust test template: ready';
const TEMPLATE_LOCK_KEY = 7_274_099;
/** Test databases older than this are considered leftovers of crashed runs. */
const ORPHAN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const OBJECT_IN_USE = '55006';

export interface TestDatabase {
  /** Database name (scpsl_trust_test_<base36 ms>_<hex>). */
  readonly name: string;
  /** Connection string of the test database. */
  readonly url: string;
  readonly db: Kysely<Database>;
  readonly pool: Pool;
  /** Truncates every table except schema_migrations (bypassing protection triggers) and resets sequences. */
  reset(): Promise<void>;
  /** Closes the pool and drops the database. Idempotent. */
  destroy(): Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** false creates an empty database without any migration (default true). */
  readonly migrate?: boolean;
  /** Pool size of the returned Kysely instance (default 5). */
  readonly poolMax?: number;
}

export function testAdminUrl(): string {
  const configured = process.env['TEST_DATABASE_ADMIN_URL']?.trim();
  return configured !== undefined && configured !== '' ? configured : DEFAULT_ADMIN_URL;
}

/** Connection string for `database` on the admin server. */
export function testDatabaseUrl(database: string): string {
  const url = new URL(testAdminUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error(`Refusing unsafe database name: ${name}`);
  return `"${name}"`;
}

async function withAdmin<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: testAdminUrl(), application_name: 'scpsl-trust-tests' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function isPgCode(err: unknown, code: string): boolean {
  return err instanceof Error && Reflect.get(err, 'code') === code;
}

/** CREATE DATABASE, retrying while the template still has a lingering connection. */
async function createDatabaseFrom(admin: pg.Client, name: string, template: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
      return;
    } catch (err) {
      if (!isPgCode(err, OBJECT_IN_USE) || attempt >= 50) throw err;
      await sleep(100);
    }
  }
}

async function migrationsFingerprint(migrationsDir: string): Promise<string> {
  const hash = createHash('sha256');
  for (const file of await loadMigrationFiles(migrationsDir)) hash.update(`${file.version}:${file.checksum}\n`);
  return hash.digest('hex').slice(0, 16);
}

async function isTemplateReady(admin: pg.Client, name: string): Promise<boolean> {
  const result = await admin.query<{ comment: string | null }>(
    "SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
    [name],
  );
  return result.rows[0]?.comment === TEMPLATE_READY_COMMENT;
}

/** Drops templates of other migration sets and test databases left behind by crashed runs. */
async function dropLeftovers(admin: pg.Client, currentTemplate: string): Promise<void> {
  const result = await admin.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE datname LIKE 'scpsl\\_trust\\_tpl\\_%' OR datname LIKE 'scpsl\\_trust\\_test\\_%'",
  );
  const now = Date.now();
  for (const { datname } of result.rows) {
    let stale = false;
    if (datname.startsWith(TEMPLATE_PREFIX)) {
      stale = datname !== currentTemplate;
    } else {
      const match = /^scpsl_trust_test_([0-9a-z]+)_[0-9a-f]{8}$/.exec(datname);
      const createdAt = match?.[1] !== undefined ? Number.parseInt(match[1], 36) : Number.NaN;
      stale = Number.isFinite(createdAt) && now - createdAt > ORPHAN_MAX_AGE_MS;
    }
    if (stale) await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
  }
}

async function buildTemplate(): Promise<string> {
  const migrationsDir = resolveMigrationsDir();
  const name = `${TEMPLATE_PREFIX}${await migrationsFingerprint(migrationsDir)}`;
  await withAdmin(async (admin) => {
    await admin.query('SELECT pg_advisory_lock($1::bigint)', [TEMPLATE_LOCK_KEY]);
    try {
      if (await isTemplateReady(admin, name)) return;
      // Missing or half-built (crashed run): build from scratch.
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`);
      await runMigrations({ connectionString: testDatabaseUrl(name), migrationsDir });
      await admin.query(`ALTER DATABASE ${quoteIdent(name)} WITH ALLOW_CONNECTIONS false`);
      await admin.query(`COMMENT ON DATABASE ${quoteIdent(name)} IS '${TEMPLATE_READY_COMMENT}'`);
      await dropLeftovers(admin, name);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1::bigint)', [TEMPLATE_LOCK_KEY]);
    }
  });
  return name;
}

let templatePromise: Promise<string> | undefined;

function ensureTemplate(): Promise<string> {
  templatePromise ??= buildTemplate().catch((err: unknown) => {
    templatePromise = undefined;
    throw err;
  });
  return templatePromise;
}

async function truncateAll(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let failed = false;
  try {
    const tables = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations' ORDER BY tablename",
    );
    if (tables.rows.length === 0) return;
    const list = tables.rows.map((row) => quoteIdent(row.tablename)).join(', ');
    await client.query('BEGIN');
    // Test-only: skips the TRUNCATE protection triggers (requires superuser).
    await client.query('SET LOCAL session_replication_role = replica');
    await client.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');
  } catch (err) {
    failed = true;
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release(failed);
  }
}

/** Creates an isolated database (migrated unless `migrate: false`). */
export async function createTestDatabase(options: CreateTestDatabaseOptions = {}): Promise<TestDatabase> {
  const template = options.migrate === false ? 'template0' : await ensureTemplate();
  const name = `${TEST_DB_PREFIX}${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await withAdmin((admin) => createDatabaseFrom(admin, name, template));

  const url = testDatabaseUrl(name);
  const handle = createDatabase({
    connectionString: url,
    poolMax: options.poolMax ?? 5,
    applicationName: 'scpsl-trust-tests',
  });
  let destroyed: Promise<void> | undefined;

  return {
    name,
    url,
    db: handle.db,
    pool: handle.pool,
    reset: () => truncateAll(handle.pool),
    destroy(): Promise<void> {
      destroyed ??= (async () => {
        await handle.destroy();
        await withAdmin(async (admin) => {
          await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
        });
      })();
      return destroyed;
    },
  };
}

/**
 * Vitest convenience: creates a database in beforeAll and drops it in afterAll.
 * Returns an accessor usable inside tests and hooks.
 */
export function useTestDatabase(options: CreateTestDatabaseOptions = {}): () => TestDatabase {
  let testDb: TestDatabase | undefined;
  beforeAll(async () => {
    testDb = await createTestDatabase(options);
  });
  afterAll(async () => {
    await testDb?.destroy();
  });
  return () => {
    if (testDb === undefined) throw new Error('Test database is not ready (use it inside tests or hooks)');
    return testDb;
  };
}
