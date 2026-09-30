/**
 * Appeals business logic (§11.5): creation by the linked player, assignment,
 * independent decision with super_admin conflict override, withdrawal.
 */
import type { FastifyRequest } from 'fastify';

import {
  hasPermission,
  Permission,
  type AppealDecisionRequest,
  type AppealListQuery,
  type AppealView,
} from '@scpsl-trust/shared';

import { userHasPermission } from '../../auth/rbac';
import type { AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { isUniqueViolation } from '../../db/errors';
import { withTransaction } from '../../db/tx';
import type { AppealRow } from '../../db/types';
import type { CaseVerdict } from '../../db/enums';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { auditContext } from '../audit/actor';
import { findCaseByNumber, findCaseById, isReporterOnCase } from '../cases/repository';
import { applyVerdictChange, type SettableVerdict } from '../cases/service';
import { toPlayerSummary, toReviewerRef, toUserRef } from '../cases/views';
import * as repo from './repository';

export function toAppealView(row: repo.AppealViewRow): AppealView {
  return {
    id: row.id,
    case_number: row.case_number,
    player: toPlayerSummary({
      id_type: row.player_id_type,
      external_id: row.player_external_id,
      display_name: row.player_display_name,
    }),
    submitted_by: toUserRef({ id: row.submitted_by_id, username: row.submitted_by_username }),
    statement: row.statement,
    status: row.status,
    assigned_reviewer: row.assigned_reviewer_id !== null ? toReviewerRef(row.assigned_reviewer_number) : null,
    decision: row.decision,
    decision_reason: row.decision_reason,
    decided_by: row.decided_by_id !== null ? toReviewerRef(row.decided_by_reviewer_number) : null,
    decided_at: row.decided_at?.toISOString() ?? null,
    conflict_override: row.conflict_override,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class AppealsService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  private async viewById(id: string): Promise<AppealView> {
    const row = await repo.findAppealViewById(this.db, id);
    if (row === undefined) throw notFound('Appeal not found');
    return toAppealView(row);
  }

  // -------------------------------------------------------------------------
  // Create (appeal:create — the linked player of the case only)
  // -------------------------------------------------------------------------

  async create(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: { case_id: string; statement: string },
  ): Promise<AppealView> {
    if (user.player_id === null) throw new AppError('PLAYER_NOT_LINKED');
    const playerId = user.player_id;
    const now = this.deps.clock.now();

    const created = await withTransaction(this.db, async (trx) => {
      const caseRow = await findCaseByNumber(trx, input.case_id);
      if (caseRow === undefined) throw notFound('Case not found');
      if (caseRow.player_id !== playerId) {
        throw forbidden('Only the player concerned by the case can appeal it');
      }
      if (caseRow.current_verdict !== 'confirmed' && caseRow.current_verdict !== 'inconclusive') {
        throw new AppError('APPEAL_NOT_ALLOWED', 'Only confirmed or inconclusive verdicts can be appealed');
      }
      if ((await repo.findOpenAppealForCase(trx, caseRow.id)) !== undefined) {
        throw new AppError('ALREADY_EXISTS', 'The case already has an open appeal');
      }
      let appeal: AppealRow;
      try {
        appeal = await repo.insertAppeal(trx, {
          case_id: caseRow.id,
          player_id: playerId,
          submitted_by_user_id: user.id,
          statement: input.statement,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('ALREADY_EXISTS', 'The case already has an open appeal');
        throw err;
      }
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'APPEAL_CREATED',
        target_type: 'appeal',
        target_id: appeal.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number },
      });
      return appeal;
    });
    return this.viewById(created.id);
  }

  // -------------------------------------------------------------------------
  // Listing & detail
  // -------------------------------------------------------------------------

  async list(user: AuthenticatedUser, query: AppealListQuery) {
    const filters: repo.AppealListFilters = {};
    if (query.status !== undefined) filters.status = query.status;
    if (userHasPermission(user, Permission.APPEAL_DECIDE)) {
      if (query.case !== undefined) {
        const caseRow = await findCaseByNumber(this.db, query.case);
        if (caseRow === undefined) return { items: [], total: 0 };
        filters.caseId = caseRow.id;
      }
      if (query.assigned_to_me === true) filters.assignedReviewerId = user.id;
    } else {
      filters.submittedById = user.id;
      if (query.case !== undefined) {
        const caseRow = await findCaseByNumber(this.db, query.case);
        if (caseRow === undefined) return { items: [], total: 0 };
        filters.caseId = caseRow.id;
      }
    }
    const { items, total } = await repo.listAppeals(this.db, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map(toAppealView), total };
  }

  async get(user: AuthenticatedUser, id: string): Promise<AppealView> {
    const row = await repo.findAppealById(this.db, id);
    if (row === undefined) throw notFound('Appeal not found');
    if (row.submitted_by_user_id !== user.id && !userHasPermission(user, Permission.APPEAL_DECIDE)) {
      throw forbidden();
    }
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Assignment (appeal:assign)
  // -------------------------------------------------------------------------

  async assign(
    request: FastifyRequest,
    user: AuthenticatedUser,
    id: string,
    reviewerUserId: string,
  ): Promise<AppealView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const appeal = await repo.findAppealById(trx, id);
      if (appeal === undefined) throw notFound('Appeal not found');
      if (appeal.status !== 'open' && appeal.status !== 'under_review') {
        throw new AppError('INVALID_STATE', 'Only open appeals can be assigned');
      }
      const reviewer = await trx
        .selectFrom('users')
        .select(['id', 'role', 'status', 'player_id'])
        .where('id', '=', reviewerUserId)
        .executeTakeFirst();
      if (reviewer === undefined) throw notFound('Reviewer not found');
      if (reviewer.status !== 'active' || !hasPermission(reviewer.role, Permission.APPEAL_DECIDE)) {
        throw new AppError('VALIDATION_FAILED', 'The assignee cannot decide appeals');
      }
      const caseRow = await findCaseById(trx, appeal.case_id);
      if (caseRow === undefined) throw notFound('Case not found');
      // §11.5 independence also applies to the assignee (incl. the case subject and the submitter).
      if (
        caseRow.verdict_set_by === reviewer.id ||
        appeal.submitted_by_user_id === reviewer.id ||
        (reviewer.player_id !== null && reviewer.player_id === caseRow.player_id) ||
        (await isReporterOnCase(trx, caseRow.id, reviewer.id))
      ) {
        throw new AppError('CONFLICT_OF_INTEREST', 'The assignee is involved in the case');
      }
      await trx
        .updateTable('appeals')
        .set({ assigned_reviewer_id: reviewer.id, status: 'under_review', updated_at: now })
        .where('id', '=', appeal.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'APPEAL_ASSIGNED',
        target_type: 'appeal',
        target_id: appeal.id,
        case_id: appeal.case_id,
        metadata: { reviewer_user_id: reviewer.id },
      });
    });
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Decision (appeal:decide; §11.5 independence)
  // -------------------------------------------------------------------------

  async decide(
    request: FastifyRequest,
    user: AuthenticatedUser,
    id: string,
    input: AppealDecisionRequest,
  ): Promise<AppealView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const appeal = await repo.findAppealById(trx, id);
      if (appeal === undefined) throw notFound('Appeal not found');
      if (appeal.status !== 'open' && appeal.status !== 'under_review') {
        throw new AppError('INVALID_STATE', 'The appeal is already decided or withdrawn');
      }
      const caseRow = await findCaseById(trx, appeal.case_id);
      if (caseRow === undefined) throw notFound('Case not found');

      // Self-dealing (§11.5): the submitter and the case subject can never decide the appeal —
      // not even with the super_admin conflict override.
      if (
        appeal.submitted_by_user_id === user.id ||
        (user.player_id !== null && user.player_id === caseRow.player_id)
      ) {
        throw new AppError('CONFLICT_OF_INTEREST', 'You cannot decide an appeal on your own case');
      }
      const conflicted =
        caseRow.verdict_set_by === user.id || (await isReporterOnCase(trx, caseRow.id, user.id));
      let conflictOverride = false;
      if (conflicted) {
        const mayOverride =
          input.override_conflict === true && userHasPermission(user, Permission.APPEAL_OVERRIDE_CONFLICT);
        if (!mayOverride) throw new AppError('CONFLICT_OF_INTEREST');
        conflictOverride = true;
      }

      // Effects on the verdict (§11.5).
      const targetVerdict: CaseVerdict | null =
        input.decision === 'reverse' ? 'rejected' : input.decision === 'inconclusive' ? 'inconclusive' : null;
      let verdictChanged = false;
      if (targetVerdict !== null && targetVerdict !== caseRow.current_verdict) {
        await applyVerdictChange(
          this.deps,
          trx,
          caseRow,
          targetVerdict as SettableVerdict,
          { userId: user.id, audit: auditContext(request) },
          { kind: 'appeal_decision', comment: input.reason, appealId: appeal.id },
        );
        verdictChanged = true;
      } else {
        // Verdict unchanged — still record the appeal decision in the review history.
        await trx
          .insertInto('reviews')
          .values({
            case_id: caseRow.id,
            reviewer_user_id: user.id,
            kind: 'appeal_decision',
            previous_verdict: caseRow.current_verdict,
            new_verdict: caseRow.current_verdict,
            comment: input.reason,
            appeal_id: appeal.id,
            created_at: now,
          })
          .execute();
      }

      await trx
        .updateTable('appeals')
        .set({
          status: 'decided',
          decision: input.decision,
          decision_reason: input.reason,
          decided_by: user.id,
          decided_at: now,
          conflict_override: conflictOverride,
          updated_at: now,
        })
        .where('id', '=', appeal.id)
        .execute();

      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'APPEAL_RESOLVED',
        target_type: 'appeal',
        target_id: appeal.id,
        case_id: appeal.case_id,
        metadata: {
          case_number: caseRow.case_number,
          decision: input.decision,
          conflict_override: conflictOverride,
          verdict_changed: verdictChanged,
        },
      });
    });
    return this.viewById(id);
  }

  // -------------------------------------------------------------------------
  // Withdraw (submitter only)
  // -------------------------------------------------------------------------

  async withdraw(request: FastifyRequest, user: AuthenticatedUser, id: string): Promise<AppealView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const appeal = await repo.findAppealById(trx, id);
      if (appeal === undefined) throw notFound('Appeal not found');
      if (appeal.submitted_by_user_id !== user.id) throw forbidden('Only the submitter can withdraw an appeal');
      if (appeal.status !== 'open' && appeal.status !== 'under_review') {
        throw new AppError('INVALID_STATE', 'The appeal can no longer be withdrawn');
      }
      await trx
        .updateTable('appeals')
        .set({ status: 'withdrawn', updated_at: now })
        .where('id', '=', appeal.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'APPEAL_WITHDRAWN',
        target_type: 'appeal',
        target_id: appeal.id,
        case_id: appeal.case_id,
        metadata: {},
      });
    });
    return this.viewById(id);
  }
}
