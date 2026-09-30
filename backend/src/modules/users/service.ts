/**
 * Users module business logic: /me, player linking (§6.6) and admin user management
 * (§12.3, §13 "Admin").
 */
import type { FastifyRequest } from 'fastify';

import {
  canAssignRole,
  canManageUser,
  permissionsForRole,
  roleRank,
  toUserId,
  UserRole,
  type AdminUser,
  type MeResponse,
  type Permission,
  type PlayerRef,
  type PlayerSummary,
  type UserStatus,
} from '@scpsl-trust/shared';

import type { AuthenticatedServer, AuthenticatedSession, AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { nextReviewerNumber } from '../../db/sequences';
import { withTransaction } from '../../db/tx';
import type { PlayerRow, UserRow } from '../../db/types';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors';
import { generateLinkCode } from '../../lib/ids';
import { addMilliseconds } from '../../lib/time';
import { auditContext } from '../audit/actor';
import { storeKeys } from '../../redis/keys';
import * as repo from './repository';
import type { AdminUserRow } from './repository';

export const LINK_CODE_TTL_MS = 10 * 60_000;

const REVIEWER_RANK = roleRank(UserRole.REVIEWER);

function toPlayerSummary(player: Pick<PlayerRow, 'id_type' | 'external_id' | 'display_name'>): PlayerSummary {
  return {
    user_id: toUserId({ type: player.id_type, id: player.external_id }),
    type: player.id_type,
    id: player.external_id,
    display_name: player.display_name,
  };
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    email_verified_at: row.email_verified_at?.toISOString() ?? null,
    mfa_enabled: row.totp_enabled_at !== null,
    reviewer_number: row.reviewer_number,
    locked_until: row.locked_until?.toISOString() ?? null,
    last_login_at: row.last_login_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    linked_player:
      row.player_id_type !== null && row.player_external_id !== null
        ? toPlayerSummary({ id_type: row.player_id_type, external_id: row.player_external_id, display_name: row.player_display_name })
        : null,
  };
}

export class UsersService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  // -------------------------------------------------------------------------
  // /me
  // -------------------------------------------------------------------------

  async me(user: AuthenticatedUser, session: AuthenticatedSession): Promise<MeResponse> {
    const row = await repo.findUserById(this.db, user.id);
    if (row === undefined) throw new AppError('UNAUTHENTICATED');
    const [memberships, player] = await Promise.all([
      repo.listMemberships(this.db, user.id),
      row.player_id !== null ? repo.findPlayerById(this.db, row.player_id) : Promise.resolve(undefined),
    ]);
    return {
      user: {
        id: row.id,
        email: row.email,
        username: row.username,
        role: row.role,
        status: row.status,
        email_verified: row.email_verified_at !== null,
        mfa_enabled: row.totp_enabled_at !== null,
        reviewer_number: row.reviewer_number,
        created_at: row.created_at.toISOString(),
        last_login_at: row.last_login_at?.toISOString() ?? null,
      },
      permissions: [...permissionsForRole(row.role)] as Permission[],
      mfa_enrollment_required: session.mfa_enrollment_required,
      linked_player: player !== undefined ? toPlayerSummary(player) : null,
      servers: memberships.map((m) => ({ server_id: m.server_id, name: m.name, role: m.role })),
    };
  }

  // -------------------------------------------------------------------------
  // Player link (§6.6)
  // -------------------------------------------------------------------------

  /** Issues a link code (10 min, one active per user; a new code replaces the old one). */
  async createLinkCode(user: AuthenticatedUser): Promise<{ code: string; expires_at: string }> {
    const previous = await this.deps.store.getDel(storeKeys.linkCodeOfUser(user.id));
    if (previous !== null) await this.deps.store.del(storeKeys.linkCode(previous));
    const code = generateLinkCode();
    await this.deps.store.set(storeKeys.linkCode(code), user.id, LINK_CODE_TTL_MS);
    await this.deps.store.set(storeKeys.linkCodeOfUser(user.id), code, LINK_CODE_TTL_MS);
    return { code, expires_at: addMilliseconds(this.deps.clock.now(), LINK_CODE_TTL_MS).toISOString() };
  }

  async unlinkPlayer(request: FastifyRequest, user: AuthenticatedUser): Promise<void> {
    const row = await repo.findUserById(this.db, user.id);
    if (row === undefined) throw new AppError('UNAUTHENTICATED');
    if (row.player_id === null) throw new AppError('PLAYER_NOT_LINKED');
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      await trx.updateTable('users').set({ player_id: null, updated_at: now }).where('id', '=', user.id).execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'PLAYER_UNLINKED',
        target_type: 'user',
        target_id: user.id,
        metadata: { player_id: row.player_id },
      });
    });
  }

  /** Signed plugin route: consumes a link code and links users.player_id (§6.6). */
  async linkPlayer(
    request: FastifyRequest,
    server: AuthenticatedServer,
    input: { player: PlayerRef; code: string },
  ): Promise<{ linked: true; username: string }> {
    const code = input.code.trim().toUpperCase();
    const userId = await this.deps.store.get(storeKeys.linkCode(code));
    if (userId === null) throw new AppError('LINK_CODE_INVALID');
    const user = await repo.findUserById(this.db, userId);
    if (user === undefined || user.status !== 'active') throw new AppError('LINK_CODE_INVALID');

    const now = this.deps.clock.now();
    const username = await withTransaction(this.db, async (trx) => {
      const player = await repo.upsertPlayer(trx, input.player, now);
      const existing = await repo.findUserByPlayerId(trx, player.id);
      if (existing !== undefined && existing.id !== user.id) throw new AppError('PLAYER_ALREADY_LINKED');
      await trx.updateTable('users').set({ player_id: player.id, updated_at: now }).where('id', '=', user.id).execute();
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'server', actor_id: server.server_id },
        request_id: request.id,
        action: 'PLAYER_LINKED',
        target_type: 'user',
        target_id: user.id,
        server_id: server.id,
        metadata: { player_user_id: toUserId(input.player) },
      });
      return user.username;
    });

    // Single use: only a successful link consumes the code.
    await this.deps.store.del(storeKeys.linkCode(code));
    await this.deps.store.del(storeKeys.linkCodeOfUser(userId));
    return { linked: true as const, username };
  }

  // -------------------------------------------------------------------------
  // Admin user management
  // -------------------------------------------------------------------------

  async listUsers(
    filters: repo.AdminUserFilters,
    page: { limit: number; offset: number },
  ): Promise<{ items: AdminUser[]; total: number }> {
    const { items, total } = await repo.listAdminUsers(this.db, filters, page);
    return { items: items.map(toAdminUser), total };
  }

  async updateUser(
    request: FastifyRequest,
    actor: AuthenticatedUser,
    targetId: string,
    input: { role?: UserRow['role']; status?: UserStatus; reason?: string | null },
  ): Promise<AdminUser> {
    if (targetId === actor.id) throw forbidden('You cannot change your own role or status');

    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const target = await repo.findUserById(trx, targetId);
      if (target === undefined) throw notFound('User not found');

      if (!canManageUser(actor.role, target.role)) throw forbidden();

      const newRole = input.role !== undefined && input.role !== target.role ? input.role : undefined;
      const newStatus = input.status !== undefined && input.status !== target.status ? input.status : undefined;
      if (newRole === undefined && newStatus === undefined) return;

      if (newRole !== undefined && !canAssignRole(actor.role, newRole)) throw forbidden();

      // Never orphan the network: keep at least one active super_admin.
      const losesSuperAdmin =
        target.role === 'super_admin' &&
        ((newRole !== undefined && newRole !== 'super_admin') || (newStatus !== undefined && newStatus !== 'active'));
      if (losesSuperAdmin && (await repo.countOtherActiveSuperAdmins(trx, target.id)) === 0) {
        throw invalidState('Cannot demote or disable the last active super_admin');
      }

      const patch: Record<string, unknown> = { updated_at: now };
      if (newRole !== undefined) {
        patch['role'] = newRole;
        if (target.reviewer_number === null && roleRank(newRole) >= REVIEWER_RANK) {
          patch['reviewer_number'] = await nextReviewerNumber(trx);
        }
      }
      if (newStatus !== undefined) patch['status'] = newStatus;
      await trx
        .updateTable('users')
        .set(patch as never)
        .where('id', '=', target.id)
        .execute();

      const reason = input.reason ?? null;
      if (newRole !== undefined) {
        await this.deps.audit.record(trx, {
          ...auditContext(request),
          action: 'USER_ROLE_CHANGED',
          target_type: 'user',
          target_id: target.id,
          metadata: { previous_role: target.role, new_role: newRole, reason },
        });
      }
      if (newStatus !== undefined) {
        if (newStatus !== 'active') {
          await this.deps.sessions.revokeAllSessions(trx, target.id, 'account_disabled');
        }
        await this.deps.audit.record(trx, {
          ...auditContext(request),
          action: 'USER_STATUS_CHANGED',
          target_type: 'user',
          target_id: target.id,
          metadata: { previous_status: target.status, new_status: newStatus, reason },
        });
      }
    });

    const updated = await repo.getAdminUser(this.db, targetId);
    if (updated === undefined) throw notFound('User not found');
    return toAdminUser(updated);
  }
}
