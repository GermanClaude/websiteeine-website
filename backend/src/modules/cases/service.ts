/**
 * Cases business logic (§11.1, §11.2, §11.4): case lifecycle, reviews, verdicts,
 * server confirmations, staff/public views.
 */
import type { FastifyRequest } from 'fastify';

import {
  caseStaffScope,
  parseUserId,
  Permission,
  toUserId,
  type CaseListQuery,
  type CaseMutationResponse,
  type CasePublicView,
  type CaseStaffView,
  type CaseSummary,
  type PlayerRef,
} from '@scpsl-trust/shared';

import type { AuthenticatedUser } from '../../auth/types';
import { assertServerAction } from '../../auth/rbac';
import type { Deps } from '../../container';
import { isUniqueViolation } from '../../db/errors';
import { allocateCaseNumber } from '../../db/sequences';
import { withTransaction, type DbExecutor, type DbTransaction } from '../../db/tx';
import type {
  CaseRow,
} from '../../db/types';
import type { CaseVerdict, ReviewKind } from '../../db/enums';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors';
import type { AuditActor } from '../audit/service';
import { auditContext } from '../audit/actor';
import { listReportViewsForCase } from '../reports/repository';
import * as repo from './repository';
import {
  toCaseReviewView,
  toCaseSummary,
  toConfirmationView,
  toEvidenceView,
  toPlayerSummary,
  toReportView,
  toReviewerRef,
  toUserRef,
} from './views';

export interface AuditCtx {
  actor: AuditActor;
  request_id?: string;
}

export type SettableVerdict = Exclude<CaseVerdict, 'unknown'>;

function toMutationResponse(row: CaseRow): CaseMutationResponse {
  return {
    case_number: row.case_number,
    status: row.status,
    verdict: row.current_verdict,
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// applyVerdictChange — shared with the appeals module
// ---------------------------------------------------------------------------

export interface VerdictChangeOptions {
  /** reviews.kind of the history row ('verdict_set' or 'appeal_decision'). */
  kind: Extract<ReviewKind, 'verdict_set' | 'appeal_decision'>;
  comment: string;
  appealId?: string | null;
  /** When given (non-undefined) the public summary is updated. */
  publicSummary?: string | null | undefined;
}

/**
 * Applies a verdict change inside an existing transaction: writes the reviews row,
 * updates the case (verdict, verdict_set_by/at, status closed + closed_at), resolves
 * open reports (rejected verdict → reports rejected) and records VERDICT_CHANGED.
 * The caller is responsible for its own guards (evidence rule, conflict of interest).
 */
export async function applyVerdictChange(
  deps: Deps,
  trx: DbTransaction,
  caseRow: CaseRow,
  newVerdict: SettableVerdict,
  actor: { userId: string; audit: AuditCtx },
  options: VerdictChangeOptions,
): Promise<CaseRow> {
  const now = deps.clock.now();
  const previousVerdict = caseRow.current_verdict;

  await trx
    .insertInto('reviews')
    .values({
      case_id: caseRow.id,
      reviewer_user_id: actor.userId,
      kind: options.kind,
      previous_verdict: previousVerdict,
      new_verdict: newVerdict,
      comment: options.comment,
      appeal_id: options.appealId ?? null,
      created_at: now,
    })
    .execute();

  const patch: Record<string, unknown> = {
    current_verdict: newVerdict,
    status: 'closed',
    verdict_set_by: actor.userId,
    verdict_set_at: now,
    closed_at: caseRow.closed_at ?? now,
    updated_at: now,
  };
  if (options.publicSummary !== undefined) patch['public_summary'] = options.publicSummary;
  const updated = await trx
    .updateTable('cases')
    .set(patch as never)
    .where('id', '=', caseRow.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // §11.2: open/under_review reports → resolved (rejected verdict → rejected).
  const reportStatus = newVerdict === 'rejected' ? 'rejected' : 'resolved';
  await trx
    .updateTable('reports')
    .set({ status: reportStatus, resolved_by: actor.userId, resolved_at: now, updated_at: now })
    .where('case_id', '=', caseRow.id)
    .where('status', 'in', ['open', 'under_review'])
    .execute();

  await deps.audit.record(trx, {
    ...actor.audit,
    action: 'VERDICT_CHANGED',
    target_type: 'case',
    target_id: caseRow.id,
    case_id: caseRow.id,
    metadata: {
      case_number: caseRow.case_number,
      previous_verdict: previousVerdict,
      new_verdict: newVerdict,
      kind: options.kind,
      appeal_id: options.appealId ?? null,
    },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// findOrCreateOpenCase — shared with the reports module
// ---------------------------------------------------------------------------

export interface FindOrCreateCaseOptions {
  createdByUserId?: string;
  createdByServerId?: string;
  reason: string;
  audit: AuditCtx;
}

export class CasesService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  /**
   * §11.1: attaches to the player's most recent open/under_review case, otherwise
   * creates a new one (CASE_CREATED). Must run inside the business transaction.
   */
  async findOrCreateOpenCase(
    trx: DbTransaction,
    playerId: string,
    options: FindOrCreateCaseOptions,
  ): Promise<{ caseRow: CaseRow; created: boolean }> {
    const existing = await repo.findOpenCaseForPlayer(trx, playerId);
    if (existing !== undefined) return { caseRow: existing, created: false };

    const now = this.deps.clock.now();
    const caseNumber = await allocateCaseNumber(trx, now.getUTCFullYear());
    const caseRow = await repo.insertCase(trx, {
      case_number: caseNumber,
      player_id: playerId,
      reason: options.reason,
      created_by_user_id: options.createdByUserId ?? null,
      created_by_server_id: options.createdByServerId ?? null,
      created_at: now,
      updated_at: now,
    });
    await this.deps.audit.record(trx, {
      ...options.audit,
      action: 'CASE_CREATED',
      target_type: 'case',
      target_id: caseRow.id,
      case_id: caseRow.id,
      ...(options.createdByServerId !== undefined ? { server_id: options.createdByServerId } : {}),
      metadata: { case_number: caseNumber, reason: options.reason },
    });
    return { caseRow, created: true };
  }

  // -------------------------------------------------------------------------
  // Creation (web POST /cases)
  // -------------------------------------------------------------------------

  async createCase(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: { player: PlayerRef; reason: string; public_summary: string | null },
  ): Promise<CaseMutationResponse> {
    const now = this.deps.clock.now();
    const caseRow = await withTransaction(this.db, async (trx) => {
      const player = await repo.upsertPlayer(trx, input.player, now);
      const existing = await repo.findOpenCaseForPlayer(trx, player.id);
      if (existing !== undefined) {
        throw new AppError('ALREADY_EXISTS', 'The player already has an open case', {
          case_number: existing.case_number,
        });
      }
      const caseNumber = await allocateCaseNumber(trx, now.getUTCFullYear());
      const created = await repo.insertCase(trx, {
        case_number: caseNumber,
        player_id: player.id,
        reason: input.reason,
        public_summary: input.public_summary,
        created_by_user_id: user.id,
        created_at: now,
        updated_at: now,
      });
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'CASE_CREATED',
        target_type: 'case',
        target_id: created.id,
        case_id: created.id,
        metadata: { case_number: caseNumber, reason: input.reason },
      });
      return created;
    });
    return toMutationResponse(caseRow);
  }

  // -------------------------------------------------------------------------
  // Scope & lookups
  // -------------------------------------------------------------------------

  /** Resolves the caller's case staff scope and (for own_servers) their server uuids. */
  private async resolveScope(user: AuthenticatedUser): Promise<{ scope: 'all' | 'own_servers'; serverUuids: string[] }> {
    const serverUuids = await repo.memberServerUuids(this.db, user.id);
    const scope = caseStaffScope(user.role, serverUuids.length > 0);
    if (scope === 'none') throw forbidden();
    return { scope, serverUuids };
  }

  private async getCaseOrThrow(db: DbExecutor, caseNumber: string): Promise<CaseRow> {
    const row = await repo.findCaseByNumber(db, caseNumber);
    if (row === undefined) throw notFound('Case not found');
    return row;
  }

  // -------------------------------------------------------------------------
  // Listing & staff view
  // -------------------------------------------------------------------------

  async listCases(user: AuthenticatedUser, query: CaseListQuery): Promise<{ items: CaseSummary[]; total: number }> {
    const { scope, serverUuids } = await this.resolveScope(user);
    const filters: repo.CaseListFilters = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.verdict !== undefined) filters.verdict = query.verdict;
    if (query.q !== undefined) filters.q = query.q;
    if (query.player !== undefined) {
      const ref = parseUserId(query.player);
      const player = ref !== null ? await repo.findPlayerByRef(this.db, ref) : undefined;
      if (player === undefined) return { items: [], total: 0 };
      filters.playerId = player.id;
    }
    if (query.server_id !== undefined) {
      const server = await repo.findServerByPublicId(this.db, query.server_id);
      if (server === undefined) return { items: [], total: 0 };
      if (scope === 'own_servers' && !serverUuids.includes(server.id)) return { items: [], total: 0 };
      filters.serverUuid = server.id;
    } else if (scope === 'own_servers') {
      filters.scopeServerUuids = serverUuids;
    }
    const { items, total } = await repo.listCases(this.db, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map(toCaseSummary), total };
  }

  async getStaffView(user: AuthenticatedUser, caseNumber: string): Promise<CaseStaffView> {
    const { scope, serverUuids } = await this.resolveScope(user);
    const caseRow = await this.getCaseOrThrow(this.db, caseNumber);
    if (scope === 'own_servers' && !(await repo.caseInvolvesServers(this.db, caseRow.id, serverUuids))) {
      // 403 (not 404) so the web UI falls back to the public view.
      throw forbidden();
    }

    const [player, counts, reports, evidence, reviews, confirmations, appeals, history, verdictSetBy] =
      await Promise.all([
        repo.findPlayerById(this.db, caseRow.player_id),
        repo.caseCounts(this.db, caseRow.id),
        listReportViewsForCase(this.db, caseRow.id),
        repo.listEvidenceForCase(this.db, caseRow.id),
        repo.listReviewsForCase(this.db, caseRow.id),
        repo.listConfirmationsForCase(this.db, caseRow.id),
        repo.listAppealsForCase(this.db, caseRow.id),
        this.deps.audit.list({ case_id: caseRow.id }, { page: 1, page_size: 100 }),
        caseRow.verdict_set_by !== null
          ? this.db
              .selectFrom('users')
              .select(['id', 'reviewer_number'])
              .where('id', '=', caseRow.verdict_set_by)
              .executeTakeFirst()
          : Promise.resolve(undefined),
      ]);
    if (player === undefined) throw notFound('Case not found');

    return {
      id: caseRow.id,
      case_number: caseRow.case_number,
      player: toPlayerSummary(player),
      status: caseRow.status,
      verdict: caseRow.current_verdict,
      reason: caseRow.reason,
      public_summary: caseRow.public_summary,
      verdict_set_by: verdictSetBy !== undefined ? toReviewerRef(verdictSetBy.reviewer_number) : null,
      verdict_set_at: caseRow.verdict_set_at?.toISOString() ?? null,
      closed_at: caseRow.closed_at?.toISOString() ?? null,
      created_at: caseRow.created_at.toISOString(),
      updated_at: caseRow.updated_at.toISOString(),
      confirmed_servers: counts.confirmed_servers,
      independent_confirmed_servers: counts.independent_confirmed_servers,
      reports: reports.map(toReportView),
      evidence: evidence.map((row) => toEvidenceView(caseRow.case_number, row)),
      reviews: reviews.map(toCaseReviewView),
      appeals: appeals.map((a) => ({
        id: a.id,
        case_number: caseRow.case_number,
        player: toPlayerSummary(player),
        submitted_by: toUserRef({ id: a.submitted_by_id, username: a.submitted_by_username }),
        statement: a.statement,
        status: a.status as CaseStaffView['appeals'][number]['status'],
        assigned_reviewer: a.assigned_reviewer_id !== null ? toReviewerRef(a.assigned_reviewer_number) : null,
        decision: a.decision as CaseStaffView['appeals'][number]['decision'],
        decision_reason: a.decision_reason,
        decided_by: a.decided_by !== null ? toReviewerRef(a.decided_by_reviewer_number) : null,
        decided_at: a.decided_at?.toISOString() ?? null,
        conflict_override: a.conflict_override,
        created_at: a.created_at.toISOString(),
        updated_at: a.updated_at.toISOString(),
      })),
      confirmations: confirmations.map(toConfirmationView),
      history: history.items.map((e) => ({
        seq: e.seq,
        event_id: e.event_id,
        created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        action: e.action,
        actor_type: e.actor_type,
        actor_label: e.actor_label ?? null,
        target_type: e.target_type,
        target_id: e.target_id,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Public view
  // -------------------------------------------------------------------------

  async getPublicView(caseNumber: string): Promise<CasePublicView> {
    if (!this.deps.config.features.publicCaseLookup) throw notFound();
    const caseRow = await this.getCaseOrThrow(this.db, caseNumber);
    const [player, counts, appealStatus, timeline] = await Promise.all([
      repo.findPlayerById(this.db, caseRow.player_id),
      repo.caseCounts(this.db, caseRow.id),
      repo.latestAppealStatus(this.db, caseRow.id),
      repo.publicTimeline(this.db, caseRow.id),
    ]);
    if (player === undefined) throw notFound();
    return {
      case_number: caseRow.case_number,
      player: {
        user_id: toUserId({ type: player.id_type, id: player.external_id }),
        display_name: player.display_name,
      },
      status: caseRow.status,
      verdict: caseRow.current_verdict,
      public_summary: caseRow.public_summary,
      verdict_set_at: caseRow.verdict_set_at?.toISOString() ?? null,
      report_count: counts.report_count,
      evidence_count: counts.evidence_count,
      verified_evidence_count: counts.verified_evidence_count,
      confirmed_servers: counts.confirmed_servers,
      appeal_status: appealStatus as CasePublicView['appeal_status'],
      timeline: timeline.map((e) => ({
        action: e.action as NonNullable<CasePublicView['timeline']>[number]['action'],
        actor: e.reviewer_number !== null ? toReviewerRef(e.reviewer_number).pseudonym : null,
        created_at: e.created_at.toISOString(),
      })),
      created_at: caseRow.created_at.toISOString(),
      updated_at: caseRow.updated_at.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Review actions
  // -------------------------------------------------------------------------

  async startReview(request: FastifyRequest, user: AuthenticatedUser, caseNumber: string, comment: string): Promise<CaseMutationResponse> {
    const now = this.deps.clock.now();
    const updated = await withTransaction(this.db, async (trx) => {
      const caseRow = await this.getCaseOrThrow(trx, caseNumber);
      if (caseRow.status !== 'open') {
        throw invalidState('Only open cases can be moved to review');
      }
      await trx
        .insertInto('reviews')
        .values({ case_id: caseRow.id, reviewer_user_id: user.id, kind: 'review_started', comment, created_at: now })
        .execute();
      const row = await trx
        .updateTable('cases')
        .set({ status: 'under_review', updated_at: now })
        .where('id', '=', caseRow.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'REVIEW_STARTED',
        target_type: 'case',
        target_id: caseRow.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number },
      });
      return row;
    });
    return toMutationResponse(updated);
  }

  async addNote(request: FastifyRequest, user: AuthenticatedUser, caseNumber: string, comment: string): Promise<CaseMutationResponse> {
    const now = this.deps.clock.now();
    const updated = await withTransaction(this.db, async (trx) => {
      const caseRow = await this.getCaseOrThrow(trx, caseNumber);
      await trx
        .insertInto('reviews')
        .values({ case_id: caseRow.id, reviewer_user_id: user.id, kind: 'note', comment, created_at: now })
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'CASE_NOTE_ADDED',
        target_type: 'case',
        target_id: caseRow.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number },
      });
      return caseRow;
    });
    return toMutationResponse(updated);
  }

  /** §11.2 verdict rules; the route additionally requires a 2FA-verified session. */
  async setVerdict(
    request: FastifyRequest,
    user: AuthenticatedUser,
    caseNumber: string,
    input: { verdict: SettableVerdict; comment: string; public_summary: string | null },
  ): Promise<CaseMutationResponse> {
    const updated = await withTransaction(this.db, async (trx) => {
      const caseRow = await this.getCaseOrThrow(trx, caseNumber);
      if (caseRow.status === 'closed') {
        throw invalidState('The case is closed; reopen it before changing the verdict');
      }
      if (await repo.isReporterOnCase(trx, caseRow.id, user.id)) {
        throw new AppError('CONFLICT_OF_INTEREST');
      }
      if (input.verdict === 'confirmed' && !(await repo.hasVerifiedCheatingEvidence(trx, caseRow.id))) {
        throw new AppError('INSUFFICIENT_EVIDENCE');
      }
      return applyVerdictChange(
        this.deps,
        trx,
        caseRow,
        input.verdict,
        { userId: user.id, audit: auditContext(request) },
        { kind: 'verdict_set', comment: input.comment, publicSummary: input.public_summary },
      );
    });
    return toMutationResponse(updated);
  }

  async reopen(request: FastifyRequest, user: AuthenticatedUser, caseNumber: string, comment: string): Promise<CaseMutationResponse> {
    const now = this.deps.clock.now();
    const updated = await withTransaction(this.db, async (trx) => {
      const caseRow = await this.getCaseOrThrow(trx, caseNumber);
      if (caseRow.status !== 'closed') throw invalidState('Only closed cases can be reopened');
      await trx
        .insertInto('reviews')
        .values({ case_id: caseRow.id, reviewer_user_id: user.id, kind: 'reopened', comment, created_at: now })
        .execute();
      const row = await trx
        .updateTable('cases')
        .set({ status: 'under_review', closed_at: null, updated_at: now })
        .where('id', '=', caseRow.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'CASE_REOPENED',
        target_type: 'case',
        target_id: caseRow.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number },
      });
      return row;
    });
    return toMutationResponse(updated);
  }

  // -------------------------------------------------------------------------
  // Server confirmations (§11.4)
  // -------------------------------------------------------------------------

  async addConfirmation(
    request: FastifyRequest,
    user: AuthenticatedUser,
    caseNumber: string,
    input: { server_id: string; note: string | null },
  ): Promise<CaseMutationResponse> {
    const now = this.deps.clock.now();
    const caseRow = await withTransaction(this.db, async (trx) => {
      const row = await this.getCaseOrThrow(trx, caseNumber);
      const server = await repo.findServerByPublicId(trx, input.server_id);
      if (server === undefined) throw notFound('Server not found');
      // Owner/admin membership of that server (§12.3; confirmations have no override).
      await assertServerAction(trx, user, server.id, 'confirm');
      if (server.status !== 'active') throw new AppError('SERVER_NOT_ACTIVE');
      if (!(row.current_verdict === 'confirmed' || row.status === 'under_review')) {
        throw invalidState('Confirmations require a confirmed verdict or a case under review');
      }
      if ((await repo.findActiveConfirmation(trx, row.id, server.id)) !== undefined) {
        throw new AppError('ALREADY_EXISTS', 'This server already confirmed the case');
      }
      let confirmation;
      try {
        confirmation = await trx
          .insertInto('case_server_confirmations')
          .values({
            case_id: row.id,
            server_id: server.id,
            confirmed_by_user_id: user.id,
            note: input.note,
            created_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err, 'case_server_confirmations_one_active_key')) {
          throw new AppError('ALREADY_EXISTS', 'This server already confirmed the case');
        }
        throw err;
      }
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'CASE_CONFIRMED_BY_SERVER',
        target_type: 'case_confirmation',
        target_id: confirmation.id,
        server_id: server.id,
        case_id: row.id,
        metadata: { case_number: row.case_number, server_id: server.server_id },
      });
      return row;
    });
    const fresh = await repo.findCaseById(this.db, caseRow.id);
    return toMutationResponse(fresh ?? caseRow);
  }

  async revokeConfirmation(
    request: FastifyRequest,
    user: AuthenticatedUser,
    caseNumber: string,
    confirmationId: string,
    reason: string | null,
  ): Promise<void> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const caseRow = await this.getCaseOrThrow(trx, caseNumber);
      const confirmation = await trx
        .selectFrom('case_server_confirmations')
        .selectAll()
        .where('id', '=', confirmationId)
        .where('case_id', '=', caseRow.id)
        .executeTakeFirst();
      if (confirmation === undefined) throw notFound('Confirmation not found');
      await assertServerAction(trx, user, confirmation.server_id, 'confirm');
      if (confirmation.revoked_at !== null) throw invalidState('The confirmation is already revoked');
      await trx
        .updateTable('case_server_confirmations')
        .set({ revoked_at: now, revoked_by: user.id, revoke_reason: reason })
        .where('id', '=', confirmation.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'CASE_CONFIRMATION_REVOKED',
        target_type: 'case_confirmation',
        target_id: confirmation.id,
        server_id: confirmation.server_id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number, reason },
      });
    });
  }
}
