/**
 * SQL of the bypasses module (§4.8). Bypass rows are append-mostly: revocation and
 * expiry processing are the only allowed updates.
 */
import { sql } from 'kysely';

import type { DbExecutor } from '../../db/tx';
import type { BypassRow, NewBypass } from '../../db/types';
import type { BypassScope, BypassType, PlayerIdType, ServerMemberRole } from '../../db/enums';

// ---------------------------------------------------------------------------
// View rows (joined)
// ---------------------------------------------------------------------------

export interface BypassViewRow {
  id: string;
  scope: BypassScope;
  type: BypassType;
  reason: string;
  whitelist_request_id: string | null;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
  player_id_type: PlayerIdType;
  player_external_id: string;
  player_display_name: string | null;
  server_public_id: string | null;
  server_name: string | null;
  server_is_trusted: boolean | null;
  granted_by_id: string;
  granted_by_username: string;
  revoked_by_id: string | null;
  revoked_by_username: string | null;
}

function bypassViewQuery(db: DbExecutor) {
  return db
    .selectFrom('bypasses as b')
    .innerJoin('players as p', 'p.id', 'b.player_id')
    .leftJoin('servers as s', 's.id', 'b.server_id')
    .innerJoin('users as g', 'g.id', 'b.granted_by_user_id')
    .leftJoin('users as rv', 'rv.id', 'b.revoked_by')
    .select([
      'b.id',
      'b.scope',
      'b.type',
      'b.reason',
      'b.whitelist_request_id',
      'b.created_at',
      'b.expires_at',
      'b.revoked_at',
      'b.revoke_reason',
      'p.id_type as player_id_type',
      'p.external_id as player_external_id',
      'p.display_name as player_display_name',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'g.id as granted_by_id',
      'g.username as granted_by_username',
      'rv.id as revoked_by_id',
      'rv.username as revoked_by_username',
    ]);
}

export function findBypassViewById(db: DbExecutor, id: string): Promise<BypassViewRow | undefined> {
  return bypassViewQuery(db).where('b.id', '=', id).executeTakeFirst() as Promise<BypassViewRow | undefined>;
}

export function findBypassById(db: DbExecutor, id: string): Promise<BypassRow | undefined> {
  return db.selectFrom('bypasses').selectAll().where('id', '=', id).executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface BypassListFilters {
  scope?: BypassScope;
  serverUuid?: string;
  active?: boolean;
  type?: BypassType;
  playerId?: string;
}

export async function listBypasses(
  db: DbExecutor,
  filters: BypassListFilters,
  now: Date,
  page: { limit: number; offset: number },
): Promise<{ items: BypassViewRow[]; total: number }> {
  let base = db.selectFrom('bypasses as b');
  if (filters.scope !== undefined) base = base.where('b.scope', '=', filters.scope);
  if (filters.serverUuid !== undefined) base = base.where('b.server_id', '=', filters.serverUuid);
  if (filters.type !== undefined) base = base.where('b.type', '=', filters.type);
  if (filters.playerId !== undefined) base = base.where('b.player_id', '=', filters.playerId);
  if (filters.active === true) {
    base = base
      .where('b.revoked_at', 'is', null)
      .where((eb) => eb.or([eb('b.expires_at', 'is', null), eb('b.expires_at', '>', now)]));
  } else if (filters.active === false) {
    base = base.where((eb) =>
      eb.or([eb('b.revoked_at', 'is not', null), eb.and([eb('b.expires_at', 'is not', null), eb('b.expires_at', '<=', now)])]),
    );
  }

  const idsQuery = base.select('b.id').orderBy('b.created_at', 'desc').orderBy('b.id', 'desc');
  const [rows, count] = await Promise.all([
    idsQuery.limit(page.limit).offset(page.offset).execute(),
    base.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirst(),
  ]);
  if (rows.length === 0) return { items: [], total: Number(count?.total ?? 0) };
  const views = (await bypassViewQuery(db)
    .where(
      'b.id',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('b.created_at', 'desc')
    .orderBy('b.id', 'desc')
    .execute()) as BypassViewRow[];
  return { items: views, total: Number(count?.total ?? 0) };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function insertBypass(db: DbExecutor, values: NewBypass): Promise<BypassRow> {
  return db.insertInto('bypasses').values(values).returningAll().executeTakeFirstOrThrow();
}

export function markRevoked(
  db: DbExecutor,
  id: string,
  by: string,
  reason: string,
  now: Date,
): Promise<BypassRow> {
  return db
    .updateTable('bypasses')
    .set({ revoked_at: now, revoked_by: by, revoke_reason: reason })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

// ---------------------------------------------------------------------------
// Active-bypass lookup (used by the players module contract)
// ---------------------------------------------------------------------------

export interface ActiveBypass {
  id: string;
  type: BypassType;
  scope: BypassScope;
  expires_at: Date | null;
}

export function selectActiveBypasses(
  db: DbExecutor,
  playerId: string,
  serverUuid: string,
  honorGlobal: boolean,
  now: Date,
): Promise<ActiveBypass[]> {
  return db
    .selectFrom('bypasses')
    .select(['id', 'type', 'scope', 'expires_at'])
    .where('player_id', '=', playerId)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .where((eb) => {
      const server = eb.and([eb('scope', '=', 'server' as const), eb('server_id', '=', serverUuid)]);
      return honorGlobal ? eb.or([server, eb('scope', '=', 'global' as const)]) : server;
    })
    .orderBy('created_at', 'asc')
    .execute();
}

// ---------------------------------------------------------------------------
// Expiry job
// ---------------------------------------------------------------------------

/** Expired, unrevoked, not yet processed bypasses — oldest first, batch-limited. */
export function selectExpiredUnprocessed(db: DbExecutor, now: Date, limit: number): Promise<BypassRow[]> {
  return db
    .selectFrom('bypasses')
    .selectAll()
    .where('expired_processed_at', 'is', null)
    .where('revoked_at', 'is', null)
    .where('expires_at', 'is not', null)
    .where('expires_at', '<=', now)
    .orderBy('expires_at', 'asc')
    .limit(limit)
    .execute();
}

export async function markExpiredProcessed(db: DbExecutor, id: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('bypasses')
    .set({ expired_processed_at: now })
    .where('id', '=', id)
    .where('expired_processed_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0) > 0;
}

/** Approved whitelist request backing this bypass → status 'expired' (idempotent). */
export async function expireApprovedRequestForBypass(db: DbExecutor, bypassId: string, now: Date): Promise<string | null> {
  const row = await db
    .updateTable('whitelist_requests')
    .set({ status: 'expired', updated_at: now })
    .where('bypass_id', '=', bypassId)
    .where('status', '=', 'approved')
    .returning('id')
    .executeTakeFirst();
  return row?.id ?? null;
}

/** True when the given player/servers pair exists; small helper for tests. */
export async function countActiveForPlayer(db: DbExecutor, playerId: string, now: Date): Promise<number> {
  const row = await db
    .selectFrom('bypasses')
    .select(sql<number>`count(*)`.as('n'))
    .where('player_id', '=', playerId)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}
