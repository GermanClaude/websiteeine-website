/**
 * SQL of the reports module (Kysely). Also exports the joined report-view query
 * used by the cases module for the staff case view.
 */
import type { SelectQueryBuilder } from 'kysely';

import type { DbExecutor } from '../../db/tx';
import type {
  ReportRow,
} from '../../db/types';
import type { ReportStatus } from '../../db/enums';
import type { ReportViewRow } from '../cases/views';

// ---------------------------------------------------------------------------
// Joined view query
// ---------------------------------------------------------------------------

/** Base query producing ReportViewRow rows (no filters, no ordering). */
export function reportViewQuery(db: DbExecutor) {
  return db
    .selectFrom('reports as r')
    .innerJoin('cases as c', 'c.id', 'r.case_id')
    .innerJoin('players as p', 'p.id', 'r.player_id')
    .leftJoin('servers as s', 's.id', 'r.server_id')
    .leftJoin('users as ru', 'ru.id', 'r.reporter_user_id')
    .leftJoin('players as rp', 'rp.id', 'r.reporter_player_id')
    .leftJoin('users as rb', 'rb.id', 'r.resolved_by')
    .select([
      'r.id',
      'c.case_number',
      'r.reporter_type',
      'r.reason',
      'r.description',
      'r.status',
      'r.resolution_note',
      'r.resolved_at',
      'r.resolved_by',
      'r.created_at',
      'r.updated_at',
      'p.id_type as player_id_type',
      'p.external_id as player_external_id',
      'p.display_name as player_display_name',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'r.reporter_user_id',
      'ru.username as reporter_username',
      'rp.id_type as reporter_player_id_type',
      'rp.external_id as reporter_player_external_id',
      'rp.display_name as reporter_player_display_name',
      'rb.reviewer_number as resolved_by_reviewer_number',
    ])
    .select((eb) =>
      eb
        .selectFrom('evidence')
        .whereRef('evidence.report_id', '=', 'r.id')
        .select((sb) => sb.fn.countAll<number>().as('n'))
        .as('evidence_count'),
    );
}

/** The row type reportViewQuery produces (evidence_count may come back as null). */
type RawReportViewRow = Omit<ReportViewRow, 'evidence_count'> & { evidence_count: number | null };

export function normalizeReportViewRow(row: RawReportViewRow): ReportViewRow {
  return { ...row, evidence_count: Number(row.evidence_count ?? 0) };
}

export async function getReportViewById(db: DbExecutor, id: string): Promise<ReportViewRow | undefined> {
  const row = await reportViewQuery(db).where('r.id', '=', id).executeTakeFirst();
  return row === undefined ? undefined : normalizeReportViewRow(row as RawReportViewRow);
}

export async function listReportViewsForCase(db: DbExecutor, caseId: string): Promise<ReportViewRow[]> {
  const rows = await reportViewQuery(db).where('r.case_id', '=', caseId).orderBy('r.created_at', 'asc').orderBy('r.id', 'asc').execute();
  return rows.map((row) => normalizeReportViewRow(row as RawReportViewRow));
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface ReportListFilters {
  status?: ReportStatus;
  caseId?: string;
  playerId?: string;
  serverId?: string;
  /** Restrict to this reporter (non-reviewers, or ?mine=true). */
  reporterUserId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyReportFilters<Q extends SelectQueryBuilder<any, any, any>>(query: Q, filters: ReportListFilters): Q {
  let q = query;
  if (filters.status !== undefined) q = q.where('r.status', '=', filters.status) as Q;
  if (filters.caseId !== undefined) q = q.where('r.case_id', '=', filters.caseId) as Q;
  if (filters.playerId !== undefined) q = q.where('r.player_id', '=', filters.playerId) as Q;
  if (filters.serverId !== undefined) q = q.where('r.server_id', '=', filters.serverId) as Q;
  if (filters.reporterUserId !== undefined) q = q.where('r.reporter_user_id', '=', filters.reporterUserId) as Q;
  return q;
}

export async function listReports(
  db: DbExecutor,
  filters: ReportListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: ReportViewRow[]; total: number }> {
  const rows = await applyReportFilters(reportViewQuery(db), filters)
    .orderBy('r.created_at', 'desc')
    .orderBy('r.id', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  const totalRow = await applyReportFilters(
    db.selectFrom('reports as r').select((eb) => eb.fn.countAll<number>().as('total')),
    filters,
  ).executeTakeFirstOrThrow();
  return {
    items: rows.map((row) => normalizeReportViewRow(row as RawReportViewRow)),
    total: Number(totalRow.total),
  };
}

// ---------------------------------------------------------------------------
// Writes & lookups
// ---------------------------------------------------------------------------

export function findReportById(db: DbExecutor, id: string): Promise<ReportRow | undefined> {
  return db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
}

/** Open report by the same reporter for the same player (§11.1 dedupe). */
export function findOpenReport(
  db: DbExecutor,
  playerId: string,
  reporter: { userId?: string; playerId?: string; serverId?: string },
): Promise<ReportRow | undefined> {
  let query = db.selectFrom('reports').selectAll().where('player_id', '=', playerId).where('status', '=', 'open');
  if (reporter.userId !== undefined) {
    query = query.where('reporter_user_id', '=', reporter.userId);
  } else if (reporter.playerId !== undefined) {
    query = query.where('reporter_player_id', '=', reporter.playerId);
  } else if (reporter.serverId !== undefined) {
    // Server-submitted report without an in-game reporter: one open per server & player.
    query = query.where('server_id', '=', reporter.serverId).where('reporter_player_id', 'is', null);
  }
  return query.limit(1).executeTakeFirst();
}
