/**
 * SQL of the appeals module (§4.8, §11.5).
 */
import type { DbExecutor } from '../../db/tx';
import type { AppealRow, NewAppeal } from '../../db/types';
import type { AppealDecision, AppealStatus, PlayerIdType } from '../../db/enums';

export interface AppealViewRow {
  id: string;
  case_number: string;
  statement: string;
  status: AppealStatus;
  decision: AppealDecision | null;
  decision_reason: string | null;
  decided_at: Date | null;
  conflict_override: boolean;
  created_at: Date;
  updated_at: Date;
  player_id_type: PlayerIdType;
  player_external_id: string;
  player_display_name: string | null;
  submitted_by_id: string;
  submitted_by_username: string;
  assigned_reviewer_id: string | null;
  assigned_reviewer_number: number | null;
  decided_by_id: string | null;
  decided_by_reviewer_number: number | null;
}

function appealViewQuery(db: DbExecutor) {
  return db
    .selectFrom('appeals as a')
    .innerJoin('cases as c', 'c.id', 'a.case_id')
    .innerJoin('players as p', 'p.id', 'a.player_id')
    .innerJoin('users as sb', 'sb.id', 'a.submitted_by_user_id')
    .leftJoin('users as ar', 'ar.id', 'a.assigned_reviewer_id')
    .leftJoin('users as dc', 'dc.id', 'a.decided_by')
    .select([
      'a.id',
      'c.case_number',
      'a.statement',
      'a.status',
      'a.decision',
      'a.decision_reason',
      'a.decided_at',
      'a.conflict_override',
      'a.created_at',
      'a.updated_at',
      'p.id_type as player_id_type',
      'p.external_id as player_external_id',
      'p.display_name as player_display_name',
      'sb.id as submitted_by_id',
      'sb.username as submitted_by_username',
      'ar.id as assigned_reviewer_id',
      'ar.reviewer_number as assigned_reviewer_number',
      'dc.id as decided_by_id',
      'dc.reviewer_number as decided_by_reviewer_number',
    ]);
}

export function findAppealViewById(db: DbExecutor, id: string): Promise<AppealViewRow | undefined> {
  return appealViewQuery(db).where('a.id', '=', id).executeTakeFirst() as Promise<AppealViewRow | undefined>;
}

export function findAppealById(db: DbExecutor, id: string): Promise<AppealRow | undefined> {
  return db.selectFrom('appeals').selectAll().where('id', '=', id).executeTakeFirst();
}

export function insertAppeal(db: DbExecutor, values: NewAppeal): Promise<AppealRow> {
  return db.insertInto('appeals').values(values).returningAll().executeTakeFirstOrThrow();
}

export function findOpenAppealForCase(db: DbExecutor, caseId: string): Promise<{ id: string } | undefined> {
  return db
    .selectFrom('appeals')
    .select('id')
    .where('case_id', '=', caseId)
    .where('status', 'in', ['open', 'under_review'])
    .executeTakeFirst();
}

export interface AppealListFilters {
  status?: AppealStatus;
  caseId?: string;
  assignedReviewerId?: string;
  /** Restrict to the caller's own appeals (non-deciders). */
  submittedById?: string;
}

export async function listAppeals(
  db: DbExecutor,
  filters: AppealListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: AppealViewRow[]; total: number }> {
  let base = db.selectFrom('appeals as a');
  if (filters.status !== undefined) base = base.where('a.status', '=', filters.status);
  if (filters.caseId !== undefined) base = base.where('a.case_id', '=', filters.caseId);
  if (filters.assignedReviewerId !== undefined) base = base.where('a.assigned_reviewer_id', '=', filters.assignedReviewerId);
  if (filters.submittedById !== undefined) base = base.where('a.submitted_by_user_id', '=', filters.submittedById);

  const [rows, count] = await Promise.all([
    base
      .select('a.id')
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(page.limit)
      .offset(page.offset)
      .execute(),
    base.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirst(),
  ]);
  if (rows.length === 0) return { items: [], total: Number(count?.total ?? 0) };
  const items = (await appealViewQuery(db)
    .where(
      'a.id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc')
    .execute()) as AppealViewRow[];
  return { items, total: Number(count?.total ?? 0) };
}
