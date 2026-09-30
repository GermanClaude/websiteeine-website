/**
 * Evidence queries (§4.6). SQL only; permissions and state rules live in service.ts.
 * Reuses the cases module's read-only EvidenceViewRow shape for consistent views.
 */
import type { EvidenceListQuery } from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db/tx';
import type { EvidenceReviewRow, EvidenceRow } from '../../db/types';
import type { EvidenceViewRow } from '../cases/views';

export function findEvidenceById(db: DbExecutor, id: string): Promise<EvidenceRow | undefined> {
  return db.selectFrom('evidence').selectAll().where('id', '=', id).executeTakeFirst();
}

export interface EvidenceDetailRow extends EvidenceViewRow {
  case_id: string;
  case_number: string;
  storage_key: string | null;
  uploader_server_id: string | null;
}

const VIEW_COLUMNS = [
  'e.id',
  'e.case_id',
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
  'e.storage_key',
  'e.external_url',
  'e.overwatch_session_id',
  'e.supersedes_evidence_id',
  'e.superseded_by_evidence_id',
  'e.uploaded_at',
  'e.created_at',
  'e.updated_at',
  'e.uploader_user_id',
  'e.uploader_server_id',
  'c.case_number',
  'uu.username as uploader_username',
  'us.server_id as uploader_server_public_id',
  'us.name as uploader_server_name',
  'us.is_trusted as uploader_server_is_trusted',
] as const;

function viewQuery(db: DbExecutor) {
  return db
    .selectFrom('evidence as e')
    .innerJoin('cases as c', 'c.id', 'e.case_id')
    .leftJoin('users as uu', 'uu.id', 'e.uploader_user_id')
    .leftJoin('servers as us', 'us.id', 'e.uploader_server_id')
    .select(VIEW_COLUMNS);
}

export async function getEvidenceDetailRow(db: DbExecutor, id: string): Promise<EvidenceDetailRow | undefined> {
  return (await viewQuery(db).where('e.id', '=', id).executeTakeFirst()) as EvidenceDetailRow | undefined;
}

export interface EvidenceListFilters {
  status?: EvidenceListQuery['status'];
  type?: EvidenceListQuery['type'];
  caseId?: string;
}

export async function listEvidenceViews(
  db: DbExecutor,
  filters: EvidenceListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: EvidenceDetailRow[]; total: number }> {
  let base = db.selectFrom('evidence as e');
  if (filters.status !== undefined) base = base.where('e.status', '=', filters.status);
  if (filters.type !== undefined) base = base.where('e.type', '=', filters.type);
  if (filters.caseId !== undefined) base = base.where('e.case_id', '=', filters.caseId);

  const countRow = await base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirst();
  const items = (await base
    .innerJoin('cases as c', 'c.id', 'e.case_id')
    .leftJoin('users as uu', 'uu.id', 'e.uploader_user_id')
    .leftJoin('servers as us', 'us.id', 'e.uploader_server_id')
    .select(VIEW_COLUMNS)
    .orderBy('e.created_at', 'desc')
    .orderBy('e.id', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute()) as EvidenceDetailRow[];
  return { items, total: Number(countRow?.total ?? 0) };
}

export interface ReviewViewRow extends EvidenceReviewRow {
  reviewer_number: number | null;
}

export function listReviewsForEvidence(db: DbExecutor, evidenceId: string): Promise<ReviewViewRow[]> {
  return db
    .selectFrom('evidence_reviews as r')
    .innerJoin('users as u', 'u.id', 'r.reviewer_user_id')
    .selectAll('r')
    .select('u.reviewer_number as reviewer_number')
    .where('r.evidence_id', '=', evidenceId)
    .orderBy('r.created_at', 'desc')
    .orderBy('r.id', 'desc')
    .execute() as Promise<ReviewViewRow[]>;
}

/** Did this user report on the case (web reports)? */
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

/**
 * Is the user an owner/admin/moderator member of a server that reported on the case
 * (§11.3 upload rule)?
 */
export async function isMemberOfReportingServer(db: DbExecutor, caseId: string, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('reports as r')
    .innerJoin('server_members as m', 'm.server_id', 'r.server_id')
    .select('r.id')
    .where('r.case_id', '=', caseId)
    .where('m.user_id', '=', userId)
    .where('m.role', 'in', ['owner', 'admin', 'moderator'])
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

/** Is the user a member (any role) of the given server (§11.3 access rule)? */
export async function isMemberOfServer(db: DbExecutor, serverUuid: string, userId: string): Promise<boolean> {
  const row = await db
    .selectFrom('server_members')
    .select('user_id')
    .where('server_id', '=', serverUuid)
    .where('user_id', '=', userId)
    .limit(1)
    .executeTakeFirst();
  return row !== undefined;
}

export function findReportOnCase(db: DbExecutor, caseId: string, reportId: string): Promise<{ id: string } | undefined> {
  return db
    .selectFrom('reports')
    .select('id')
    .where('id', '=', reportId)
    .where('case_id', '=', caseId)
    .executeTakeFirst();
}

export function findOverwatchSession(db: DbExecutor, id: string): Promise<{ id: string } | undefined> {
  return db.selectFrom('overwatch_sessions').select('id').where('id', '=', id).executeTakeFirst();
}
