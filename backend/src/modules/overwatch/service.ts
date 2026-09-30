/**
 * Overwatch proof sessions (§10) and proof verification (§10.3, R6).
 *
 * The session secret is generated here, returned exactly once (start response) and stored
 * AES-256-GCM encrypted. Proof verification only ever answers "does this code belong to this
 * session/window" — it never touches verdicts.
 */
import { randomBytes } from 'node:crypto';

import type { FastifyRequest } from 'fastify';

import {
  buildProofMessage,
  OVERWATCH_HEARTBEAT_INTERVAL_SECONDS,
  parseUserId,
  Permission,
  PROOF_ACCEPTED_WINDOW_OFFSETS,
  proofCodeFromMac,
  proofWindowBounds,
  proofWindowFromMs,
  toUserId,
  type OverwatchSessionListQuery,
  type OverwatchSessionStartRequest,
  type OverwatchSessionView,
  type ProofQuery,
  type ProofResponse,
} from '@scpsl-trust/shared';

import { userHasPermission } from '../../auth/rbac';
import type { AuthenticatedServer, AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction } from '../../db/tx';
import type { OverwatchSessionRow } from '../../db/types';
import { hmacSha256, timingSafeEqualStr } from '../../lib/crypto';
import { AppError, forbidden, invalidState, notFound, validation } from '../../lib/errors';
import { generateUuid } from '../../lib/ids';
import { addSeconds, toIso, toIsoOrNull } from '../../lib/time';
import { auditContext } from '../audit/actor';
import type { AuditActor } from '../audit/service';
import * as caseRepo from '../cases/repository';
import * as repo from './repository';

function secretAad(sessionId: string): string {
  return `overwatch:${sessionId}`;
}

/** ended_at | last_heartbeat_at + interval (expired) | `now` while active (§10.3). */
export function effectiveEnd(session: OverwatchSessionRow, now: Date): Date {
  if (session.ended_at !== null) return session.ended_at;
  if (session.status === 'active') return now;
  return addSeconds(session.last_heartbeat_at, session.interval_seconds);
}

export class OverwatchService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  // -------------------------------------------------------------------------
  // Plugin: session lifecycle (§10.1)
  // -------------------------------------------------------------------------

  async startSession(request: FastifyRequest, server: AuthenticatedServer, input: OverwatchSessionStartRequest) {
    const now = this.deps.clock.now();
    const intervalSeconds = this.deps.config.overwatch.intervalSeconds;

    // started_at must be within ±60 s of backend time, otherwise backend time is used.
    let startedAt = now;
    if (input.started_at !== undefined && input.started_at !== null) {
      const claimed = new Date(input.started_at);
      if (Math.abs(claimed.getTime() - now.getTime()) <= 60_000) startedAt = claimed;
    }

    const sessionId = generateUuid();
    const secret = randomBytes(32);
    const secretEnc = this.deps.secretBox.encrypt(secret, secretAad(sessionId));

    await withTransaction(this.db, async (trx) => {
      const target = await caseRepo.upsertPlayer(trx, input.target_player, now);
      const spectator = await caseRepo.upsertPlayer(trx, input.spectator, now);
      await trx
        .insertInto('overwatch_sessions')
        .values({
          id: sessionId,
          server_id: server.id,
          target_player_id: target.id,
          spectator_player_id: spectator.id,
          secret_enc: secretEnc,
          interval_seconds: intervalSeconds,
          status: 'active',
          started_at: startedAt,
          last_heartbeat_at: now,
          created_at: now,
        })
        .execute();
      await this.deps.audit.record(trx, {
        actor: this.serverActor(server),
        request_id: request.id,
        action: 'OVERWATCH_SESSION_STARTED',
        target_type: 'overwatch_session',
        target_id: sessionId,
        server_id: server.id,
        metadata: {
          target_user_id: toUserId(input.target_player),
          spectator_user_id: toUserId(input.spectator),
          interval_seconds: intervalSeconds,
        },
      });
    });

    return {
      session_id: sessionId,
      secret: secret.toString('base64'),
      interval_seconds: intervalSeconds,
      started_at: toIso(startedAt),
      heartbeat_interval_seconds: OVERWATCH_HEARTBEAT_INTERVAL_SECONDS,
      server_time: toIso(now),
    };
  }

  async heartbeat(server: AuthenticatedServer, sessionId: string) {
    const now = this.deps.clock.now();
    const session = await this.ownSession(this.db, server, sessionId);
    if (session.status !== 'active') throw invalidState('Overwatch session is not active');
    await repo.updateSession(this.db, session.id, { last_heartbeat_at: now });
    return { session_id: session.id, status: 'active' as const, last_heartbeat_at: toIso(now), server_time: toIso(now) };
  }

  async endSession(request: FastifyRequest, server: AuthenticatedServer, sessionId: string, reason: string) {
    const now = this.deps.clock.now();
    return withTransaction(this.db, async (trx) => {
      const session = await this.ownSession(trx, server, sessionId);
      if (session.status !== 'active') throw invalidState('Overwatch session is not active');
      await repo.updateSession(trx, session.id, { status: 'ended', ended_at: now, end_reason: reason });
      await this.deps.audit.record(trx, {
        actor: this.serverActor(server),
        request_id: request.id,
        action: 'OVERWATCH_SESSION_ENDED',
        target_type: 'overwatch_session',
        target_id: session.id,
        server_id: server.id,
        metadata: { reason, started_at: toIso(session.started_at) },
      });
      return { session_id: session.id, status: 'ended' as const, ended_at: toIso(now) };
    });
  }

  private async ownSession(db: Parameters<typeof repo.findSessionById>[0], server: AuthenticatedServer, id: string) {
    const session = await repo.findSessionById(db, id);
    // A foreign session answers 404, not 403: servers cannot probe other servers' ids.
    if (session === undefined || session.server_id !== server.id) throw notFound('Overwatch session not found');
    return session;
  }

  private serverActor(server: AuthenticatedServer): AuditActor {
    return { actor_type: 'server', actor_id: server.server_id };
  }

  // -------------------------------------------------------------------------
  // Proof verification (§10.3)
  // -------------------------------------------------------------------------

  async verifyProof(request: FastifyRequest, user: AuthenticatedUser | null, query: ProofQuery): Promise<ProofResponse> {
    const now = this.deps.clock.now();
    const canViewCode = user !== null && userHasPermission(user, Permission.PROOF_VIEW_CODE);
    if (!canViewCode && query.code === undefined) {
      throw validation([{ path: 'code', message: 'code is required' }]);
    }

    const base: Omit<ProofResponse, 'valid' | 'timestamp_window'> = {
      server_id: query.server_id,
      player_id: query.player_id,
      spectator_id: query.spectator_id,
    };
    const fallbackWindow = this.windowIso(proofWindowFromMs(query.timestamp, this.deps.config.overwatch.intervalSeconds), this.deps.config.overwatch.intervalSeconds);

    const resolved = await this.resolveProofSubjects(query);
    let response: ProofResponse = { ...base, valid: false, timestamp_window: fallbackWindow };
    let matchedSessionId: string | null = null;
    let secretExpired = false;

    if (resolved !== null) {
      const at = new Date(query.timestamp);
      const candidates = await repo.findCandidateSessions(this.db, { ...resolved, at, ...(query.session_id !== undefined ? { sessionId: query.session_id } : {}) });
      for (const session of candidates) {
        if (query.timestamp > effectiveEnd(session, now).getTime()) continue;
        const w = proofWindowFromMs(query.timestamp, session.interval_seconds);
        const window = this.windowIso(w, session.interval_seconds);
        if (session.secret_enc === null) {
          // Secret wiped by retention: verification is no longer possible (documented).
          secretExpired = true;
          response = { ...base, valid: false, timestamp_window: window };
          continue;
        }
        const secret = this.deps.secretBox.decrypt(session.secret_enc, secretAad(session.id));
        const codeFor = (win: number): string =>
          proofCodeFromMac(
            hmacSha256(
              secret,
              buildProofMessage({
                sessionId: session.id,
                serverId: query.server_id,
                targetUserId: query.player_id,
                spectatorUserId: query.spectator_id,
                window: win,
              }),
            ),
          );
        if (query.code !== undefined) {
          for (const offset of PROOF_ACCEPTED_WINDOW_OFFSETS) {
            const win = w + offset;
            if (win < 0) continue;
            if (timingSafeEqualStr(codeFor(win), query.code)) {
              matchedSessionId = session.id;
              response = {
                ...base,
                valid: true,
                session_id: session.id,
                timestamp_window: window,
                window_offset: offset,
                ...(canViewCode ? { code: codeFor(w) } : {}),
              };
              break;
            }
          }
        } else if (canViewCode) {
          // Reviewer without a code: report the expected code for window w of the covering session.
          matchedSessionId = session.id;
          response = { ...base, valid: true, session_id: session.id, timestamp_window: window, code: codeFor(w) };
        }
        if (matchedSessionId !== null) break;
        if (query.code !== undefined) response = { ...base, valid: false, timestamp_window: window };
      }
    }

    if (secretExpired && !response.valid && canViewCode) {
      response = { ...response, reason: 'secret_expired' };
    }

    await withTransaction(this.db, async (trx) => {
      await this.deps.audit.record(trx, {
        actor: user !== null ? auditContext(request).actor : { actor_type: 'system', actor_id: null },
        request_id: request.id,
        action: 'PROOF_VERIFIED',
        target_type: 'overwatch_session',
        target_id: matchedSessionId,
        metadata: {
          valid: response.valid,
          server_id: query.server_id,
          ...(matchedSessionId !== null ? { session_id: matchedSessionId } : {}),
          ...(user === null ? { anonymous: true } : {}),
        },
      });
    });

    return response;
  }

  private windowIso(window: number, intervalSeconds: number): { start: string; end: string } {
    const bounds = proofWindowBounds(window, intervalSeconds);
    return { start: toIso(new Date(bounds.startSeconds * 1000)), end: toIso(new Date(bounds.endSeconds * 1000)) };
  }

  private async resolveProofSubjects(
    query: ProofQuery,
  ): Promise<{ serverUuid: string; targetPlayerId: string; spectatorPlayerId: string } | null> {
    const server = await caseRepo.findServerByPublicId(this.db, query.server_id);
    if (server === undefined) return null;
    const targetRef = parseUserId(query.player_id);
    const spectatorRef = parseUserId(query.spectator_id);
    if (targetRef === null || spectatorRef === null) return null;
    const target = await caseRepo.findPlayerByRef(this.db, targetRef);
    const spectator = await caseRepo.findPlayerByRef(this.db, spectatorRef);
    if (target === undefined || spectator === undefined) return null;
    return { serverUuid: server.id, targetPlayerId: target.id, spectatorPlayerId: spectator.id };
  }

  // -------------------------------------------------------------------------
  // Web views (overwatch:view) — never the secret
  // -------------------------------------------------------------------------

  async listSessions(query: OverwatchSessionListQuery): Promise<{ items: OverwatchSessionView[]; total: number }> {
    const filters: repo.SessionListFilters = {};
    if (query.server_id !== undefined) {
      const server = await caseRepo.findServerByPublicId(this.db, query.server_id);
      if (server === undefined) return { items: [], total: 0 };
      filters.serverUuid = server.id;
    }
    for (const [key, prop] of [
      ['target', 'targetPlayerId'],
      ['spectator', 'spectatorPlayerId'],
    ] as const) {
      const value = query[key];
      if (value === undefined) continue;
      const ref = parseUserId(value);
      const player = ref !== null ? await caseRepo.findPlayerByRef(this.db, ref) : undefined;
      if (player === undefined) return { items: [], total: 0 };
      filters[prop] = player.id;
    }
    if (query.status !== undefined) filters.status = query.status;
    if (query.from !== undefined) filters.from = new Date(query.from);
    if (query.to !== undefined) filters.to = new Date(query.to);

    const { items, total } = await repo.listSessionViews(this.db, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map((row) => this.toView(row)), total };
  }

  async getSession(id: string): Promise<OverwatchSessionView> {
    const row = await repo.getSessionViewById(this.db, id);
    if (row === undefined) throw notFound('Overwatch session not found');
    return this.toView(row);
  }

  private toView(row: repo.SessionViewRow): OverwatchSessionView {
    const now = this.deps.clock.now();
    const ended = row.status !== 'active';
    return {
      id: row.id,
      server: { server_id: row.server_public_id, name: row.server_name, is_trusted: row.server_is_trusted },
      target: this.toPlayerSummary(row.target_id_type, row.target_external_id, row.target_display_name),
      spectator: this.toPlayerSummary(row.spectator_id_type, row.spectator_external_id, row.spectator_display_name),
      interval_seconds: row.interval_seconds,
      status: row.status,
      started_at: toIso(row.started_at),
      ended_at: toIsoOrNull(row.ended_at),
      last_heartbeat_at: toIso(row.last_heartbeat_at),
      effective_end_at: ended ? toIso(effectiveEnd(row, now)) : null,
      end_reason: (row.end_reason as OverwatchSessionView['end_reason']) ?? null,
      proof_verifiable: row.secret_enc !== null,
      created_at: toIso(row.created_at),
    };
  }

  private toPlayerSummary(idType: string, externalId: string, displayName: string | null) {
    const type = idType as 'steam' | 'discord' | 'northwood';
    return { user_id: toUserId({ type, id: externalId }), type, id: externalId, display_name: displayName };
  }
}

/** Guards a route that requires an authenticated user (optional-auth routes call it inline). */
export function assertCan(user: AuthenticatedUser | null, permission: Permission): AuthenticatedUser {
  if (user === null) throw new AppError('UNAUTHENTICATED');
  if (!userHasPermission(user, permission)) throw forbidden();
  return user;
}
