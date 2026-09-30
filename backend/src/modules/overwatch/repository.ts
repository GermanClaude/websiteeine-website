/**
 * Overwatch session queries (§4.7, §10). SQL only; business rules live in service.ts.
 */
import type { OverwatchSessionListQuery } from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db/tx';
import type { OverwatchSessionRow, OverwatchSessionUpdate } from '../../db/types';

export function findSessionById(db: DbExecutor, id: string): Promise<OverwatchSessionRow | undefined> {
  return db.selectFrom('overwatch_sessions').selectAll().where('id', '=', id).executeTakeFirst();
}

export function updateSession(db: DbExecutor, id: string, values: OverwatchSessionUpdate): Promise<unknown> {
  return db.updateTable('overwatch_sessions').set(values).where('id', '=', id).execute();
}

/** Sessions of a server/target/spectator that started at or before `at` (most recent first). */
export function findCandidateSessions(
  db: DbExecutor,
  filter: { serverUuid: string; targetPlayerId: string; spectatorPlayerId: string; at: Date; sessionId?: string },
): Promise<OverwatchSessionRow[]> {
  let q = db
    .selectFrom('overwatch_sessions')
    .selectAll()
    .where('server_id', '=', filter.serverUuid)
    .where('target_player_id', '=', filter.targetPlayerId)
    .where('spectator_player_id', '=', filter.spectatorPlayerId)
    .where('started_at', '<=', filter.at)
    .orderBy('started_at', 'desc')
    .limit(20);
  if (filter.sessionId !== undefined) q = q.where('id', '=', filter.sessionId);
  return q.execute();
}

export interface SessionViewRow extends OverwatchSessionRow {
  server_public_id: string;
  server_name: string;
  server_is_trusted: boolean;
  target_id_type: string;
  target_external_id: string;
  target_display_name: string | null;
  spectator_id_type: string;
  spectator_external_id: string;
  spectator_display_name: string | null;
}

const VIEW_COLUMNS = [
  'o.id',
  'o.server_id',
  'o.target_player_id',
  'o.spectator_player_id',
  'o.secret_enc',
  'o.interval_seconds',
  'o.status',
  'o.started_at',
  'o.ended_at',
  'o.last_heartbeat_at',
  'o.end_reason',
  'o.created_at',
  's.server_id as server_public_id',
  's.name as server_name',
  's.is_trusted as server_is_trusted',
  'tp.id_type as target_id_type',
  'tp.external_id as target_external_id',
  'tp.display_name as target_display_name',
  'sp.id_type as spectator_id_type',
  'sp.external_id as spectator_external_id',
  'sp.display_name as spectator_display_name',
] as const;

function viewQuery(db: DbExecutor) {
  return db
    .selectFrom('overwatch_sessions as o')
    .innerJoin('servers as s', 's.id', 'o.server_id')
    .innerJoin('players as tp', 'tp.id', 'o.target_player_id')
    .innerJoin('players as sp', 'sp.id', 'o.spectator_player_id')
    .select(VIEW_COLUMNS);
}

export async function getSessionViewById(db: DbExecutor, id: string): Promise<SessionViewRow | undefined> {
  return (await viewQuery(db).where('o.id', '=', id).executeTakeFirst()) as SessionViewRow | undefined;
}

export interface SessionListFilters {
  serverUuid?: string;
  targetPlayerId?: string;
  spectatorPlayerId?: string;
  status?: OverwatchSessionListQuery['status'];
  from?: Date;
  to?: Date;
}

export async function listSessionViews(
  db: DbExecutor,
  filters: SessionListFilters,
  page: { limit: number; offset: number },
): Promise<{ items: SessionViewRow[]; total: number }> {
  let base = db.selectFrom('overwatch_sessions as o');
  if (filters.serverUuid !== undefined) base = base.where('o.server_id', '=', filters.serverUuid);
  if (filters.targetPlayerId !== undefined) base = base.where('o.target_player_id', '=', filters.targetPlayerId);
  if (filters.spectatorPlayerId !== undefined) base = base.where('o.spectator_player_id', '=', filters.spectatorPlayerId);
  if (filters.status !== undefined) base = base.where('o.status', '=', filters.status);
  if (filters.from !== undefined) base = base.where('o.started_at', '>=', filters.from);
  if (filters.to !== undefined) base = base.where('o.started_at', '<=', filters.to);

  const countRow = await base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirst();
  const items = (await base
    .innerJoin('servers as s', 's.id', 'o.server_id')
    .innerJoin('players as tp', 'tp.id', 'o.target_player_id')
    .innerJoin('players as sp', 'sp.id', 'o.spectator_player_id')
    .select(VIEW_COLUMNS)
    .orderBy('o.started_at', 'desc')
    .orderBy('o.id', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute()) as SessionViewRow[];
  return { items, total: Number(countRow?.total ?? 0) };
}

/** Active sessions whose last heartbeat is older than `cutoff` → expired (job). */
export async function expireStaleSessions(db: DbExecutor, cutoff: Date): Promise<string[]> {
  const rows = await db
    .updateTable('overwatch_sessions')
    .set({ status: 'expired', end_reason: 'heartbeat_timeout' })
    .where('status', '=', 'active')
    .where('last_heartbeat_at', '<', cutoff)
    .returning('id')
    .execute();
  return rows.map((r) => r.id);
}

/** Wipes encrypted secrets of sessions started before `cutoff` (row kept, R7-compatible). */
export async function wipeExpiredSecrets(db: DbExecutor, cutoff: Date): Promise<number> {
  const rows = await db
    .updateTable('overwatch_sessions')
    .set({ secret_enc: null })
    .where('secret_enc', 'is not', null)
    .where('started_at', '<', cutoff)
    .returning('id')
    .execute();
  return rows.length;
}
