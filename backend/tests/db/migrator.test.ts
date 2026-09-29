import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  checksumMigrationSql,
  getMigrationStatus,
  loadMigrationFiles,
  MIGRATION_LOCK_KEY,
  MigrationError,
  runMigrations,
} from '../../src/db/migrator';
import { findBackendRoot, resolveMigrationsDir } from '../../src/db/paths';
import { createTestDatabase } from '../helpers/test-db';
import type { TestDatabase } from '../helpers/test-db';

const realDir = resolveMigrationsDir();
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scpsl-migrations-'));
  tempDirs.push(dir);
  return dir;
}

async function copyOfMigrations(): Promise<string> {
  const dir = await tempDir();
  await cp(realDir, dir, { recursive: true });
  return dir;
}

async function expectMigrationError(promise: Promise<unknown>, code: MigrationError['code']): Promise<MigrationError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(MigrationError);
  const migrationError = error as MigrationError;
  expect(migrationError.code).toBe(code);
  return migrationError;
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('migration files', () => {
  it('are loaded in order with checksums', async () => {
    const files = await loadMigrationFiles(realDir);
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.map((file) => file.version)).toEqual([...files.map((file) => file.version)].sort());
    expect(files[0]?.version).toBe('0001_extensions_and_functions');
    for (const file of files) {
      expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(file.transactional).toBe(true);
    }
  });

  it('checksums ignore CRLF line endings and a BOM', () => {
    const lf = 'CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n';
    expect(checksumMigrationSql(lf.replace(/\n/g, '\r\n'))).toBe(checksumMigrationSql(lf));
    expect(checksumMigrationSql(`﻿${lf}`)).toBe(checksumMigrationSql(lf));
    expect(checksumMigrationSql(`${lf} `)).not.toBe(checksumMigrationSql(lf));
  });

  it.each([
    ['1_short.sql', 'SELECT 1;'],
    ['0001-dashes.sql', 'SELECT 1;'],
    ['0001_Upper.sql', 'SELECT 1;'],
    ['0001_.sql', 'SELECT 1;'],
    ['0001_x.SQL', 'SELECT 1;'],
  ])('rejects the invalid file name %s', async (name, content) => {
    const dir = await tempDir();
    await writeFile(path.join(dir, name), content);
    await expectMigrationError(loadMigrationFiles(dir), 'MIGRATION_INVALID_FILE');
  });

  it('rejects duplicate numbers, empty files and transaction control statements', async () => {
    const duplicate = await tempDir();
    await writeFile(path.join(duplicate, '0001_a.sql'), 'SELECT 1;');
    await writeFile(path.join(duplicate, '0001_b.sql'), 'SELECT 1;');
    const dupError = await expectMigrationError(loadMigrationFiles(duplicate), 'MIGRATION_INVALID_FILE');
    expect(dupError.versions).toEqual(['0001_a.sql', '0001_b.sql']);

    const empty = await tempDir();
    await writeFile(path.join(empty, '0001_empty.sql'), '  \n\n');
    await expectMigrationError(loadMigrationFiles(empty), 'MIGRATION_INVALID_FILE');

    for (const statement of ['COMMIT;', 'begin;', 'ROLLBACK;', 'START TRANSACTION ISOLATION LEVEL SERIALIZABLE;', 'END TRANSACTION;']) {
      const dir = await tempDir();
      await writeFile(path.join(dir, '0001_tx.sql'), `CREATE TABLE t (id int);\n${statement}\nCREATE TABLE u (id int);\n`);
      await expectMigrationError(loadMigrationFiles(dir), 'MIGRATION_INVALID_FILE');
    }
  });

  it('allows PL/pgSQL blocks and ignores non-SQL files', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'README.md'), '# notes');
    await writeFile(
      path.join(dir, '0001_fn.sql'),
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN 1;\nEND;\n$$;\n',
    );
    const files = await loadMigrationFiles(dir);
    expect(files.map((file) => file.filename)).toEqual(['0001_fn.sql']);
  });

  it('reports a missing directory', async () => {
    await expectMigrationError(loadMigrationFiles(path.join(os.tmpdir(), 'does-not-exist-scpsl')), 'MIGRATION_DIR_NOT_FOUND');
  });
});

describe('migrations directory resolution', () => {
  it('defaults to <backend>/migrations and honours MIGRATIONS_DIR', () => {
    const root = findBackendRoot();
    expect(resolveMigrationsDir({})).toBe(path.join(root, 'migrations'));
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '/opt/app/migrations' })).toBe('/opt/app/migrations');
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '  ' })).toBe(path.join(root, 'migrations'));
  });

  it('finds the package root from the bundled dist layout and falls back to a migrations directory', async () => {
    const root = findBackendRoot();
    expect(findBackendRoot(path.join(root, 'dist', 'cli'))).toBe(root);
    expect(findBackendRoot(path.join(root, 'src', 'db'))).toBe(root);

    const slim = await tempDir();
    await mkdir(path.join(slim, 'migrations'));
    await mkdir(path.join(slim, 'dist', 'cli'), { recursive: true });
    expect(findBackendRoot(path.join(slim, 'dist', 'cli'))).toBe(slim);
  });
});

describe('runMigrations', () => {
  let target: TestDatabase;
  const expectedVersions: string[] = [];

  beforeAll(async () => {
    target = await createTestDatabase({ migrate: false });
    expectedVersions.push(...(await loadMigrationFiles(realDir)).map((file) => file.version));
  });

  afterAll(async () => {
    await target.destroy();
  });

  async function recordedVersions(): Promise<string[]> {
    const rows = await target.db.selectFrom('schema_migrations').select('version').orderBy('version').execute();
    return rows.map((row) => row.version);
  }

  it('reports everything as pending on an empty database', async () => {
    const status = await getMigrationStatus({ connectionString: target.url, migrationsDir: realDir });
    expect(status.every((entry) => entry.state === 'pending')).toBe(true);
    expect(status.map((entry) => entry.version)).toEqual(expectedVersions);
  });

  it('applies every migration to a fresh database', async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await runMigrations({ connectionString: target.url, migrationsDir: realDir, logger });
    expect(result).toEqual({ applied: expectedVersions, alreadyApplied: [] });
    expect(await recordedVersions()).toEqual(expectedVersions);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`Applied migration ${expectedVersions[0]}`));
    expect(logger.warn).not.toHaveBeenCalled();

    const files = await loadMigrationFiles(realDir);
    const rows = await target.db.selectFrom('schema_migrations').selectAll().orderBy('version').execute();
    expect(rows.map((row) => row.checksum)).toEqual(files.map((file) => file.checksum));
    expect(rows.every((row) => row.applied_at instanceof Date)).toBe(true);
  });

  it('is idempotent: a second run applies nothing', async () => {
    const result = await runMigrations({ pool: target.pool, migrationsDir: realDir });
    expect(result).toEqual({ applied: [], alreadyApplied: expectedVersions });
    const status = await getMigrationStatus({ pool: target.pool, migrationsDir: realDir });
    expect(status.every((entry) => entry.state === 'applied')).toBe(true);
  });

  it('detects a modified applied migration and changes nothing', async () => {
    const dir = await copyOfMigrations();
    const victim = path.join(dir, `${expectedVersions[2] ?? ''}.sql`);
    await writeFile(victim, `${await readFile(victim, 'utf8')}\n-- sneaky edit\n`);
    await writeFile(path.join(dir, '9998_should_not_run.sql'), 'CREATE TABLE should_not_exist (id int);');

    const error = await expectMigrationError(
      runMigrations({ connectionString: target.url, migrationsDir: dir }),
      'MIGRATION_CHECKSUM_MISMATCH',
    );
    expect(error.versions).toEqual([expectedVersions[2]]);
    expect(await recordedVersions()).toEqual(expectedVersions);

    const status = await getMigrationStatus({ connectionString: target.url, migrationsDir: dir });
    expect(status.find((entry) => entry.version === expectedVersions[2])?.state).toBe('checksum_mismatch');
    expect(status.find((entry) => entry.version === '9998_should_not_run')?.state).toBe('pending');
  });

  it('accepts a CRLF checkout of the same migrations', async () => {
    const dir = await copyOfMigrations();
    for (const version of expectedVersions) {
      const file = path.join(dir, `${version}.sql`);
      await writeFile(file, (await readFile(file, 'utf8')).replace(/\n/g, '\r\n'));
    }
    const result = await runMigrations({ connectionString: target.url, migrationsDir: dir });
    expect(result.applied).toEqual([]);
  });

  it('refuses to run when an applied migration is missing on disk', async () => {
    const dir = await copyOfMigrations();
    const last = expectedVersions.at(-1) ?? '';
    await rm(path.join(dir, `${last}.sql`));
    const error = await expectMigrationError(
      runMigrations({ connectionString: target.url, migrationsDir: dir }),
      'MIGRATION_FILE_MISSING',
    );
    expect(error.versions).toEqual([last]);
    const status = await getMigrationStatus({ connectionString: target.url, migrationsDir: dir });
    expect(status.find((entry) => entry.version === last)?.state).toBe('missing_file');
  });

  it('applies only new migrations, rolls back a failing one and records nothing for it', async () => {
    const dir = await copyOfMigrations();
    await writeFile(path.join(dir, '9001_add_probe.sql'), 'CREATE TABLE probe_one (id int PRIMARY KEY);\n');
    const first = await runMigrations({ connectionString: target.url, migrationsDir: dir });
    expect(first.applied).toEqual(['9001_add_probe']);

    await writeFile(
      path.join(dir, '9002_broken.sql'),
      'CREATE TABLE probe_two (id int);\nINSERT INTO probe_two VALUES (1);\nSELECT 1 / 0;\n',
    );
    const error = await expectMigrationError(
      runMigrations({ connectionString: target.url, migrationsDir: dir }),
      'MIGRATION_FAILED',
    );
    expect(error.versions).toEqual(['9002_broken']);
    expect(error.message).toContain('9002_broken');
    expect(error.message).toContain('22012');

    const exists = await target.pool.query<{ exists: boolean }>("SELECT to_regclass('public.probe_two') IS NOT NULL AS exists");
    expect(exists.rows[0]?.exists).toBe(false);
    expect(await recordedVersions()).not.toContain('9002_broken');

    // Syntax errors report the line within the file.
    await writeFile(path.join(dir, '9002_broken.sql'), 'CREATE TABLE probe_two (id int);\n\nCREATE TABEL oops (id int);\n');
    const syntax = await expectMigrationError(
      runMigrations({ connectionString: target.url, migrationsDir: dir }),
      'MIGRATION_FAILED',
    );
    expect(syntax.message).toContain('at line 3');
    expect(syntax.message).toContain('42601');

    await writeFile(path.join(dir, '9002_broken.sql'), 'CREATE TABLE probe_two (id int);\n');
    expect((await runMigrations({ connectionString: target.url, migrationsDir: dir })).applied).toEqual(['9002_broken']);
  });

  it('warns about out-of-order migrations but applies them', async () => {
    const dir = await copyOfMigrations();
    await writeFile(path.join(dir, '9001_add_probe.sql'), 'CREATE TABLE probe_one (id int PRIMARY KEY);\n');
    await writeFile(path.join(dir, '9002_broken.sql'), 'CREATE TABLE probe_two (id int);\n');
    await writeFile(path.join(dir, '8999_late_branch.sql'), 'CREATE TABLE probe_late (id int);\n');
    const logger = { info: vi.fn(), warn: vi.fn() };
    const result = await runMigrations({ connectionString: target.url, migrationsDir: dir, logger });
    expect(result.applied).toEqual(['8999_late_branch']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('8999_late_branch'));
  });

  it('runs "-- migrate:no-transaction" files outside a transaction', async () => {
    const dir = await copyOfMigrations();
    for (const [name, content] of [
      ['9001_add_probe.sql', 'CREATE TABLE probe_one (id int PRIMARY KEY);\n'],
      ['9002_broken.sql', 'CREATE TABLE probe_two (id int);\n'],
      ['8999_late_branch.sql', 'CREATE TABLE probe_late (id int);\n'],
      ['9003_concurrent_index.sql', '-- migrate:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS probe_one_idx ON probe_one (id);\n'],
    ] as const) {
      await writeFile(path.join(dir, name), content);
    }
    const result = await runMigrations({ connectionString: target.url, migrationsDir: dir });
    expect(result.applied).toEqual(['9003_concurrent_index']);
  });

  it('times out while another migrator holds the lock', async () => {
    const holder = new pg.Client({ connectionString: target.url });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock($1::bigint)', [MIGRATION_LOCK_KEY]);
      const logger = { info: vi.fn(), warn: vi.fn() };
      await expectMigrationError(
        runMigrations({ connectionString: target.url, migrationsDir: realDir, lockTimeoutMs: 500, logger }),
        'MIGRATION_LOCK_TIMEOUT',
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('waiting'));
    } finally {
      await holder.end();
    }
    // The lock is free again once the holder disconnects: the next run gets past the lock and
    // then stops because realDir lacks the probe migrations applied by the tests above.
    await expectMigrationError(
      runMigrations({ connectionString: target.url, migrationsDir: realDir, lockTimeoutMs: 5_000 }),
      'MIGRATION_FILE_MISSING',
    );
  });
});

describe('concurrent migrators', () => {
  let target: TestDatabase;

  beforeAll(async () => {
    target = await createTestDatabase({ migrate: false });
  });

  afterAll(async () => {
    await target.destroy();
  });

  it('serialize on the advisory lock and apply each migration exactly once', async () => {
    const versions = (await loadMigrationFiles(realDir)).map((file) => file.version);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => runMigrations({ connectionString: target.url, migrationsDir: realDir })),
    );
    const appliedRuns = results.filter((result) => result.applied.length > 0);
    expect(appliedRuns).toHaveLength(1);
    expect(appliedRuns[0]?.applied).toEqual(versions);
    for (const result of results.filter((entry) => entry.applied.length === 0)) {
      expect(result.alreadyApplied).toEqual(versions);
    }
    const count = await target.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(count.rows[0]?.n).toBe(versions.length);
  });
});
