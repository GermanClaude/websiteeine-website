/**
 * SQL of the cases module (Kysely). Read-only lookups into tables owned by other
 * modules (players, servers, evidence, appeals, audit_events) live here too, per
 * the module ownership rules.
 */
import { sql, type SelectQueryBuilder } from 'kysely';

import type { DbExecutor } from '../../db/tx';
import type {
  CaseRow,
  NewCase,
  PlayerRow,
  ServerRow,
} from '../../db/types';
import type { CaseStatus, CaseVerdict } from '../../db/enums';
import type { CaseSummaryRow, ConfirmationViewRow, EvidenceViewRow, ReviewViewRow } from './views';

// ---------------------------------------------------------------------------
// Case lookups
// ---------------------------------------------------------------------------

export function findCaseByNumber(db: DbExecutor, caseNumber: string): Promise<CaseRow | undefined> {
  return db.selectFrom('cases').selectAll().where('case_number', '=', caseNumber).executeTakeFirst();
}

export function findCaseById(db: DbExecutor, id: string): Promise<CaseRow | undefined> {
  return db.selectFrom('cases').selectAll().where('id', '=', id).executeTakeFirst();
}

/** Most recent case of the player with status open/under_review. */
export function findOpenCaseForPlayer(db: DbExecutor, playerId: string): Promise<CaseRow | undefined> {
  return db
    .selectFrom('cases')
    .selectAll()
    .where('player_id', '=', playerId)
    .where('status', 'in', ['open', 'under_review'] satisfies CaseStatus[])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export function insertCase(db: DbExecutor, values: NewCase): Promise<CaseRow> {
  return db.insertInto('cases').values(values).returningAll().executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------
// Foreign lookups (read-only)
// ---------------------------------------------------------------------------

export function findPlayerById(db: DbExecutor, id: string): Promise<PlayerRow | undefined> {
  return db.selectFrom('players').selectAll().where('id', '=', id).executeTakeFirst();
}

export function findPlayerByRef(db: DbExecutor, ref: { type: string; id: string }): Promise<PlayerRow | undefined> {
  return db
    .selectFrom('players')
    .selectAll()
    .where('id_type', '=', ref.type as PlayerRow['id_type'])
    .where('external_id', '=', ref.id)
    .executeTakeFirst();
}

/** Concurrency-safe player upsert (same semantics as the players module). */
export function upsertPlayer(db: DbExecutor, ref: { type: PlayerRow['id_type']; id: string }, now: Date): Promise<PlayerRow> {
  return db
    .insertInto('players')
    .values({
      id_type: ref.type,
      external_id: ref.id,
      first_seen_at: now,
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc.columns(['id_type', 'external_id']).doUpdateSet({ last_seen_at: now, updated_at: now }))
    .returningAll()
    .executeTakeFirstOrThrow();
}

export function findServerByPublicId(db: DbExecutor, serverId: string): Promise<ServerRow | undefined> {
  return db.selectFrom('servers').selectAll().where('server_id', '=', serverId).executeTakeFirst();
}

/** Internal uuids of the servers the user is a member of. */
export async function memberServerUuids(db: DbExecutor, userId: string): Promise<string[]> {
  const rows = await db.selectFrom('server_members').select('server_id').where('user_id', '=', userId).execute();
  return rows.map((r) => r.server_id);
}

// ---------------------------------------------------------------------------
// Listing (staff, with counts)
// ---------------------------------------------------------------------------

export interface CaseListFilters {
  status?: CaseStatus;
  verdict?: CaseVerdict;
  /** Resolved internal player uuid ('player' query param). */
  playerId?: string;
  q?: string;
  /** Internal server uuid: cases this server reported or confirmed. */
  serverUuid?: string;
  /** own_servers scope: only cases these servers reported or confirmed. */
  scopeServerUuids?: string[];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCaseFilters<Q extends SelectQueryBuilder<any, any, any>>(query: Q, filters: CaseListFilters): Q {
  let q = query;
  if (filters.status !== undefined) q = q.where('c.status', '=', filters.status) as Q;
  if (filters.verdict !== undefined) q = q.where('c.current_verdict', '=', filters.verdict) as Q;
  if (filters.playerId !== undefined) q = q.where('c.player_id', '=', filters.playerId) as Q;
  if (filters.q !== undefined) {
    const pattern = `%${escapeLike(filters.q)}%`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = q.where((eb: any) =>
      eb.or([
        eb('c.case_number', 'ilike', pattern),
        eb('p.display_name', 'ilike', pattern),
        eb('p.external_id', 'ilike', pattern),
      ]),
    ) as Q;
  }
  const involvement = (serverUuids: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = q.where((eb: any) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('reports as rr')
            .select('rr.id')
            .whereRef('rr.case_id', '=', 'c.id')
            .where('rr.server_id', 'in', serverUuids),
        ),
        eb.exists(
          eb
            .selectFrom('case_server_confirmations as ccx')
            .select('ccx.id')
            .whereRef('ccx.case_id', '=', 'c.id')
            .where('ccx.revoked_at', 'is', null)
            .where('ccx.server_id', 'in', serverUuids),
        ),
      ]),
    ) as Q;
  };
  if (filters.serverUuid !== undefined) involvement([filters.serverUuid]);
  if (filters.scopeServerUuids !== undefined) involvement(filters.scopeServerUuids);
  return q;
}

export async function listCases(
  db: DbExecutor,
  filters: CaseListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: CaseSummaryRow[]; total: number }> {
  if (filters.scopeServerUuids !== undefined && filters.scopeServerUuids.length === 0) {
    return { items: [], total: 0 };
  }
  const base = db.selectFrom('cases as c').innerJoin('players as p', 'p.id', 'c.player_id');
  const rows = await applyCaseFilters(
    base
      .select([
        'c.case_number',
        'c.status',
        'c.current_verdict',
        'c.reason',
        'c.created_at',
        'c.updated_at',
        'p.id_type as player_id_type',
        'p.external_id as player_external_id',
        'p.display_name as player_display_name',
      ])
      .select((eb) => [
        eb
          .selectFrom('reports')
          .whereRef('reports.case_id', '=', 'c.id')
          .select((sb) => sb.fn.countAll<number>().as('n'))
          .as('report_count'),
        eb
          .selectFrom('reports')
          .whereRef('reports.case_id', '=', 'c.id')
          .where('reports.status', '=', 'open')
          .select((sb) => sb.fn.countAll<number>().as('n'))
          .as('open_report_count'),
        eb
          .selectFrom('evidence')
          .whereRef('evidence.case_id', '=', 'c.id')
          .select((sb) => sb.fn.countAll<number>().as('n'))
          .as('evidence_count'),
        eb
          .selectFrom('case_server_confirmations as cc')
          .whereRef('cc.case_id', '=', 'c.id')
          .where('cc.revoked_at', 'is', null)
          .select((sb) => sb.fn.count<number>(sql`distinct cc.server_id`).as('n'))
          .as('confirmed_servers'),
      ]),
    filters,
  )
    .orderBy('c.created_at', 'desc')
    .orderBy('c.id', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  const totalRow = await applyCaseFilters(
    base.select((eb) => eb.fn.countAll<number>().as('total')),
    filters,
  ).executeTakeFirstOrThrow();

  const items = rows.map((row) => ({
    ...row,
    report_count: Number(row.report_count ?? 0),
    open_report_count: Number(row.open_report_count ?? 0),
    evidence_count: Number(row.evidence_count ?? 0),
    confirmed_servers: Number(row.confirmed_servers ?? 0),
  })) as CaseSummaryRow[];
  return { items, total: Number(totalRow.total) };
}

/** Whether any of the servers reported on or actively confirmed the case. */
export async function caseInvolvesServers(db: DbExecutor, caseId: string, serverUuids: string[]): Promise<boolean> {
  if (serverUuids.length === 0) return false;
  const reported = await db
    .selectFrom('reports')
    .select('id')
    .where('case_id', '=', caseId)
    .where('server_id', 'in', serverUuids)
    .limit(1)
    .executeTakeFirst();
  if (reported !== undefined) return true;
  const confirmed = await db
    .selectFrom('case_server_confirmations')
    .select('id')
    .where('case_id', '=', caseId)
    .where('revoked_at', 'is', null)
    .where('server_id', 'in', serverUuids)
    .limit(1)
    .executeTakeFirst();
  return confirmed !== undefined;
}

// ---------------------------------------------------------------------------
// Detail collections
// ---------------------------------------------------------------------------

export function listEvidenceForCase(db: DbExecutor, caseId: string): Promise<EvidenceViewRow[]> {
  return db
    .selectFrom('evidence as e')
    .leftJoin('users as uu', 'uu.id', 'e.uploader_user_id')
    .leftJoin('servers as us', 'us.id', 'e.uploader_server_id')
    .select([
      'e.id',
      'e.report_id',
      'e.type',
      'e.title',
      'e.description',
      'e.status',
      'e.identity_status',
      'e.authenticity_status',
      'e.cheating_status',
      'e.sha256',
      'e.size_bytes',
      'e.mime_type',
      'e.original_filename',
      'e.external_url',
      'e.overwatch_session_id',
      'e.supersedes_evidence_id',
      'e.superseded_by_evidence_id',
      'e.uploaded_at',
      'e.created_at',
      'e.updated_at',
      'e.uploader_user_id',
      'uu.username as uploader_username',
      'us.server_id as uploader_server_public_id',
      'us.name as uploader_server_name',
      'us.is_trusted as uploader_server_is_trusted',
    ])
    .where('e.case_id', '=', caseId)
    .orderBy('e.created_at', 'asc')
    .orderBy('e.id', 'asc')
    .execute() as Promise<EvidenceViewRow[]>;
}

export function listReviewsForCase(db: DbExecutor, caseId: string): Promise<ReviewViewRow[]> {
  return db
    .selectFrom('reviews as v')
    .innerJoin('users as u', 'u.id', 'v.reviewer_user_id')
    .select([
      'v.id',
      'v.kind',
      'v.previous_verdict',
      'v.new_verdict',
      'v.comment',
      'v.appeal_id',
      'v.created_at',
      'u.reviewer_number',
    ])
    .where('v.case_id', '=', caseId)
    .orderBy('v.created_at', 'asc')
    .orderBy('v.id', 'asc')
    .execute();
}

export function listConfirmationsForCase(db: DbExecutor, caseId: string): Promise<ConfirmationViewRow[]> {
  return db
    .selectFrom('case_server_confirmations as cc')
    .innerJoin('servers as s', 's.id', 'cc.server_id')
    .innerJoin('users as u', 'u.id', 'cc.confirmed_by_user_id')
    .select([
      'cc.id',
      'cc.note',
      'cc.created_at',
      'cc.revoked_at',
      'cc.revoke_reason',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'u.id as confirmed_by_id',
      'u.username as confirmed_by_username',
    ])
    .where('cc.case_id', '=', caseId)
    .orderBy('cc.created_at', 'asc')
    .orderBy('cc.id', 'asc')
    .execute();
}

export interface AppealViewRow {
  id: string;
  statement: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  decided_at: Date | null;
  conflict_override: boolean;
  created_at: Date;
  updated_at: Date;
  submitted_by_id: string;
  submitted_by_username: string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_number: number | null;
  decided_by: string | null;
  decided_by_reviewer_number: number | null;
}

export function listAppealsForCase(db: DbExecutor, caseId: string): Promise<AppealViewRow[]> {
  return db
    .selectFrom('appeals as a')
    .innerJoin('users as su', 'su.id', 'a.submitted_by_user_id')
    .leftJoin('users as ar', 'ar.id', 'a.assigned_reviewer_id')
    .leftJoin('users as du', 'du.id', 'a.decided_by')
    .select([
      'a.id',
      'a.statement',
      'a.status',
      'a.decision',
      'a.decision_reason',
      'a.decided_at',
      'a.conflict_override',
      'a.created_at',
      'a.updated_at',
      'su.id as submitted_by_id',
      'su.username as submitted_by_username',
      'a.assigned_reviewer_id',
      'ar.reviewer_number as assigned_reviewer_number',
      'a.decided_by',
      'du.reviewer_number as decided_by_reviewer_number',
    ])
    .where('a.case_id', '=', caseId)
    .orderBy('a.created_at', 'asc')
    .execute();
}

/** Latest appeal status of the case (public view). */
export async function latestAppealStatus(db: DbExecutor, caseId: string): Promise<string | null> {
  const row = await db
    .selectFrom('appeals')
    .select('status')
    .where('case_id', '=', caseId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.status ?? null;
}

// ---------------------------------------------------------------------------
// Counts & checks
// ---------------------------------------------------------------------------

export interface CaseCounts {
  report_count: number;
  open_report_count: number;
  evidence_count: number;
  verified_evidence_count: number;
  confirmed_servers: number;
  independent_confirmed_servers: number;
}

export async function caseCounts(db: DbExecutor, caseId: string): Promise<CaseCounts> {
  const [reports, evidence, confirmations] = await Promise.all([
    db
      .selectFrom('reports')
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn
          .count<number>(sql`case when status = 'open' then 1 end`)
          .as('open'),
      ])
      .where('case_id', '=', caseId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('evidence')
      .select((eb) => [
        eb.fn.countAll<number>().as('total'),
        eb.fn
          .count<number>(sql`case when status = 'verified' and superseded_by_evidence_id is null then 1 end`)
          .as('verified'),
      ])
      .where('case_id', '=', caseId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('case_server_confirmations as cc')
      .innerJoin('servers as s', 's.id', 'cc.server_id')
      .select((eb) => [
        eb.fn.count<number>(sql`distinct cc.server_id`).as('servers'),
        eb.fn.count<number>(sql`distinct s.owner_user_id`).as('owners'),
      ])
      .where('cc.case_id', '=', caseId)
      .where('cc.revoked_at', 'is', null)
      .executeTakeFirstOrThrow(),
  ]);
  return {
    report_count: Number(reports.total),
    open_report_count: Number(reports.open),
    evidence_count: Number(evidence.total),
    verified_evidence_count: Number(evidence.verified),
    confirmed_servers: Number(confirmations.servers),
    independent_confirmed_servers: Number(confirmations.owners),
  };
}

/** §11.2: ≥ 1 non-superseded evidence with cheating and authenticity verified. */
export async function hasVerifiedCheatingEvidence(db: DbExecutor, caseId: string): Promise<boolean> {
  const row = await db
    .selectFrom('evidence')
    .select('id')
    .where('case_id', '=', caseId)
    .where('superseded_by_evidence_id', 'is', null)
    .where('cheating_status', '=', 'verified')
    .where('authenticity_status', '=', 'verified')
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Whether the user reported on the case (conflict of interest, §11.2). */
export async function isReporterOnCase(db: DbExecutor, caseId: string, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('reports')
    .select('id')
    .where('case_id', '=', caseId)
    .where('reporter_user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export function findActiveConfirmation(
  db: DbExecutor,
  caseId: string,
  serverUuid: string,
): Promise<{ id: string } | undefined> {
  return db
    .selectFrom('case_server_confirmations')
    .select('id')
    .where('case_id', '=', caseId)
    .where('server_id', '=', serverUuid)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Public timeline (read-only over audit_events)
// ---------------------------------------------------------------------------

export interface PublicTimelineRow {
  action: string;
  created_at: Date;
  reviewer_number: number | null;
}

type PublicTimelineAction =
  | 'REPORT_CREATED'
  | 'EVIDENCE_UPLOADED'
  | 'EVIDENCE_VERIFIED'
  | 'VERDICT_CHANGED'
  | 'APPEAL_CREATED'
  | 'APPEAL_RESOLVED';

const PUBLIC_TIMELINE_ACTIONS = [
  'REPORT_CREATED',
  'EVIDENCE_UPLOADED',
  'EVIDENCE_VERIFIED',
  'VERDICT_CHANGED',
  'APPEAL_CREATED',
  'APPEAL_RESOLVED',
] as const;

export async function publicTimeline(db: DbExecutor, caseId: string): Promise<PublicTimelineRow[]> {
  const events = await db
    .selectFrom('audit_events as a')
    .select(['a.action', 'a.created_at', 'a.actor_type', 'a.actor_id'])
    .where('a.case_id', '=', caseId)
    .where('a.action', 'in', PUBLIC_TIMELINE_ACTIONS as unknown as PublicTimelineAction[])
    .orderBy('a.seq', 'asc')
    .limit(200)
    .execute();
  const userIds = [...new Set(events.filter((e) => e.actor_type === 'user' && e.actor_id !== null).map((e) => e.actor_id as string))];
  const reviewerNumbers = new Map<string, number | null>();
  if (userIds.length > 0) {
    const users = await db.selectFrom('users').select(['id', 'reviewer_number']).where('id', 'in', userIds).execute();
    for (const u of users) reviewerNumbers.set(u.id, u.reviewer_number);
  }
  return events.map((e) => ({
    action: e.action,
    created_at: e.created_at,
    reviewer_number: e.actor_type === 'user' && e.actor_id !== null ? (reviewerNumbers.get(e.actor_id) ?? null) : null,
  }));
}
