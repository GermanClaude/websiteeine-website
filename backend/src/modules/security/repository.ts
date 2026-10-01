/**
 * Queries over the append-only `security_events` table. `score` is a numeric column (pg
 * returns it as a string); every read casts it to double precision so callers get a number.
 */
import { sql, type Kysely } from 'kysely';

import type {
  SecurityActionTaken,
  SecurityEventKind,
  SecuritySeverity,
  SecuritySourceType,
} from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db/tx';
import type { Database, JsonObject } from '../../db/types';
import { toOffset, type PageQuery } from '../../lib/pagination';

export interface SecurityEventRecord {
  id: string;
  created_at: Date;
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  source_type: SecuritySourceType;
  source_ref: string | null;
  score: number | null;
  action_taken: SecurityActionTaken;
  endpoint: string | null;
  request_id: string | null;
  metadata: JsonObject;
  expires_at: Date | null;
}

export interface InsertSecurityEventInput {
  kind: SecurityEventKind;
  severity: SecuritySeverity;
  source_type: SecuritySourceType;
  source_ref: string | null;
  score?: number | null;
  action_taken: SecurityActionTaken;
  endpoint?: string | null;
  request_id?: string | null;
  metadata?: JsonObject;
  expires_at?: Date | null;
  created_at?: Date;
}

const SELECT_COLUMNS = [
  'id',
  'created_at',
  'kind',
  'severity',
  'source_type',
  'source_ref',
  sql<number | null>`score::double precision`.as('score'),
  'action_taken',
  'endpoint',
  'request_id',
  'metadata',
  'expires_at',
] as const;

export async function insertSecurityEvent(db: DbExecutor, input: InsertSecurityEventInput): Promise<SecurityEventRecord> {
  const row = await db
    .insertInto('security_events')
    .values({
      kind: input.kind,
      severity: input.severity,
      source_type: input.source_type,
      source_ref: input.source_ref,
      score: input.score ?? null,
      action_taken: input.action_taken,
      endpoint: input.endpoint ?? null,
      request_id: input.request_id ?? null,
      metadata: input.metadata ?? {},
      ...(input.created_at !== undefined ? { created_at: input.created_at } : {}),
      expires_at: input.expires_at ?? null,
    })
    .returning(SELECT_COLUMNS)
    .executeTakeFirstOrThrow();
  return row as SecurityEventRecord;
}

export interface SecurityEventFilters {
  kind?: SecurityEventKind;
  severity?: SecuritySeverity;
  source_type?: SecuritySourceType;
  source_ref?: string;
  from?: Date;
  to?: Date;
}

export async function listSecurityEvents(
  db: Kysely<Database>,
  filters: SecurityEventFilters,
  page: Partial<PageQuery>,
): Promise<{ items: SecurityEventRecord[]; total: number }> {
  let query = db.selectFrom('security_events');
  if (filters.kind !== undefined) query = query.where('kind', '=', filters.kind);
  if (filters.severity !== undefined) query = query.where('severity', '=', filters.severity);
  if (filters.source_type !== undefined) query = query.where('source_type', '=', filters.source_type);
  if (filters.source_ref !== undefined) query = query.where('source_ref', '=', filters.source_ref);
  if (filters.from !== undefined) query = query.where('created_at', '>=', filters.from);
  if (filters.to !== undefined) query = query.where('created_at', '<=', filters.to);

  const { limit, offset } = toOffset(page);
  const [rows, count] = await Promise.all([
    query.select(SELECT_COLUMNS).orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).offset(offset).execute(),
    query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirst(),
  ]);
  return { items: rows as SecurityEventRecord[], total: Number(count?.total ?? 0) };
}

export interface ActiveBlockRecord {
  source_type: SecuritySourceType;
  source_ref: string;
  score: number | null;
  strikes: number;
  created_at: Date;
  expires_at: Date;
}

/**
 * Currently-active blocks, derived from the append-only log: the most recent block/unblock
 * event per source, kept when it is a `source_blocked` that has not yet expired. This mirrors
 * auto-expiry (by time) and manual clears (a later `source_unblocked` row).
 */
export async function listActiveBlocks(db: Kysely<Database>, now: Date): Promise<ActiveBlockRecord[]> {
  const rows = await db
    .selectFrom('security_events')
    .select(['source_type', 'source_ref', 'kind', 'created_at', 'expires_at', 'metadata', sql<number | null>`score::double precision`.as('score')])
    .where('kind', 'in', ['source_blocked', 'source_unblocked'])
    .where('source_ref', 'is not', null)
    .distinctOn(['source_type', 'source_ref'])
    .orderBy('source_type')
    .orderBy('source_ref')
    .orderBy('created_at', 'desc')
    .execute();

  const blocks: ActiveBlockRecord[] = [];
  for (const row of rows) {
    if (row.kind !== 'source_blocked' || row.source_ref === null || row.expires_at === null) continue;
    if (row.expires_at.getTime() <= now.getTime()) continue;
    const strikesRaw = (row.metadata as JsonObject)['strikes'];
    blocks.push({
      source_type: row.source_type,
      source_ref: row.source_ref,
      score: row.score,
      strikes: typeof strikesRaw === 'number' && Number.isFinite(strikesRaw) ? strikesRaw : 1,
      created_at: row.created_at,
      expires_at: row.expires_at,
    });
  }
  blocks.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return blocks;
}

/** Whether a source currently has an active block recorded in the log. */
export async function hasActiveBlock(
  db: Kysely<Database>,
  sourceType: SecuritySourceType,
  sourceRef: string,
  now: Date,
): Promise<boolean> {
  const row = await db
    .selectFrom('security_events')
    .select(['kind', 'expires_at'])
    .where('source_type', '=', sourceType)
    .where('source_ref', '=', sourceRef)
    .where('kind', 'in', ['source_blocked', 'source_unblocked'])
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.kind === 'source_blocked' && row.expires_at !== null && row.expires_at.getTime() > now.getTime();
}

const SEVERITY_RANK_SQL = sql<number>`CASE severity
  WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`;

export interface SeverityCountsRow {
  severity: SecuritySeverity;
  count: number;
}

export async function countBySeveritySince(db: Kysely<Database>, since: Date): Promise<SeverityCountsRow[]> {
  const rows = await db
    .selectFrom('security_events')
    .select(['severity', (eb) => eb.fn.countAll<number>().as('count')])
    .where('created_at', '>=', since)
    .groupBy('severity')
    .execute();
  return rows.map((row) => ({ severity: row.severity, count: Number(row.count) }));
}

export async function countKindSince(db: Kysely<Database>, kind: SecurityEventKind, since: Date): Promise<number> {
  const row = await db
    .selectFrom('security_events')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('kind', '=', kind)
    .where('created_at', '>=', since)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export interface TopSourceRow {
  source_type: SecuritySourceType;
  source_ref: string;
  event_count: number;
  max_severity_rank: number;
}

export async function topSourcesSince(db: Kysely<Database>, since: Date, limit: number): Promise<TopSourceRow[]> {
  const rows = await db
    .selectFrom('security_events')
    .select([
      'source_type',
      'source_ref',
      (eb) => eb.fn.countAll<number>().as('event_count'),
      (eb) => eb.fn.max(SEVERITY_RANK_SQL).as('max_severity_rank'),
    ])
    .where('created_at', '>=', since)
    .where('source_ref', 'is not', null)
    .groupBy(['source_type', 'source_ref'])
    .orderBy('event_count', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => ({
    source_type: row.source_type,
    source_ref: row.source_ref as string,
    event_count: Number(row.event_count),
    max_severity_rank: Number(row.max_severity_rank),
  }));
}
