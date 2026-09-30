/**
 * SQL for servers, members, registration tokens and keys (§4.2).
 */
import type { ExpressionBuilder } from 'kysely';

import type { ServerListQuery, ServerMemberRole, ServerStatus } from '@scpsl-trust/shared';

import type {
  Database,
  DbExecutor,
  NewServer,
  NewServerKey,
  NewServerMember,
  NewServerRegistrationToken,
  ServerKeyRow,
  ServerMemberRow,
  ServerRegistrationTokenRow,
  ServerRow,
  ServerUpdate,
} from '../../db';

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export async function findServerByPublicId(db: DbExecutor, publicId: string): Promise<ServerRow | undefined> {
  return db.selectFrom('servers').selectAll().where('server_id', '=', publicId).executeTakeFirst();
}

export async function findServerById(db: DbExecutor, id: string): Promise<ServerRow | undefined> {
  return db.selectFrom('servers').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function insertServer(db: DbExecutor, values: NewServer): Promise<ServerRow> {
  return db.insertInto('servers').values(values).returningAll().executeTakeFirstOrThrow();
}

export async function updateServer(db: DbExecutor, id: string, values: ServerUpdate): Promise<ServerRow> {
  return db.updateTable('servers').set(values).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
}

function activeKeyFingerprint(eb: ExpressionBuilder<Database, 'servers'>) {
  return eb
    .selectFrom('server_keys')
    .select('server_keys.fingerprint')
    .whereRef('server_keys.server_id', '=', 'servers.id')
    .where('server_keys.status', '=', 'active')
    .limit(1)
    .as('key_fingerprint');
}

function activePolicyVersion(eb: ExpressionBuilder<Database, 'servers'>) {
  return eb
    .selectFrom('server_policies')
    .select('server_policies.version')
    .whereRef('server_policies.server_id', '=', 'servers.id')
    .where('server_policies.is_active', '=', true)
    .limit(1)
    .as('policy_version');
}

export interface ServerViewRow extends ServerRow {
  key_fingerprint: string | null;
  policy_version: number | null;
  owner_username: string;
}

/** Everything the web ServerView needs for one server. */
export async function findServerViewRow(db: DbExecutor, serverUuid: string): Promise<ServerViewRow | undefined> {
  return db
    .selectFrom('servers')
    .innerJoin('users', 'users.id', 'servers.owner_user_id')
    .selectAll('servers')
    .select('users.username as owner_username')
    .select((eb) => [activeKeyFingerprint(eb), activePolicyVersion(eb)])
    .where('servers.id', '=', serverUuid)
    .executeTakeFirst();
}

export interface ServerSummaryRow {
  server_id: string;
  name: string;
  status: ServerStatus;
  is_trusted: boolean;
  plugin_version: string | null;
  last_seen_at: Date | null;
  key_fingerprint: string | null;
  member_role: ServerMemberRole | null;
}

export interface ListServersOptions {
  userId: string;
  /** true = every server (server:manage_any); false = only the user's memberships. */
  all: boolean;
  query: Pick<ServerListQuery, 'q' | 'status'>;
  limit: number;
  offset: number;
}

export async function listServers(
  db: DbExecutor,
  { userId, all, query, limit, offset }: ListServersOptions,
): Promise<{ rows: ServerSummaryRow[]; total: number }> {
  let filtered = db
    .selectFrom('servers')
    .leftJoin('server_members', (join) =>
      join.onRef('server_members.server_id', '=', 'servers.id').on('server_members.user_id', '=', userId),
    );
  if (!all) filtered = filtered.where('server_members.user_id', 'is not', null);
  if (query.status !== undefined) filtered = filtered.where('servers.status', '=', query.status);
  if (query.q !== undefined && query.q !== '') {
    const pattern = `%${query.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    filtered = filtered.where((eb) =>
      eb.or([eb('servers.name', 'ilike', pattern), eb('servers.server_id', 'ilike', pattern)]),
    );
  }

  const [rows, count] = await Promise.all([
    filtered
      .select([
        'servers.server_id',
        'servers.name',
        'servers.status',
        'servers.is_trusted',
        'servers.plugin_version',
        'servers.last_seen_at',
        'server_members.role as member_role',
      ])
      .select((eb) => [activeKeyFingerprint(eb as unknown as ExpressionBuilder<Database, 'servers'>)])
      .orderBy('servers.name', 'asc')
      .orderBy('servers.server_id', 'asc')
      .limit(limit)
      .offset(offset)
      .execute(),
    filtered.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
  ]);
  return { rows: rows as ServerSummaryRow[], total: Number(count.total) };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberWithUser extends ServerMemberRow {
  username: string;
  created_by_username: string | null;
}

export async function listMembers(db: DbExecutor, serverUuid: string): Promise<MemberWithUser[]> {
  return db
    .selectFrom('server_members')
    .innerJoin('users', 'users.id', 'server_members.user_id')
    .leftJoin('users as creators', 'creators.id', 'server_members.created_by')
    .selectAll('server_members')
    .select(['users.username as username', 'creators.username as created_by_username'])
    .where('server_members.server_id', '=', serverUuid)
    .orderBy('server_members.created_at', 'asc')
    .execute();
}

export async function findMember(
  db: DbExecutor,
  serverUuid: string,
  userId: string,
): Promise<ServerMemberRow | undefined> {
  return db
    .selectFrom('server_members')
    .selectAll()
    .where('server_id', '=', serverUuid)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export async function insertMember(db: DbExecutor, values: NewServerMember): Promise<ServerMemberRow> {
  return db.insertInto('server_members').values(values).returningAll().executeTakeFirstOrThrow();
}

export async function deleteMember(db: DbExecutor, serverUuid: string, userId: string): Promise<boolean> {
  const result = await db
    .deleteFrom('server_members')
    .where('server_id', '=', serverUuid)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return result.numDeletedRows > 0n;
}

export async function findUserByUsername(
  db: DbExecutor,
  username: string,
): Promise<{ id: string; username: string } | undefined> {
  return db
    .selectFrom('users')
    .select(['id', 'username'])
    .where((eb) => eb(eb.fn('lower', ['username']), '=', username.toLowerCase()))
    .executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Registration tokens
// ---------------------------------------------------------------------------

export async function findTokenByHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<ServerRegistrationTokenRow | undefined> {
  return db.selectFrom('server_registration_tokens').selectAll().where('token_hash', '=', tokenHash).executeTakeFirst();
}

export async function insertRegistrationToken(
  db: DbExecutor,
  values: NewServerRegistrationToken,
): Promise<ServerRegistrationTokenRow> {
  return db.insertInto('server_registration_tokens').values(values).returningAll().executeTakeFirstOrThrow();
}

/** Revokes every unused, unrevoked token of the server. Returns the number revoked. */
export async function revokeUnusedTokens(db: DbExecutor, serverUuid: string, now: Date): Promise<number> {
  const result = await db
    .updateTable('server_registration_tokens')
    .set({ revoked_at: now })
    .where('server_id', '=', serverUuid)
    .where('used_at', 'is', null)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

export async function markTokenUsed(db: DbExecutor, tokenId: string, now: Date): Promise<void> {
  await db.updateTable('server_registration_tokens').set({ used_at: now }).where('id', '=', tokenId).execute();
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export async function listKeys(db: DbExecutor, serverUuid: string): Promise<ServerKeyRow[]> {
  return db
    .selectFrom('server_keys')
    .selectAll()
    .where('server_id', '=', serverUuid)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
}

export async function findKey(db: DbExecutor, keyId: string): Promise<ServerKeyRow | undefined> {
  return db.selectFrom('server_keys').selectAll().where('id', '=', keyId).executeTakeFirst();
}

export async function findKeyByFingerprint(db: DbExecutor, fingerprint: string): Promise<ServerKeyRow | undefined> {
  return db.selectFrom('server_keys').selectAll().where('fingerprint', '=', fingerprint).executeTakeFirst();
}

export async function findActiveKey(db: DbExecutor, serverUuid: string): Promise<ServerKeyRow | undefined> {
  return db
    .selectFrom('server_keys')
    .selectAll()
    .where('server_id', '=', serverUuid)
    .where('status', '=', 'active')
    .executeTakeFirst();
}

export async function insertKey(db: DbExecutor, values: NewServerKey): Promise<ServerKeyRow> {
  return db.insertInto('server_keys').values(values).returningAll().executeTakeFirstOrThrow();
}

export async function markKeyRetiring(db: DbExecutor, keyId: string, retiringUntil: Date): Promise<void> {
  await db
    .updateTable('server_keys')
    .set({ status: 'retiring', retiring_until: retiringUntil })
    .where('id', '=', keyId)
    .execute();
}

export async function revokeKey(
  db: DbExecutor,
  keyId: string,
  { now, revokedBy, reason }: { now: Date; revokedBy: string | null; reason: string | null },
): Promise<ServerKeyRow> {
  return db
    .updateTable('server_keys')
    .set({ status: 'revoked', revoked_at: now, revoked_by: revokedBy, revoke_reason: reason })
    .where('id', '=', keyId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Revokes every active/retiring key of the server (server revocation). */
export async function revokeUsableKeys(
  db: DbExecutor,
  serverUuid: string,
  { now, revokedBy, reason }: { now: Date; revokedBy: string | null; reason: string | null },
): Promise<number> {
  const result = await db
    .updateTable('server_keys')
    .set({ status: 'revoked', revoked_at: now, revoked_by: revokedBy, revoke_reason: reason })
    .where('server_id', '=', serverUuid)
    .where('status', 'in', ['active', 'retiring'])
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/** Moves expired retiring keys to `retired`. Returns how many were retired. */
export async function retireExpiredKeys(db: DbExecutor, now: Date): Promise<number> {
  const result = await db
    .updateTable('server_keys')
    .set({ status: 'retired', retired_at: now })
    .where('status', '=', 'retiring')
    .where('retiring_until', '<', now)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
