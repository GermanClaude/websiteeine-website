/**
 * Classification of PostgreSQL errors raised through pg / Kysely.
 * Repositories use these to map constraint and trigger violations to
 * application errors (e.g. ALREADY_EXISTS, INVALID_STATE) without string
 * matching on messages.
 */

/** SQLSTATE raised by every protection trigger (forbid_delete, evidence guard, ...). */
export const FORBIDDEN_OPERATION_SQLSTATE = 'TN403';

export const PG_ERROR_CODES = {
  NOT_NULL_VIOLATION: '23502',
  FOREIGN_KEY_VIOLATION: '23503',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  FORBIDDEN_OPERATION: FORBIDDEN_OPERATION_SQLSTATE,
} as const;

/** The subset of pg's DatabaseError fields the application relies on. */
export interface PgErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly column: string | undefined;
  readonly detail: string | undefined;
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

function readOptionalString(source: object, key: string): string | undefined {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Returns the PostgreSQL error carried by `err` (or by its `cause`), or
 * undefined for anything else (network errors, application errors, ...).
 */
export function getPgError(err: unknown): PgErrorInfo | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const code = readOptionalString(current, 'code');
    if (code !== undefined && SQLSTATE_PATTERN.test(code)) {
      return {
        code,
        message: current.message,
        constraint: readOptionalString(current, 'constraint'),
        table: readOptionalString(current, 'table'),
        column: readOptionalString(current, 'column'),
        detail: readOptionalString(current, 'detail'),
      };
    }
    current = current.cause;
  }
  return undefined;
}

function hasCode(err: unknown, code: string, constraint?: string): boolean {
  const pgError = getPgError(err);
  if (pgError === undefined || pgError.code !== code) return false;
  return constraint === undefined || pgError.constraint === constraint;
}

/** 23505; optionally only for the given constraint / unique index name. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  return hasCode(err, PG_ERROR_CODES.UNIQUE_VIOLATION, constraint);
}

/** 23503; optionally only for the given foreign key constraint name. */
export function isForeignKeyViolation(err: unknown, constraint?: string): boolean {
  return hasCode(err, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION, constraint);
}

/** 23514; optionally only for the given CHECK constraint name. */
export function isCheckViolation(err: unknown, constraint?: string): boolean {
  return hasCode(err, PG_ERROR_CODES.CHECK_VIOLATION, constraint);
}

/** 23502; optionally only for the given column. */
export function isNotNullViolation(err: unknown, column?: string): boolean {
  const pgError = getPgError(err);
  if (pgError === undefined || pgError.code !== PG_ERROR_CODES.NOT_NULL_VIOLATION) return false;
  return column === undefined || pgError.column === column;
}

/**
 * A protection trigger rejected the statement (DELETE/UPDATE/TRUNCATE of
 * history rows, immutable evidence columns, ...). Optionally only for `table`.
 */
export function isForbiddenOperation(err: unknown, table?: string): boolean {
  const pgError = getPgError(err);
  if (pgError === undefined || pgError.code !== FORBIDDEN_OPERATION_SQLSTATE) return false;
  return table === undefined || pgError.table === table;
}

/** Serialization failure or deadlock: the transaction may be retried. */
export function isRetryableTransactionError(err: unknown): boolean {
  const code = getPgError(err)?.code;
  return code === PG_ERROR_CODES.SERIALIZATION_FAILURE || code === PG_ERROR_CODES.DEADLOCK_DETECTED;
}
