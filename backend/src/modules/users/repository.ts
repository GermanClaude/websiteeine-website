/**
 * SQL for the users module: /me data, admin user listing and the player-link flow.
 */
import type { PlayerRef, UserRole, UserStatus } from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db/tx';
import type { PlayerRow, UserRow } from '../../db/types';

export function findUserById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

export function findPlayerById(db: DbExecutor, id: string): Promise<PlayerRow | undefined> {
  return db.selectFrom('players').selectAll().where('id', '=', id).executeTakeFirst();
}

export interface MembershipRow {
  server_id: string;
  name: string;
  role: 'owner' | 'admin' | 'moderator';
}

/** Server-team memberships of a user with the servers' public ids and names. */
export function listMemberships(db: DbExecutor, userId: string): Promise<MembershipRow[]> {
  return db
    .selectFrom('server_members as m')
    .innerJoin('servers as s', 's.id', 'm.server_id')
    .select(['s.server_id', 's.name', 'm.role'])
    .where('m.user_id', '=', userId)
    .orderBy('s.name', 'asc')
    .execute();
}

// ---------------------------------------------------------------------------
// Player link
// ---------------------------------------------------------------------------

/** Inserts or updates the player row for an in-game identity; returns the row. */
export function upsertPlayer(db: DbExecutor, ref: PlayerRef, now: Date): Promise<PlayerRow> {
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

/** The user (if any) already linked to this player. */
export function findUserByPlayerId(db: DbExecutor, playerId: string): Promise<UserRow | undefined> {
  return db.selectFrom('users').selectAll().where('player_id', '=', playerId).executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Admin user list
// ---------------------------------------------------------------------------

export interface AdminUserFilters {
  q?: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface AdminUserRow extends UserRow {
  player_id_type: PlayerRow['id_type'] | null;
  player_external_id: string | null;
  player_display_name: string | null;
}

export async function listAdminUsers(
  db: DbExecutor,
  filters: AdminUserFilters,
  page: { limit: number; offset: number },
): Promise<{ items: AdminUserRow[]; total: number }> {
  let base = db.selectFrom('users as u');
  if (filters.q !== undefined && filters.q !== '') {
    const pattern = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    base = base.where((eb) => eb.or([eb('u.email', 'ilike', pattern), eb('u.username', 'ilike', pattern)]));
  }
  if (filters.role !== undefined) base = base.where('u.role', '=', filters.role);
  if (filters.status !== undefined) base = base.where('u.status', '=', filters.status);

  const countRow = await base.select((eb) => eb.fn.countAll<string>().as('total')).executeTakeFirstOrThrow();
  const items = await base
    .leftJoin('players as p', 'p.id', 'u.player_id')
    .selectAll('u')
    .select(['p.id_type as player_id_type', 'p.external_id as player_external_id', 'p.display_name as player_display_name'])
    .orderBy('u.created_at', 'desc')
    .orderBy('u.id', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return { items: items as AdminUserRow[], total: Number(countRow.total) };
}

export async function getAdminUser(db: DbExecutor, id: string): Promise<AdminUserRow | undefined> {
  const row = await db
    .selectFrom('users as u')
    .leftJoin('players as p', 'p.id', 'u.player_id')
    .selectAll('u')
    .select(['p.id_type as player_id_type', 'p.external_id as player_external_id', 'p.display_name as player_display_name'])
    .where('u.id', '=', id)
    .executeTakeFirst();
  return row as AdminUserRow | undefined;
}

/** Number of *other* active super_admin accounts (last-super-admin guard). */
export async function countOtherActiveSuperAdmins(db: DbExecutor, excludeUserId: string): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where('role', '=', 'super_admin')
    .where('status', '=', 'active')
    .where('id', '!=', excludeUserId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}
