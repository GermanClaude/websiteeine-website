/**
 * SQL of the whitelist module (§4.8, §11.6).
 */
import type { DbExecutor } from '../../db/tx';
import type { NewWhitelistRequest, WhitelistRequestRow } from '../../db/types';
import type { PlayerIdType, WhitelistRequestStatus, WhitelistRequestType } from '../../db/enums';

// ---------------------------------------------------------------------------
// Joined view rows
// ---------------------------------------------------------------------------

export interface WhitelistRequestViewRow {
  id: string;
  type: WhitelistRequestType;
  reason: string;
  requested_days: number | null;
  status: WhitelistRequestStatus;
  decision_note: string | null;
  bypass_id: string | null;
  decided_at: Date | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
  player_id_type: PlayerIdType;
  player_external_id: string;
  player_display_name: string | null;
  requester_id: string;
  requester_username: string;
  server_public_id: string;
  server_name: string;
  server_is_trusted: boolean;
  decided_by_id: string | null;
  decided_by_username: string | null;
  bypass_expires_at: Date | null;
}

function requestViewQuery(db: DbExecutor) {
  return db
    .selectFrom('whitelist_requests as w')
    .innerJoin('players as p', 'p.id', 'w.player_id')
    .innerJoin('users as rq', 'rq.id', 'w.requester_user_id')
    .innerJoin('servers as s', 's.id', 'w.server_id')
    .leftJoin('users as dc', 'dc.id', 'w.decided_by')
    .leftJoin('bypasses as b', 'b.id', 'w.bypass_id')
    .select([
      'w.id',
      'w.type',
      'w.reason',
      'w.requested_days',
      'w.status',
      'w.decision_note',
      'w.bypass_id',
      'w.decided_at',
      'w.expires_at',
      'w.created_at',
      'w.updated_at',
      'p.id_type as player_id_type',
      'p.external_id as player_external_id',
      'p.display_name as player_display_name',
      'rq.id as requester_id',
      'rq.username as requester_username',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'dc.id as decided_by_id',
      'dc.username as decided_by_username',
      'b.expires_at as bypass_expires_at',
    ]);
}

export function findRequestViewById(db: DbExecutor, id: string): Promise<WhitelistRequestViewRow | undefined> {
  return requestViewQuery(db).where('w.id', '=', id).executeTakeFirst() as Promise<
    WhitelistRequestViewRow | undefined
  >;
}

export function findRequestById(db: DbExecutor, id: string): Promise<WhitelistRequestRow | undefined> {
  return db.selectFrom('whitelist_requests').selectAll().where('id', '=', id).executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Listing (scope: own requests / member servers / all)
// ---------------------------------------------------------------------------

export interface WhitelistListScope {
  /** Requests submitted by this user are always visible. */
  requesterUserId?: string;
  /** Requests of these servers are visible (member scope). */
  serverUuids?: string[];
  /** Everything (whitelist:decide_any). */
  all?: boolean;
}

export interface WhitelistListFilters {
  status?: WhitelistRequestStatus;
  type?: WhitelistRequestType;
  serverUuid?: string;
}

export async function listRequests(
  db: DbExecutor,
  scope: WhitelistListScope,
  filters: WhitelistListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: WhitelistRequestViewRow[]; total: number }> {
  let base = db.selectFrom('whitelist_requests as w');
  if (scope.all !== true) {
    const requester = scope.requesterUserId;
    const servers = scope.serverUuids ?? [];
    base = base.where((eb) => {
      const conditions = [];
      if (requester !== undefined) conditions.push(eb('w.requester_user_id', '=', requester));
      if (servers.length > 0) conditions.push(eb('w.server_id', 'in', servers));
      if (conditions.length === 0) return eb.val(false);
      return eb.or(conditions);
    });
  }
  if (filters.status !== undefined) base = base.where('w.status', '=', filters.status);
  if (filters.type !== undefined) base = base.where('w.type', '=', filters.type);
  if (filters.serverUuid !== undefined) base = base.where('w.server_id', '=', filters.serverUuid);

  const [rows, count] = await Promise.all([
    base
      .select('w.id')
      .orderBy('w.created_at', 'desc')
      .orderBy('w.id', 'desc')
      .limit(page.limit)
      .offset(page.offset)
      .execute(),
    base.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirst(),
  ]);
  if (rows.length === 0) return { items: [], total: Number(count?.total ?? 0) };
  const items = (await requestViewQuery(db)
    .where(
      'w.id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('w.created_at', 'desc')
    .orderBy('w.id', 'desc')
    .execute()) as WhitelistRequestViewRow[];
  return { items, total: Number(count?.total ?? 0) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function insertRequest(db: DbExecutor, values: NewWhitelistRequest): Promise<WhitelistRequestRow> {
  return db.insertInto('whitelist_requests').values(values).returningAll().executeTakeFirstOrThrow();
}

export function findPendingDuplicate(
  db: DbExecutor,
  playerId: string,
  serverUuid: string,
  type: WhitelistRequestType,
): Promise<{ id: string } | undefined> {
  return db
    .selectFrom('whitelist_requests')
    .select('id')
    .where('player_id', '=', playerId)
    .where('server_id', '=', serverUuid)
    .where('type', '=', type)
    .where('status', '=', 'pending')
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Expiry job
// ---------------------------------------------------------------------------

export function selectExpiredPending(db: DbExecutor, now: Date, limit: number): Promise<WhitelistRequestRow[]> {
  return db
    .selectFrom('whitelist_requests')
    .selectAll()
    .where('status', '=', 'pending')
    .where('expires_at', '<=', now)
    .orderBy('expires_at', 'asc')
    .limit(limit)
    .execute();
}

/** pending → expired; returns false when a concurrent run already did it. */
export async function markRequestExpired(db: DbExecutor, id: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('whitelist_requests')
    .set({ status: 'expired', updated_at: now })
    .where('id', '=', id)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0) > 0;
}
