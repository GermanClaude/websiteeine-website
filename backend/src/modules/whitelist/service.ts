/**
 * Whitelist request business logic (§11.6): request → decide → bypass → revoke,
 * plus the pending-request expiry job.
 */
import type { FastifyRequest } from 'fastify';

import {
  BYPASS_TYPE_FOR_WHITELIST_REQUEST,
  Permission,
  type WhitelistDecisionRequest,
  type WhitelistRequestCreateRequest,
  type WhitelistRequestListQuery,
  type WhitelistRequestView,
} from '@scpsl-trust/shared';

import { assertServerAction, getServerMembership, userHasPermission } from '../../auth/rbac';
import type { AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { isUniqueViolation } from '../../db/errors';
import { withTransaction } from '../../db/tx';
import type { WhitelistRequestRow } from '../../db/types';
import { addDays } from '../../lib/time';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { auditContext } from '../audit/actor';
import { SYSTEM_ACTOR } from '../audit/service';
import { findServerByPublicId, memberServerUuids } from '../cases/repository';
import { toPlayerSummary, toServerRef, toUserRef } from '../cases/views';
import { insertBypass, markRevoked } from '../bypasses/repository';
import * as repo from './repository';

export const WHITELIST_EXPIRY_BATCH = 200;

export function toWhitelistRequestView(row: repo.WhitelistRequestViewRow): WhitelistRequestView {
  return {
    id: row.id,
    player: toPlayerSummary({
      id_type: row.player_id_type,
      external_id: row.player_external_id,
      display_name: row.player_display_name,
    }),
    requester: toUserRef({ id: row.requester_id, username: row.requester_username }),
    server: toServerRef({
      server_id: row.server_public_id,
      name: row.server_name,
      is_trusted: row.server_is_trusted,
    }),
    type: row.type,
    reason: row.reason,
    requested_days: row.requested_days,
    status: row.status,
    decided_by:
      row.decided_by_id !== null && row.decided_by_username !== null
        ? toUserRef({ id: row.decided_by_id, username: row.decided_by_username })
        : null,
    decided_at: row.decided_at?.toISOString() ?? null,
    decision_note: row.decision_note,
    bypass_id: row.bypass_id,
    bypass_expires_at: row.bypass_expires_at?.toISOString() ?? null,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class WhitelistService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  private async viewById(id: string): Promise<WhitelistRequestView> {
    const row = await repo.findRequestViewById(this.db, id);
    if (row === undefined) throw notFound('Whitelist request not found');
    return toWhitelistRequestView(row);
  }

  // -------------------------------------------------------------------------
  // Create (whitelist:request; linked player required)
  // -------------------------------------------------------------------------

  async create(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: WhitelistRequestCreateRequest,
  ): Promise<WhitelistRequestView> {
    if (user.player_id === null) throw new AppError('PLAYER_NOT_LINKED');
    const playerId = user.player_id;
    const now = this.deps.clock.now();

    const row = await withTransaction(this.db, async (trx) => {
      const server = await findServerByPublicId(trx, input.server_id);
      if (server === undefined) throw notFound('Server not found');
      if (server.status !== 'active') throw new AppError('SERVER_NOT_ACTIVE');
      if (!server.accepts_whitelist_requests) throw new AppError('WHITELIST_REQUESTS_DISABLED');
      if ((await repo.findPendingDuplicate(trx, playerId, server.id, input.type)) !== undefined) {
        throw new AppError('ALREADY_EXISTS', 'A pending request of this type already exists for this server');
      }

      let created: WhitelistRequestRow;
      try {
        created = await repo.insertRequest(trx, {
          player_id: playerId,
          requester_user_id: user.id,
          server_id: server.id,
          type: input.type,
          reason: input.reason,
          requested_days: input.requested_days ?? null,
          expires_at: addDays(now, this.deps.config.whitelist.requestTtlDays),
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError('ALREADY_EXISTS', 'A pending request of this type already exists for this server');
        }
        throw err;
      }
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'BYPASS_REQUESTED',
        target_type: 'whitelist_request',
        target_id: created.id,
        server_id: server.id,
        metadata: { type: input.type, requested_days: input.requested_days ?? null },
      });
      return created;
    });
    return this.viewById(row.id);
  }

  // -------------------------------------------------------------------------
  // Listing & detail
  // -------------------------------------------------------------------------

  async list(user: AuthenticatedUser, query: WhitelistRequestListQuery) {
    const scope: repo.WhitelistListScope = {};
    if (query.mine === true) {
      scope.requesterUserId = user.id;
    } else if (userHasPermission(user, Permission.WHITELIST_DECIDE_ANY)) {
      scope.all = true;
    } else {
      scope.requesterUserId = user.id;
      scope.serverUuids = await memberServerUuids(this.db, user.id);
    }

    const filters: repo.WhitelistListFilters = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.type !== undefined) filters.type = query.type;
    if (query.server_id !== undefined) {
      const server = await findServerByPublicId(this.db, query.server_id);
      if (server === undefined) return { items: [], total: 0 };
      filters.serverUuid = server.id;
    }
    const { items, total } = await repo.listRequests(this.db, scope, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map(toWhitelistRequestView), total };
  }

  async get(user: AuthenticatedUser, id: string): Promise<WhitelistRequestView> {
    const row = await repo.findRequestById(this.db, id);
    if (row === undefined) throw notFound('Whitelist request not found');
    if (row.requester_user_id !== user.id && !userHasPermission(user, Permission.WHITELIST_DECIDE_ANY)) {
      const memberRole = await getServerMembership(this.db, row.server_id, user.id);
      if (memberRole === null) throw forbidden();
    }
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Decision (§11.6)
  // -------------------------------------------------------------------------

  async decide(
    request: FastifyRequest,
    user: AuthenticatedUser,
    id: string,
    input: WhitelistDecisionRequest,
  ): Promise<WhitelistRequestView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const row = await repo.findRequestById(trx, id);
      if (row === undefined) throw notFound('Whitelist request not found');
      const access = await assertServerAction(trx, user, row.server_id, 'whitelist_decide');
      // A player can never decide their own request, whatever their roles.
      if (row.requester_user_id === user.id) throw forbidden('You cannot decide your own request');
      if (row.status !== 'pending') throw new AppError('INVALID_STATE', 'Only pending requests can be decided');

      if (input.decision === 'reject') {
        await trx
          .updateTable('whitelist_requests')
          .set({
            status: 'rejected',
            decided_by: user.id,
            decided_at: now,
            decision_note: input.note,
            updated_at: now,
          })
          .where('id', '=', row.id)
          .execute();
        await this.deps.audit.record(trx, {
          ...auditContext(request),
          action: 'BYPASS_REJECTED',
          target_type: 'whitelist_request',
          target_id: row.id,
          server_id: row.server_id,
          metadata: { type: row.type },
        });
        return;
      }

      // approve — days default = requested_days; null = no expiry (owner/admin only).
      const days = input.days !== undefined ? input.days : row.requested_days;
      if (days === null) {
        const mayGrantPermanent =
          access.via === 'override' || access.member_role === 'owner' || access.member_role === 'admin';
        if (!mayGrantPermanent) {
          throw forbidden('Only server owners/admins may grant a bypass without expiry');
        }
      }
      const expiresAt = days !== null ? addDays(now, days) : null;

      // §Database rules: insert the bypass first, then set status + bypass_id together.
      const bypass = await insertBypass(trx, {
        player_id: row.player_id,
        scope: 'server',
        server_id: row.server_id,
        type: BYPASS_TYPE_FOR_WHITELIST_REQUEST[row.type],
        reason: input.note ?? row.reason,
        granted_by_user_id: user.id,
        whitelist_request_id: row.id,
        created_at: now,
        expires_at: expiresAt,
      });
      await trx
        .updateTable('whitelist_requests')
        .set({
          status: 'approved',
          bypass_id: bypass.id,
          decided_by: user.id,
          decided_at: now,
          decision_note: input.note,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'BYPASS_APPROVED',
        target_type: 'whitelist_request',
        target_id: row.id,
        server_id: row.server_id,
        metadata: {
          type: row.type,
          bypass_id: bypass.id,
          days,
          expires_at: expiresAt?.toISOString() ?? null,
        },
      });
    });
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Revoke an approved request (and its bypass)
  // -------------------------------------------------------------------------

  async revoke(
    request: FastifyRequest,
    user: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<WhitelistRequestView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const row = await repo.findRequestById(trx, id);
      if (row === undefined) throw notFound('Whitelist request not found');
      await assertServerAction(trx, user, row.server_id, 'whitelist_decide');
      if (row.status !== 'approved') throw new AppError('INVALID_STATE', 'Only approved requests can be revoked');

      let bypassId: string | null = null;
      if (row.bypass_id !== null) {
        const bypass = await trx
          .selectFrom('bypasses')
          .select(['id', 'revoked_at'])
          .where('id', '=', row.bypass_id)
          .executeTakeFirst();
        if (bypass !== undefined && bypass.revoked_at === null) {
          await markRevoked(trx, bypass.id, user.id, reason, now);
          bypassId = bypass.id;
        }
      }
      await trx
        .updateTable('whitelist_requests')
        .set({ status: 'revoked', updated_at: now })
        .where('id', '=', row.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'BYPASS_REVOKED',
        target_type: 'whitelist_request',
        target_id: row.id,
        server_id: row.server_id,
        metadata: { type: row.type, bypass_id: bypassId, reason },
      });
    });
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Expiry job (pending requests past expires_at)
  // -------------------------------------------------------------------------

  async processExpiredPending(limit = WHITELIST_EXPIRY_BATCH): Promise<{ expired: number }> {
    const now = this.deps.clock.now();
    const candidates = await repo.selectExpiredPending(this.db, now, limit);
    let expired = 0;
    for (const row of candidates) {
      await withTransaction(this.db, async (trx) => {
        const claimed = await repo.markRequestExpired(trx, row.id, now);
        if (!claimed) return;
        expired += 1;
        await this.deps.audit.record(trx, {
          actor: SYSTEM_ACTOR,
          action: 'WHITELIST_REQUEST_EXPIRED',
          target_type: 'whitelist_request',
          target_id: row.id,
          server_id: row.server_id,
          metadata: { type: row.type, expires_at: row.expires_at.toISOString() },
        });
      });
    }
    return { expired };
  }
}
