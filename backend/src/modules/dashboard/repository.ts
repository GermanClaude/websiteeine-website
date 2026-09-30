/**
 * Read-only SQL of the dashboard module (§13 "Dashboard"). Counts are scoped by the
 * caller; the service decides which of these queries to run.
 */
import { sql } from 'kysely';

import type { DbExecutor } from '../../db/tx';
import type { ActorType, AuditAction, ServerMemberRole, ServerStatus } from '../../db/enums';

async function toCount(row: { n: string | number | bigint } | undefined): Promise<number> {
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export async function countCasesByStatus(
  db: DbExecutor,
  status: 'open' | 'under_review',
  serverUuids?: string[],
): Promise<number> {
  if (serverUuids !== undefined && serverUuids.length === 0) return 0;
  let query = db
    .selectFrom('cases as c')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('c.status', '=', status);
  if (serverUuids !== undefined) {
    query = query.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('reports as r')
            .select('r.id')
            .whereRef('r.case_id', '=', 'c.id')
            .where('r.server_id', 'in', serverUuids),
        ),
        eb.exists(
          eb
            .selectFrom('case_server_confirmations as cc')
            .select('cc.id')
            .whereRef('cc.case_id', '=', 'c.id')
            .where('cc.server_id', 'in', serverUuids),
        ),
      ]),
    );
  }
  return toCount(await query.executeTakeFirst());
}

// ---------------------------------------------------------------------------
// Reports / appeals / evidence / whitelist requests
// ---------------------------------------------------------------------------

export async function countPendingReports(
  db: DbExecutor,
  scope: { all: true } | { serverUuids: string[] } | { reporterUserId: string },
): Promise<number> {
  let query = db
    .selectFrom('reports')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('status', 'in', ['open', 'under_review']);
  if ('serverUuids' in scope) {
    if (scope.serverUuids.length === 0) return 0;
    query = query.where('server_id', 'in', scope.serverUuids);
  } else if ('reporterUserId' in scope) {
    query = query.where('reporter_user_id', '=', scope.reporterUserId);
  }
  return toCount(await query.executeTakeFirst());
}

export async function countPendingAppeals(
  db: DbExecutor,
  scope: { all: true } | { submittedById: string },
): Promise<number> {
  let query = db
    .selectFrom('appeals')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('status', 'in', ['open', 'under_review']);
  if ('submittedById' in scope) query = query.where('submitted_by_user_id', '=', scope.submittedById);
  return toCount(await query.executeTakeFirst());
}

export async function countEvidenceAwaitingReview(db: DbExecutor): Promise<number> {
  return toCount(
    await db
      .selectFrom('evidence')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('status', '=', 'unverified')
      .where('superseded_by_evidence_id', 'is', null)
      .executeTakeFirst(),
  );
}

export async function countPendingWhitelistRequests(
  db: DbExecutor,
  scope: { all: true } | { serverUuids: string[] } | { requesterUserId: string },
): Promise<number> {
  let query = db
    .selectFrom('whitelist_requests')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('status', '=', 'pending');
  if ('serverUuids' in scope) {
    if (scope.serverUuids.length === 0) return 0;
    query = query.where('server_id', 'in', scope.serverUuids);
  } else if ('requesterUserId' in scope) {
    query = query.where('requester_user_id', '=', scope.requesterUserId);
  }
  return toCount(await query.executeTakeFirst());
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export interface DashboardServerRow {
  server_id: string;
  name: string;
  status: ServerStatus;
  is_trusted: boolean;
  plugin_version: string | null;
  last_seen_at: Date | null;
  key_fingerprint: string | null;
  member_role: ServerMemberRole | null;
}

export function listDashboardServers(
  db: DbExecutor,
  userId: string,
  scope: { all: boolean },
): Promise<DashboardServerRow[]> {
  let query = db
    .selectFrom('servers as s')
    .leftJoin('server_members as m', (join) => join.onRef('m.server_id', '=', 's.id').on('m.user_id', '=', userId))
    .select((eb) => [
      's.server_id',
      's.name',
      's.status',
      's.is_trusted',
      's.plugin_version',
      's.last_seen_at',
      'm.role as member_role',
      eb
        .selectFrom('server_keys as k')
        .select('k.fingerprint')
        .whereRef('k.server_id', '=', 's.id')
        .where('k.status', '=', 'active')
        .orderBy('k.activated_at', 'desc')
        .limit(1)
        .as('key_fingerprint'),
    ]);
  if (!scope.all) {
    query = query.where('m.user_id', 'is not', null);
  }
  return query.orderBy('s.name', 'asc').execute() as Promise<DashboardServerRow[]>;
}

// ---------------------------------------------------------------------------
// Recent audit events (member-server scope; global uses deps.audit.list)
// ---------------------------------------------------------------------------

export interface RecentAuditRow {
  seq: number;
  event_id: string;
  created_at: Date;
  action: AuditAction;
  actor_type: ActorType;
  actor_id: string | null;
  actor_username: string | null;
  target_type: string;
  target_id: string | null;
}

export function recentAuditEventsForServers(
  db: DbExecutor,
  serverUuids: string[],
  limit: number,
): Promise<RecentAuditRow[]> {
  if (serverUuids.length === 0) return Promise.resolve([]);
  return db
    .selectFrom('audit_events as a')
    .leftJoin('users as u', (join) =>
      join.on('a.actor_type', '=', 'user').on(sql`u.id::text`, '=', sql.ref('a.actor_id')),
    )
    .select([
      'a.seq',
      'a.event_id',
      'a.created_at',
      'a.action',
      'a.actor_type',
      'a.actor_id',
      'u.username as actor_username',
      'a.target_type',
      'a.target_id',
    ])
    .where('a.server_id', 'in', serverUuids)
    .orderBy('a.seq', 'desc')
    .limit(limit)
    .execute() as Promise<RecentAuditRow[]>;
}
