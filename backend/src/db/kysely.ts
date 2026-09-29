/**
 * PostgreSQL pool + Kysely instance factory.
 *
 * Type parsing is configured per pool (never via the global pg.types
 * registry, so other pg users in the process are unaffected):
 * - int8 / bigint -> number, throwing when the value exceeds
 *   Number.MAX_SAFE_INTEGER (counts, sequences and byte sizes stay exact);
 * - numeric stays a string (pg default; no silent precision loss);
 * - timestamptz -> Date (pg default).
 * Sessions run with TimeZone=UTC so SQL date arithmetic (e.g. the case-number
 * year) is independent of the server configuration.
 */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { CustomTypesConfig, Pool, PoolConfig } from 'pg';

import type { Database } from './types';

const INT8_OID = 20;
const INT8_ARRAY_OID = 1016;

/** Parses a PostgreSQL int8 text value; rejects values that are not safe JS integers. */
export function parseInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`int8 value ${value} exceeds the safe JavaScript integer range`);
  }
  return parsed;
}

type TextParser = (value: string) => unknown;
type TypeParserLookup = CustomTypesConfig['getTypeParser'];
/** pg-types' TypeId enum (not every OID is a member, e.g. int8[]). */
type TypeOid = Parameters<TypeParserLookup>[0];

// pg's default int8[] parser yields string elements (or null); convert each.
const defaultInt8ArrayParser = pg.types.getTypeParser(INT8_ARRAY_OID as TypeOid, 'text') as TextParser;

function parseInt8Array(value: string): (number | null)[] {
  const parsed = defaultInt8ArrayParser(value);
  if (!Array.isArray(parsed)) throw new TypeError('Unexpected int8[] value');
  return parsed.map((entry: unknown) => (entry === null ? null : parseInt8(String(entry))));
}

const getTypeParser = ((oid: number, format?: 'text' | 'binary'): TextParser => {
  if (format === undefined || format === 'text') {
    if (oid === INT8_OID) return parseInt8;
    if (oid === INT8_ARRAY_OID) return parseInt8Array;
  }
  return pg.types.getTypeParser(oid as TypeOid, format) as TextParser;
}) as TypeParserLookup;

/** Per-pool type parser configuration (see module comment). */
export const pgTypeParsers: CustomTypesConfig = { getTypeParser };

export interface DatabaseOptions {
  connectionString: string;
  /** Maximum pool size (default 10). */
  poolMax?: number;
  /** statement_timeout for every session in ms (0/undefined = server default). */
  statementTimeoutMs?: number;
  /** idle_in_transaction_session_timeout in ms (default 60000). */
  idleInTransactionTimeoutMs?: number;
  /** Time to wait for a new connection in ms (default 10000). */
  connectionTimeoutMs?: number;
  /** Close idle clients after this many ms (default 30000). */
  idleTimeoutMs?: number;
  applicationName?: string;
  /** Called for errors of idle pooled clients (e.g. server restart). */
  onPoolError?: (err: Error) => void;
}

export interface DatabaseHandle {
  readonly db: Kysely<Database>;
  readonly pool: Pool;
  /** Closes Kysely and the pool. Safe to call more than once. */
  destroy(): Promise<void>;
}

function positiveIntOrUndefined(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

/** Creates a pg pool with the project's type parsers and session settings. */
export function createPool(options: DatabaseOptions): Pool {
  if (options.connectionString.trim() === '') {
    throw new Error('DATABASE_URL / connectionString is empty');
  }
  const poolMax = positiveIntOrUndefined(options.poolMax, 'poolMax') ?? 10;
  if (poolMax < 1) throw new RangeError('poolMax must be at least 1');
  const statementTimeoutMs = positiveIntOrUndefined(options.statementTimeoutMs, 'statementTimeoutMs');

  const config: PoolConfig = {
    connectionString: options.connectionString,
    max: poolMax,
    types: pgTypeParsers,
    options: '-c TimeZone=UTC',
    application_name: options.applicationName ?? 'scpsl-trust-backend',
    idle_in_transaction_session_timeout:
      positiveIntOrUndefined(options.idleInTransactionTimeoutMs, 'idleInTransactionTimeoutMs') ?? 60_000,
    connectionTimeoutMillis: positiveIntOrUndefined(options.connectionTimeoutMs, 'connectionTimeoutMs') ?? 10_000,
    idleTimeoutMillis: positiveIntOrUndefined(options.idleTimeoutMs, 'idleTimeoutMs') ?? 30_000,
  };
  if (statementTimeoutMs !== undefined && statementTimeoutMs > 0) {
    config.statement_timeout = statementTimeoutMs;
  }

  const pool = new pg.Pool(config);
  // Without a listener an idle-client error would crash the process.
  pool.on('error', (err: Error) => {
    if (options.onPoolError) {
      options.onPoolError(err);
    } else {
      process.emitWarning(`PostgreSQL idle client error: ${err.message}`, { code: 'SCPSL_DB_POOL_ERROR' });
    }
  });
  return pool;
}

/** Wraps an existing pool in a Kysely instance. Destroying Kysely ends the pool. */
export function createKysely(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Creates pool + Kysely. */
export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const pool = createPool(options);
  const db = createKysely(pool);
  let destroyed: Promise<void> | undefined;
  return {
    db,
    pool,
    destroy(): Promise<void> {
      destroyed ??= db.destroy();
      return destroyed;
    },
  };
}
