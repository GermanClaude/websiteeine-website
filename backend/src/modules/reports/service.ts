/**
 * Reports business logic (§6.5, §11.1): web reports, signed in-game reports with
 * optional log-excerpt evidence, listing and review status changes.
 */
import { Readable } from 'node:stream';

import type { FastifyRequest } from 'fastify';

import {
  LIMITS,
  Permission,
  parseUserId,
  toUserId,
  type PlayerRef,
  type ReportCreateResponse,
  type ReportListQuery,
  type ReportView,
  type ServerReportRequest,
} from '@scpsl-trust/shared';

import { userHasPermission } from '../../auth/rbac';
import type { AuthenticatedServer, AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction } from '../../db/tx';
import type {
  ReportRow,
} from '../../db/types';
import type { ReportStatus } from '../../db/enums';
import { AppError, forbidden, invalidState, notFound } from '../../lib/errors';
import { sha256Hex } from '../../lib/crypto';
import { generateUuid } from '../../lib/ids';
import { auditContext } from '../audit/actor';
import * as caseRepo from '../cases/repository';
import { CasesService } from '../cases/service';
import { toReportView } from '../cases/views';
import * as repo from './repository';

export class ReportsService {
  private readonly cases: CasesService;

  constructor(private readonly deps: Deps) {
    this.cases = new CasesService(deps);
  }

  private get db() {
    return this.deps.db;
  }

  // -------------------------------------------------------------------------
  // Web report creation (§11.1)
  // -------------------------------------------------------------------------

  async createReport(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: { player: PlayerRef; reason: string; description: string | null; server_id?: string | null },
  ): Promise<ReportCreateResponse> {
    const now = this.deps.clock.now();
    return withTransaction(this.db, async (trx) => {
      let serverUuid: string | null = null;
      if (input.server_id !== undefined && input.server_id !== null) {
        const server = await caseRepo.findServerByPublicId(trx, input.server_id);
        if (server === undefined) throw notFound('Server not found');
        if (server.status !== 'active') throw new AppError('SERVER_NOT_ACTIVE');
        serverUuid = server.id;
      }
      const player = await caseRepo.upsertPlayer(trx, input.player, now);
      if ((await repo.findOpenReport(trx, player.id, { userId: user.id })) !== undefined) {
        throw new AppError('OPEN_REPORT_EXISTS');
      }
      const audit = auditContext(request);
      const { caseRow } = await this.cases.findOrCreateOpenCase(trx, player.id, {
        createdByUserId: user.id,
        reason: input.reason,
        audit,
      });
      const report = await trx
        .insertInto('reports')
        .values({
          case_id: caseRow.id,
          player_id: player.id,
          server_id: serverUuid,
          reporter_type: 'user',
          reporter_user_id: user.id,
          reason: input.reason,
          description: input.description,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...audit,
        action: 'REPORT_CREATED',
        target_type: 'report',
        target_id: report.id,
        case_id: caseRow.id,
        ...(serverUuid !== null ? { server_id: serverUuid } : {}),
        metadata: { case_number: caseRow.case_number, reason: input.reason, player_user_id: toUserId(input.player) },
      });
      return { report_id: report.id, case_id: caseRow.case_number };
    });
  }

  // -------------------------------------------------------------------------
  // Signed in-game report (§6.5)
  // -------------------------------------------------------------------------

  async createServerReport(
    request: FastifyRequest,
    server: AuthenticatedServer,
    input: ServerReportRequest,
  ): Promise<ReportCreateResponse> {
    const now = this.deps.clock.now();

    // The stored object cannot be rolled back, so write it before the transaction;
    // a failed transaction leaves at most an unreferenced object behind.
    let stored: { key: string; sha256: string; size: number } | null = null;
    if (input.log_excerpt !== undefined && input.log_excerpt !== null) {
      const buffer = Buffer.from(input.log_excerpt, 'utf8');
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const key = `evidence/${yyyy}/${mm}/${generateUuid()}`;
      const result = await this.deps.storage.put(key, Readable.from(buffer), {
        contentType: 'text/plain',
        maxBytes: LIMITS.LOG_EXCERPT_MAX_BYTES,
      });
      // Defense in depth: the schema already bounds the excerpt.
      if (result.sha256 !== sha256Hex(buffer)) throw new AppError('STORAGE_ERROR', 'Stored log excerpt hash mismatch');
      stored = { key, sha256: result.sha256, size: result.size };
    }

    return withTransaction(this.db, async (trx) => {
      const player = await caseRepo.upsertPlayer(trx, input.player, now);
      const reporter =
        input.reporter !== undefined && input.reporter !== null
          ? await caseRepo.upsertPlayer(trx, input.reporter, now)
          : null;

      const duplicate = await repo.findOpenReport(
        trx,
        player.id,
        reporter !== null ? { playerId: reporter.id } : { serverId: server.id },
      );
      if (duplicate !== undefined) throw new AppError('OPEN_REPORT_EXISTS');

      const audit = { actor: { actor_type: 'server' as const, actor_id: server.server_id }, request_id: request.id };
      const { caseRow } = await this.cases.findOrCreateOpenCase(trx, player.id, {
        createdByServerId: server.id,
        reason: input.reason,
        audit,
      });
      const report = await trx
        .insertInto('reports')
        .values({
          case_id: caseRow.id,
          player_id: player.id,
          server_id: server.id,
          reporter_type: 'server',
          reporter_player_id: reporter?.id ?? null,
          reason: input.reason,
          description: input.description,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...audit,
        action: 'REPORT_CREATED',
        target_type: 'report',
        target_id: report.id,
        server_id: server.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number, reason: input.reason, player_user_id: toUserId(input.player) },
      });

      if (stored !== null) {
        const evidence = await trx
          .insertInto('evidence')
          .values({
            case_id: caseRow.id,
            report_id: report.id,
            type: 'log',
            title: 'In-game report log excerpt',
            sha256: stored.sha256,
            size_bytes: stored.size,
            mime_type: 'text/plain',
            storage_key: stored.key,
            uploader_server_id: server.id,
            uploaded_at: now,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.deps.audit.record(trx, {
          ...audit,
          action: 'EVIDENCE_UPLOADED',
          target_type: 'evidence',
          target_id: evidence.id,
          server_id: server.id,
          case_id: caseRow.id,
          metadata: { case_number: caseRow.case_number, type: 'log', sha256: stored.sha256, size_bytes: stored.size },
        });
      }

      return { report_id: report.id, case_id: caseRow.case_number };
    });
  }

  // -------------------------------------------------------------------------
  // Listing & detail
  // -------------------------------------------------------------------------

  async listReports(user: AuthenticatedUser, query: ReportListQuery): Promise<{ items: ReportView[]; total: number }> {
    const isReviewer = userHasPermission(user, Permission.REPORT_REVIEW);
    const filters: repo.ReportListFilters = {};
    if (!isReviewer || query.mine === true) filters.reporterUserId = user.id;
    if (query.status !== undefined) filters.status = query.status;
    if (query.case !== undefined) {
      const caseRow = await caseRepo.findCaseByNumber(this.db, query.case);
      if (caseRow === undefined) return { items: [], total: 0 };
      filters.caseId = caseRow.id;
    }
    if (query.player !== undefined) {
      const ref = parseUserId(query.player);
      const player = ref !== null ? await caseRepo.findPlayerByRef(this.db, ref) : undefined;
      if (player === undefined) return { items: [], total: 0 };
      filters.playerId = player.id;
    }
    if (query.server_id !== undefined) {
      const server = await caseRepo.findServerByPublicId(this.db, query.server_id);
      if (server === undefined) return { items: [], total: 0 };
      filters.serverId = server.id;
    }
    const { items, total } = await repo.listReports(this.db, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map(toReportView), total };
  }

  async getReport(user: AuthenticatedUser, id: string): Promise<ReportView> {
    const row = await repo.getReportViewById(this.db, id);
    if (row === undefined) throw notFound('Report not found');
    const isReviewer = userHasPermission(user, Permission.REPORT_REVIEW);
    if (!isReviewer && row.reporter_user_id !== user.id) throw forbidden();
    return toReportView(row);
  }

  // -------------------------------------------------------------------------
  // Status changes (report:review)
  // -------------------------------------------------------------------------

  async changeStatus(
    request: FastifyRequest,
    user: AuthenticatedUser,
    id: string,
    input: { status: ReportStatus; note: string },
  ): Promise<ReportView> {
    const now = this.deps.clock.now();
    await withTransaction(this.db, async (trx) => {
      const report = await repo.findReportById(trx, id);
      if (report === undefined) throw notFound('Report not found');
      const caseRow = await caseRepo.findCaseById(trx, report.case_id);
      this.assertTransition(report, input.status, caseRow?.status ?? 'closed');

      const terminal = input.status === 'resolved' || input.status === 'rejected';
      await trx
        .updateTable('reports')
        .set({
          status: input.status,
          resolution_note: terminal ? input.note : null,
          resolved_by: terminal ? user.id : null,
          resolved_at: terminal ? now : null,
          updated_at: now,
        })
        .where('id', '=', report.id)
        .execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'REPORT_STATUS_CHANGED',
        target_type: 'report',
        target_id: report.id,
        case_id: report.case_id,
        ...(report.server_id !== null ? { server_id: report.server_id } : {}),
        metadata: { previous_status: report.status, new_status: input.status, note: input.note },
      });
    });
    const view = await repo.getReportViewById(this.db, id);
    if (view === undefined) throw notFound('Report not found');
    return toReportView(view);
  }

  /**
   * §11.2 transitions: open → under_review | rejected; under_review → resolved | rejected.
   * resolved/rejected are terminal unless the case was reopened (then back to under_review).
   */
  private assertTransition(report: ReportRow, next: ReportStatus, caseStatus: string): void {
    const current = report.status;
    if (current === next) throw invalidState('The report already has this status');
    let allowed: ReportStatus[];
    switch (current) {
      case 'open':
        allowed = ['under_review', 'rejected'];
        break;
      case 'under_review':
        allowed = ['resolved', 'rejected'];
        break;
      default:
        allowed = caseStatus === 'open' || caseStatus === 'under_review' ? ['under_review'] : [];
        break;
    }
    if (!allowed.includes(next)) {
      throw invalidState(`Cannot change a ${current} report to ${next}`);
    }
  }
}
