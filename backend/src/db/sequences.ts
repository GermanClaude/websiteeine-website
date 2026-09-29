/**
 * Allocation of human-readable numbers backed by the database
 * (case numbers, reviewer pseudonyms, audit sequence).
 */
import { sql } from 'kysely';

import type { DbExecutor } from './tx';

const MIN_YEAR = 2000;
const MAX_YEAR = 9999;
const MAX_CASE_COUNTER = 999_999;

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`Invalid case year: ${String(year)}`);
  }
}

/**
 * Atomically increments and returns the per-year case counter (1, 2, 3, ...).
 * Concurrency-safe: the upsert serializes on the case_counters row. Call it in
 * the same transaction that inserts the case so a rollback does not burn it
 * silently (a rolled back increment is also rolled back).
 */
export async function nextCaseCounterValue(db: DbExecutor, year: number): Promise<number> {
  assertYear(year);
  const row = await db
    .insertInto('case_counters')
    .values({ year, last_value: 1 })
    .onConflict((oc) => oc.column('year').doUpdateSet({ last_value: sql<number>`case_counters.last_value + 1` }))
    .returning('last_value')
    .executeTakeFirstOrThrow();
  return row.last_value;
}

/** CASE-<yyyy>-<6-digit counter>, e.g. CASE-2026-001337. */
export function formatCaseNumber(year: number, counter: number): string {
  assertYear(year);
  if (!Number.isInteger(counter) || counter < 1 || counter > MAX_CASE_COUNTER) {
    throw new RangeError(`Invalid case counter: ${String(counter)}`);
  }
  return `CASE-${String(year)}-${String(counter).padStart(6, '0')}`;
}

/** Allocates the next case number for `year` (default: current UTC year). */
export async function allocateCaseNumber(db: DbExecutor, year: number = new Date().getUTCFullYear()): Promise<string> {
  return formatCaseNumber(year, await nextCaseCounterValue(db, year));
}

/** Next reviewer pseudonym number ("Reviewer #<n>"). */
export async function nextReviewerNumber(db: DbExecutor): Promise<number> {
  const result = await sql<{ value: number }>`SELECT nextval('users_reviewer_number_seq')::integer AS value`.execute(db);
  const value = result.rows[0]?.value;
  if (value === undefined) throw new Error('nextval(users_reviewer_number_seq) returned no row');
  return value;
}

/**
 * Next audit_events.seq. Must be called by the audit writer while holding
 * pg_advisory_xact_lock(7274001) in the same transaction (ARCHITECTURE §9.1).
 */
export async function nextAuditSeq(db: DbExecutor): Promise<number> {
  const result = await sql<{ value: number }>`SELECT nextval('audit_events_seq') AS value`.execute(db);
  const value = result.rows[0]?.value;
  if (value === undefined) throw new Error('nextval(audit_events_seq) returned no row');
  return value;
}
