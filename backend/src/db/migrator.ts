/**
 * Plain-SQL migrator (ARCHITECTURE §1.1, §4.10).
 *
 * - Files: <migrationsDir>/NNNN_snake_case_name.sql, applied in filename order.
 * - Bookkeeping: schema_migrations(version text PK, checksum text, applied_at).
 * - Concurrency: a session-level pg_advisory_lock serializes migrators
 *   (several backend replicas may start at once).
 * - Atomicity: each file runs in its own transaction together with its
 *   schema_migrations row. A file whose first line is
 *   `-- migrate:no-transaction` runs outside a transaction (needed for e.g.
 *   CREATE INDEX CONCURRENTLY); such files must be idempotent.
 * - Integrity: sha256 checksums of applied files are verified on every run;
 *   an edited or deleted applied migration aborts the run.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';

import { getPgError } from './errors';
import { createPool } from './kysely';

/** Advisory lock key held while migrating (audit writers use 7274001). */
export const MIGRATION_LOCK_KEY = 7_274_000;

const FILENAME_PATTERN = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const NO_TRANSACTION_MARKER = /^--\s*migrate:no-transaction\s*$/;
// Transaction control would silently break the per-file transaction.
const TRANSACTION_CONTROL =
  /^\s*(?:BEGIN(?:\s+(?:WORK|TRANSACTION))?|COMMIT(?:\s+(?:WORK|TRANSACTION))?|ROLLBACK(?:\s+(?:WORK|TRANSACTION))?|END\s+(?:WORK|TRANSACTION)|START\s+TRANSACTION[^;]*)\s*;/im;

export type MigrationErrorCode =
  | 'MIGRATION_DIR_NOT_FOUND'
  | 'MIGRATION_INVALID_FILE'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'MIGRATION_FILE_MISSING'
  | 'MIGRATION_LOCK_TIMEOUT'
  | 'MIGRATION_FAILED';

export class MigrationError extends Error {
  override readonly name = 'MigrationError';

  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    /** Migration versions the error refers to. */
    readonly versions: readonly string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface MigrationFile {
  /** File name without `.sql`, e.g. `0001_extensions_and_functions`. */
  readonly version: string;
  readonly filename: string;
  readonly path: string;
  /** Lower-case hex sha256 of the file (BOM stripped, CRLF normalized to LF). */
  readonly checksum: string;
  readonly sql: string;
  readonly transactional: boolean;
}

export type MigrationConnection =
  | { readonly pool: Pool; readonly connectionString?: undefined }
  | { readonly connectionString: string; readonly pool?: undefined };

export type MigrationOptions = MigrationConnection & {
  readonly migrationsDir: string;
  readonly logger?: MigrationLogger;
  /** How long to wait for another migrator's lock (default 120000 ms). */
  readonly lockTimeoutMs?: number;
};

export interface MigrationRunResult {
  /** Versions applied by this run, in order. */
  readonly applied: string[];
  /** Versions that were already applied before this run. */
  readonly alreadyApplied: string[];
}

export type MigrationState = 'applied' | 'pending' | 'checksum_mismatch' | 'missing_file';

export interface MigrationStatusEntry {
  readonly version: string;
  readonly state: MigrationState;
  /** Checksum of the file on disk (null when the file is missing). */
  readonly fileChecksum: string | null;
  /** Checksum recorded when applied (null when pending). */
  readonly appliedChecksum: string | null;
  readonly appliedAt: Date | null;
}

interface AppliedMigration {
  readonly checksum: string;
  readonly appliedAt: Date;
}

const silentLogger: MigrationLogger = { info: () => undefined, warn: () => undefined };

/** Normalizes line endings / BOM so checksums do not depend on the checkout platform. */
export function normalizeMigrationSql(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function checksumMigrationSql(content: string): string {
  return createHash('sha256').update(normalizeMigrationSql(content), 'utf8').digest('hex');
}

/** Reads, validates and sorts the migration files of `migrationsDir`. */
export async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch (err) {
    throw new MigrationError('MIGRATION_DIR_NOT_FOUND', `Migrations directory not readable: ${migrationsDir}`, [], {
      cause: err,
    });
  }

  const sqlFiles = entries.filter((name) => name.toLowerCase().endsWith('.sql')).sort();
  const seenNumbers = new Map<string, string>();
  const files: MigrationFile[] = [];

  for (const filename of sqlFiles) {
    const match = FILENAME_PATTERN.exec(filename);
    if (match === null) {
      throw new MigrationError(
        'MIGRATION_INVALID_FILE',
        `Invalid migration file name "${filename}" (expected NNNN_snake_case_name.sql)`,
        [filename],
      );
    }
    const number = match[1] ?? '';
    const previous = seenNumbers.get(number);
    if (previous !== undefined) {
      throw new MigrationError(
        'MIGRATION_INVALID_FILE',
        `Duplicate migration number ${number}: "${previous}" and "${filename}"`,
        [previous, filename],
      );
    }
    seenNumbers.set(number, filename);

    const filePath = path.join(migrationsDir, filename);
    const raw = await readFile(filePath, 'utf8');
    const sql = normalizeMigrationSql(raw);
    const version = filename.slice(0, -'.sql'.length);
    if (sql.trim() === '') {
      throw new MigrationError('MIGRATION_INVALID_FILE', `Migration ${version} is empty`, [version]);
    }
    const transactional = !NO_TRANSACTION_MARKER.test(sql.split('\n', 1)[0] ?? '');
    if (transactional && TRANSACTION_CONTROL.test(sql)) {
      throw new MigrationError(
        'MIGRATION_INVALID_FILE',
        `Migration ${version} contains transaction control statements; the migrator wraps each file in a transaction`,
        [version],
      );
    }
    files.push({ version, filename, path: filePath, checksum: checksumMigrationSql(raw), sql, transactional });
  }
  return files;
}

async function withClient<T>(connection: MigrationConnection, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const ownedPool = connection.pool === undefined;
  const pool =
    connection.pool === undefined
      ? createPool({ connectionString: connection.connectionString, poolMax: 1, applicationName: 'scpsl-trust-migrator' })
      : connection.pool;
  let client: PoolClient | undefined;
  let failed = false;
  try {
    client = await pool.connect();
    return await fn(client);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    // A client that saw an error is discarded rather than returned in an unknown state.
    client?.release(failed);
    if (ownedPool) await pool.end();
  }
}

async function acquireLock(client: PoolClient, timeoutMs: number, logger: MigrationLogger): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS locked', [
      MIGRATION_LOCK_KEY,
    ]);
    if (result.rows[0]?.locked === true) return;
    if (Date.now() >= deadline) {
      throw new MigrationError('MIGRATION_LOCK_TIMEOUT', `Timed out after ${timeoutMs} ms waiting for the migration lock`);
    }
    if (!announced) {
      logger.info('Another migrator holds the migration lock; waiting');
      announced = true;
    }
    await sleep(200);
  }
}

async function migrationsTableExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  return result.rows[0]?.exists === true;
}

async function readApplied(client: PoolClient): Promise<Map<string, AppliedMigration>> {
  const result = await client.query<{ version: string; checksum: string; applied_at: Date }>(
    'SELECT version, checksum, applied_at FROM public.schema_migrations ORDER BY version',
  );
  return new Map(result.rows.map((row) => [row.version, { checksum: row.checksum, appliedAt: row.applied_at }]));
}

function verifyApplied(files: readonly MigrationFile[], applied: ReadonlyMap<string, AppliedMigration>): void {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  const missing = [...applied.keys()].filter((version) => !byVersion.has(version));
  if (missing.length > 0) {
    throw new MigrationError(
      'MIGRATION_FILE_MISSING',
      `Applied migration(s) missing on disk: ${missing.join(', ')} (is this an older release than the database?)`,
      missing,
    );
  }
  const mismatched = files
    .filter((file) => {
      const record = applied.get(file.version);
      return record !== undefined && record.checksum !== file.checksum;
    })
    .map((file) => file.version);
  if (mismatched.length > 0) {
    throw new MigrationError(
      'MIGRATION_CHECKSUM_MISMATCH',
      `Applied migration(s) were modified after being applied: ${mismatched.join(', ')}. ` +
        'Never edit an applied migration; add a new one instead.',
      mismatched,
    );
  }
}

function describeFailure(file: MigrationFile, err: unknown): string {
  const pgError = getPgError(err);
  const base = err instanceof Error ? err.message : String(err);
  if (pgError === undefined) return `Migration ${file.version} failed: ${base}`;
  const position = Number(err instanceof Error ? Reflect.get(err, 'position') : undefined);
  const line = Number.isInteger(position) && position > 0 ? file.sql.slice(0, position).split('\n').length : undefined;
  return `Migration ${file.version} failed${line !== undefined ? ` at line ${line}` : ''}: ${base} (SQLSTATE ${pgError.code})`;
}

async function applyMigration(client: PoolClient, file: MigrationFile): Promise<void> {
  const record = 'INSERT INTO public.schema_migrations (version, checksum) VALUES ($1, $2)';
  if (!file.transactional) {
    try {
      await client.query(file.sql);
      await client.query(record, [file.version, file.checksum]);
    } catch (err) {
      throw new MigrationError('MIGRATION_FAILED', describeFailure(file, err), [file.version], { cause: err });
    }
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(file.sql);
    await client.query(record, [file.version, file.checksum]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw new MigrationError('MIGRATION_FAILED', describeFailure(file, err), [file.version], { cause: err });
  }
}

/** Applies all pending migrations. Throws MigrationError on any inconsistency or failure. */
export async function runMigrations(options: MigrationOptions): Promise<MigrationRunResult> {
  const logger = options.logger ?? silentLogger;
  const lockTimeoutMs = options.lockTimeoutMs ?? 120_000;
  const files = await loadMigrationFiles(options.migrationsDir);

  return withClient(options, async (client) => {
    await acquireLock(client, lockTimeoutMs, logger);
    try {
      // Migrations may legitimately run longer than the application's statement timeout.
      await client.query('SET statement_timeout = 0');
      await client.query(
        `CREATE TABLE IF NOT EXISTS public.schema_migrations (
           version    text        PRIMARY KEY,
           checksum   text        NOT NULL,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`,
      );
      const applied = await readApplied(client);
      verifyApplied(files, applied);

      const pending = files.filter((file) => !applied.has(file.version));
      const latestApplied = [...applied.keys()].sort().at(-1);
      if (latestApplied !== undefined) {
        const outOfOrder = pending.filter((file) => file.version < latestApplied).map((file) => file.version);
        if (outOfOrder.length > 0) {
          logger.warn(`Applying migration(s) older than ${latestApplied}: ${outOfOrder.join(', ')}`);
        }
      }

      for (const file of pending) {
        const startedAt = Date.now();
        await applyMigration(client, file);
        logger.info(`Applied migration ${file.version} (${Date.now() - startedAt} ms)`);
      }
      if (pending.length === 0) logger.info('Database schema is up to date');

      return {
        applied: pending.map((file) => file.version),
        alreadyApplied: files.filter((file) => applied.has(file.version)).map((file) => file.version),
      };
    } finally {
      await client.query('RESET statement_timeout').catch(() => undefined);
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  });
}

/** Compares migration files with schema_migrations without changing anything. */
export async function getMigrationStatus(
  options: MigrationConnection & { readonly migrationsDir: string },
): Promise<MigrationStatusEntry[]> {
  const files = await loadMigrationFiles(options.migrationsDir);
  const applied = await withClient(options, async (client) =>
    (await migrationsTableExists(client)) ? readApplied(client) : new Map<string, AppliedMigration>(),
  );

  const entries: MigrationStatusEntry[] = files.map((file) => {
    const record = applied.get(file.version);
    if (record === undefined) {
      return { version: file.version, state: 'pending', fileChecksum: file.checksum, appliedChecksum: null, appliedAt: null };
    }
    return {
      version: file.version,
      state: record.checksum === file.checksum ? 'applied' : 'checksum_mismatch',
      fileChecksum: file.checksum,
      appliedChecksum: record.checksum,
      appliedAt: record.appliedAt,
    };
  });
  const known = new Set(files.map((file) => file.version));
  for (const [version, record] of applied) {
    if (!known.has(version)) {
      entries.push({
        version,
        state: 'missing_file',
        fileChecksum: null,
        appliedChecksum: record.checksum,
        appliedAt: record.appliedAt,
      });
    }
  }
  return entries.sort((a, b) => a.version.localeCompare(b.version));
}
