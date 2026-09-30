/**
 * Bypass business logic (§4.8, §11.6): server-scoped and global grants, revocation
 * (including the linked whitelist request) and the expiry job.
 */
import type { FastifyRequest } from 'fastify';

import {
  isBypassActive,
  parseUserId,
  Permission,
  type BypassCreateRequest,
  type BypassListQuery,
  type BypassView,
} from '@scpsl-trust/shared';

import { assertPermission, assertServerAction } from '../../auth/rbac';
import type { AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction, type DbExecutor } from '../../db/tx';
import type { BypassRow } from '../../db/types';
import { AppError, notFound, validation } from '../../lib/errors';
import { auditContext } from '../audit/actor';
import { SYSTEM_ACTOR } from '../audit/service';
import { findPlayerByRef, upsertPlayer } from '../cases/repository';
import { toPlayerSummary, toServerRef, toUserRef } from '../cases/views';
import * as repo from './repository';

export const BYPASS_EXPIRY_BATCH = 200;

export function toBypassView(row: repo.BypassViewRow, now: Date): BypassView {
  return {
    id: row.id,
    player: toPlayerSummary({
      id_type: row.player_id_type,
      external_id: row.player_external_id,
      display_name: row.player_display_name,
    }),
    scope: row.scope,
    server:
      row.server_public_id !== null
        ? toServerRef({
            server_id: row.server_public_id,
            name: row.server_name ?? '',
            is_trusted: row.server_is_trusted ?? false,
          })
        : null,
    type: row.type,
    reason: row.reason,
    granted_by: toUserRef({ id: row.granted_by_id, username: row.granted_by_username }),
    whitelist_request_id: row.whitelist_request_id,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at?.toISOString() ?? null,
    revoked_at: row.revoked_at?.toISOString() ?? null,
    revoked_by:
      row.revoked_by_id !== null && row.revoked_by_username !== null
        ? toUserRef({ id: row.revoked_by_id, username: row.revoked_by_username })
        : null,
    revoke_reason: row.revoke_reason,
    active: isBypassActive({ revoked_at: row.revoked_at, expires_at: row.expires_at }, now),
  };
}

/**
 * Active bypasses of a player for a server (server-scoped + optionally global).
 * Contractual lookup for the players module (§6.1/§6.2).
 */
export function getActiveBypasses(
  db: DbExecutor,
  playerId: string,
  serverUuid: string,
  options: { honorGlobal: boolean; now?: Date },
): Promise<repo.ActiveBypass[]> {
  return repo.selectActiveBypasses(db, playerId, serverUuid, options.honorGlobal, options.now ?? new Date());
}

export class BypassService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  /** Instance variant of the exported contractual lookup. */
  getActiveBypasses(
    playerId: string,
    serverUuid: string,
    options: { honorGlobal: boolean },
  ): Promise<repo.ActiveBypass[]> {
    return getActiveBypasses(this.db, playerId, serverUuid, { ...options, now: this.deps.clock.now() });
  }

  private buildListFilters(query: BypassListQuery): Omit<repo.BypassListFilters, 'scope' | 'serverUuid'> {
    const filters: Omit<repo.BypassListFilters, 'scope' | 'serverUuid'> = {};
    if (query.active !== undefined) filters.active = query.active;
    if (query.type !== undefined) filters.type = query.type;
    return filters;
  }

  private async resolvePlayerFilter(query: BypassListQuery): Promise<string | null | undefined> {
    if (query.player === undefined) return undefined;
    const ref = parseUserId(query.player);
    if (ref === null) return null;
    const player = await findPlayerByRef(this.db, ref);
    return player?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // Server-scoped (route preHandler already authorized via requireServerRole)
  // -------------------------------------------------------------------------

  async listServerBypasses(serverUuid: string, query: BypassListQuery) {
    const now = this.deps.clock.now();
    const filters: repo.BypassListFilters = { ...this.buildListFilters(query), serverUuid, scope: 'server' };
    const playerId = await this.resolvePlayerFilter(query);
    if (playerId === null) return { items: [], total: 0 };
    if (playerId !== undefined) filters.playerId = playerId;
    const { items, total } = await repo.listBypasses(this.db, filters, now, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map((row) => toBypassView(row, now)), total };
  }

  async createServerBypass(
    request: FastifyRequest,
    user: AuthenticatedUser,
    serverUuid: string,
    input: BypassCreateRequest,
  ): Promise<BypassView> {
    return this.create(request, user, input, { scope: 'server', serverUuid });
  }

  // -------------------------------------------------------------------------
  // Global (route guard: bypass:manage_global)
  // -------------------------------------------------------------------------

  async listGlobalBypasses(query: BypassListQuery) {
    const now = this.deps.clock.now();
    const filters: repo.BypassListFilters = { ...this.buildListFilters(query), scope: 'global' };
    const playerId = await this.resolvePlayerFilter(query);
    if (playerId === null) return { items: [], total: 0 };
    if (playerId !== undefined) filters.playerId = playerId;
    const { items, total } = await repo.listBypasses(this.db, filters, now, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map((row) => toBypassView(row, now)), total };
  }

  async createGlobalBypass(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: BypassCreateRequest,
  ): Promise<BypassView> {
    return this.create(request, user, input, { scope: 'global' });
  }

  private async create(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: BypassCreateRequest,
    target: { scope: 'server'; serverUuid: string } | { scope: 'global' },
  ): Promise<BypassView> {
    const now = this.deps.clock.now();
    const expiresAt = input.expires_at !== undefined && input.expires_at !== null ? new Date(input.expires_at) : null;
    // Re-check against the server clock (the schema check is parse-time only).
    if (expiresAt !== null && expiresAt.getTime() <= now.getTime()) {
      throw validation([{ path: 'expires_at', message: 'expires_at must be in the future' }]);
    }

    const row = await withTransaction(this.db, async (trx) => {
      const player = await upsertPlayer(trx, input.player, now);
      const bypass = await repo.insertBypass(trx, {
        player_id: player.id,
        scope: target.scope,
        server_id: target.scope === 'server' ? target.serverUuid : null,
        type: input.type,
        reason: input.reason,
        granted_by_user_id: user.id,
        created_at: now,
        expires_at: expiresAt,
      });
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'BYPASS_CREATED',
        target_type: 'bypass',
        target_id: bypass.id,
        ...(target.scope === 'server' ? { server_id: target.serverUuid } : {}),
        metadata: {
          scope: target.scope,
          type: input.type,
          player_id: player.id,
          expires_at: expiresAt?.toISOString() ?? null,
        },
      });
      return bypass;
    });
    return this.viewById(row.id);
  }

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  /**
   * POST /bypasses/{id}/revoke — server-scoped bypasses need owner/admin membership
   * (or server:manage_any); global bypasses need bypass:manage_global. Revoking a
   * whitelist-approval bypass also marks the request revoked.
   */
  async revoke(request: FastifyRequest, user: AuthenticatedUser, bypassId: string, reason: string): Promise<void> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const bypass = await repo.findBypassById(trx, bypassId);
      if (bypass === undefined) throw notFound('Bypass not found');
      if (bypass.scope === 'global') {
        assertPermission(user, Permission.BYPASS_MANAGE_GLOBAL);
      } else {
        // server_id is NOT NULL for scope 'server' (DB CHECK).
        await assertServerAction(trx, user, bypass.server_id as string, 'bypass');
      }
      if (bypass.revoked_at !== null) throw new AppError('INVALID_STATE', 'The bypass is already revoked');

      await repo.markRevoked(trx, bypass.id, user.id, reason, now);
      let requestId: string | null = null;
      if (bypass.whitelist_request_id !== null) {
        const updated = await trx
          .updateTable('whitelist_requests')
          .set({ status: 'revoked', updated_at: now })
          .where('id', '=', bypass.whitelist_request_id)
          .where('status', '=', 'approved')
          .returning('id')
          .executeTakeFirst();
        requestId = updated?.id ?? null;
      }
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'BYPASS_REVOKED',
        target_type: 'bypass',
        target_id: bypass.id,
        ...(bypass.server_id !== null ? { server_id: bypass.server_id } : {}),
        metadata: {
          scope: bypass.scope,
          type: bypass.type,
          reason,
          whitelist_request_id: requestId,
        },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Expiry job (idempotent, batch-limited)
  // -------------------------------------------------------------------------

  async processExpiredBypasses(limit = BYPASS_EXPIRY_BATCH): Promise<{ expired: number; requests_expired: number }> {
    const now = this.deps.clock.now();
    const candidates = await repo.selectExpiredUnprocessed(this.db, now, limit);
    let expired = 0;
    let requestsExpired = 0;
    for (const bypass of candidates) {
      // One transaction per bypass so a crash mid-batch never loses audit events.
      await withTransaction(this.db, async (trx) => {
        const claimed = await repo.markExpiredProcessed(trx, bypass.id, now);
        if (!claimed) return; // processed concurrently
        expired += 1;
        let requestId: string | null = null;
        if (bypass.whitelist_request_id !== null) {
          requestId = await repo.expireApprovedRequestForBypass(trx, bypass.id, now);
          if (requestId !== null) requestsExpired += 1;
        }
        await this.deps.audit.record(trx, {
          actor: SYSTEM_ACTOR,
          action: 'BYPASS_EXPIRED',
          target_type: 'bypass',
          target_id: bypass.id,
          ...(bypass.server_id !== null ? { server_id: bypass.server_id } : {}),
          metadata: {
            scope: bypass.scope,
            type: bypass.type,
            expires_at: bypass.expires_at?.toISOString() ?? null,
            whitelist_request_id: requestId,
          },
        });
      });
    }
    return { expired, requests_expired: requestsExpired };
  }

  private async viewById(id: string): Promise<BypassView> {
    const row = await repo.findBypassViewById(this.db, id);
    if (row === undefined) throw notFound('Bypass not found');
    return toBypassView(row, this.deps.clock.now());
  }

  async getRowForTests(id: string): Promise<BypassRow | undefined> {
    return repo.findBypassById(this.db, id);
  }
}
