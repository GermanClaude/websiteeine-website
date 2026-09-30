/**
 * Evidence business logic (§4.6, §11.3, R2, R7): streamed uploads with hashing and MIME
 * sniffing, link evidence, the review queue, three independent assessments, download
 * tickets, content streaming and the supersede chain. Evidence rows are immutable
 * (DB triggers); replacement is always a new object.
 */
import type { Readable } from 'node:stream';

import type { FastifyRequest } from 'fastify';

import {
  Permission,
  type EvidenceDetail,
  type EvidenceLinkCreateRequest,
  type EvidenceListQuery,
  type EvidenceReviewRequest,
  type EvidenceReviewView,
  type EvidenceTicketResponse,
  type EvidenceView,
} from '@scpsl-trust/shared';

import { userHasPermission } from '../../auth/rbac';
import type { AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction, type DbExecutor } from '../../db/tx';
import type { EvidenceRow } from '../../db/types';
import { AppError, forbidden, notFound, validation } from '../../lib/errors';
import { generateUuid } from '../../lib/ids';
import { toIso } from '../../lib/time';
import { auditContext } from '../audit/actor';
import * as caseRepo from '../cases/repository';
import { toEvidenceView, toReviewerRef } from '../cases/views';
import { sanitizeFilename, sniffUpload } from './mime';
import * as repo from './repository';
import { issueEvidenceTicket, verifyEvidenceTicket } from './ticket';

export interface UploadedFile {
  stream: Readable;
  filename: string | undefined;
  /** Declared Content-Type of the file part (client-supplied, verified by sniffing). */
  mimeType: string;
}

interface StoredObject {
  key: string;
  sha256: string;
  size: number;
  mime: string;
  filename: string | null;
}

export class EvidenceService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  // -------------------------------------------------------------------------
  // Permissions (§11.3)
  // -------------------------------------------------------------------------

  /** evidence:upload = reviewer+, a reporter on the case, or owner/admin/moderator member of a reporting server. */
  private async assertUploadPermission(db: DbExecutor, user: AuthenticatedUser, caseId: string): Promise<void> {
    if (userHasPermission(user, Permission.EVIDENCE_UPLOAD)) return;
    if (await repo.isReporterOnCase(db, caseId, user.id)) return;
    if (await repo.isMemberOfReportingServer(db, caseId, user.id)) return;
    throw forbidden('You cannot add evidence to this case');
  }

  /** Metadata/content access: evidence:view (reviewer+), the uploader, members of the uploader server. */
  private async canAccess(user: AuthenticatedUser, row: Pick<EvidenceRow, 'uploader_user_id' | 'uploader_server_id'>): Promise<boolean> {
    if (userHasPermission(user, Permission.EVIDENCE_VIEW)) return true;
    if (row.uploader_user_id !== null && row.uploader_user_id === user.id) return true;
    if (row.uploader_server_id !== null) return repo.isMemberOfServer(this.db, row.uploader_server_id, user.id);
    return false;
  }

  private async assertAccess(user: AuthenticatedUser, row: Pick<EvidenceRow, 'uploader_user_id' | 'uploader_server_id'>): Promise<void> {
    if (!(await this.canAccess(user, row))) throw forbidden();
  }

  /** The uploader identity is only shown to reviewers+ and the uploader (pseudonymized otherwise). */
  private redact(row: repo.EvidenceDetailRow, viewer: AuthenticatedUser): repo.EvidenceDetailRow {
    if (userHasPermission(viewer, Permission.EVIDENCE_VIEW) || row.uploader_user_id === viewer.id) return row;
    return { ...row, uploader_user_id: null, uploader_username: null };
  }

  // -------------------------------------------------------------------------
  // Upload (§11.3)
  // -------------------------------------------------------------------------

  async uploadToCase(
    request: FastifyRequest,
    user: AuthenticatedUser,
    caseNumber: string,
    fields: { type: string; title: string; description: string | null; report_id?: string | null; overwatch_session_id?: string | null },
    file: UploadedFile,
  ): Promise<EvidenceView> {
    const caseRow = await caseRepo.findCaseByNumber(this.db, caseNumber);
    if (caseRow === undefined) throw notFound('Case not found');
    await this.assertUploadPermission(this.db, user, caseRow.id);
    const reportId = await this.resolveReportId(caseRow.id, fields.report_id);
    const overwatchSessionId = await this.resolveOverwatchSessionId(fields.overwatch_session_id);

    const stored = await this.storeObject(file);
    const now = this.deps.clock.now();

    const evidence = await withTransaction(this.db, async (trx) => {
      const row = await trx
        .insertInto('evidence')
        .values({
          case_id: caseRow.id,
          report_id: reportId,
          type: fields.type as EvidenceRow['type'],
          title: fields.title,
          description: fields.description,
          sha256: stored.sha256,
          size_bytes: stored.size,
          mime_type: stored.mime,
          original_filename: stored.filename,
          storage_key: stored.key,
          uploaded_at: now,
          uploader_user_id: user.id,
          overwatch_session_id: overwatchSessionId,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'EVIDENCE_UPLOADED',
        target_type: 'evidence',
        target_id: row.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number, type: row.type, sha256: stored.sha256, size_bytes: stored.size, mime_type: stored.mime },
      });
      return row;
    });
    return this.viewOf(evidence.id, user);
  }

  async createLink(
    request: FastifyRequest,
    user: AuthenticatedUser,
    caseNumber: string,
    input: EvidenceLinkCreateRequest,
  ): Promise<EvidenceView> {
    const caseRow = await caseRepo.findCaseByNumber(this.db, caseNumber);
    if (caseRow === undefined) throw notFound('Case not found');
    await this.assertUploadPermission(this.db, user, caseRow.id);
    const reportId = await this.resolveReportId(caseRow.id, input.report_id);
    const overwatchSessionId = await this.resolveOverwatchSessionId(input.overwatch_session_id);
    const now = this.deps.clock.now();

    const evidence = await withTransaction(this.db, async (trx) => {
      const row = await trx
        .insertInto('evidence')
        .values({
          case_id: caseRow.id,
          report_id: reportId,
          type: 'link',
          title: input.title,
          description: input.description,
          external_url: input.url,
          uploaded_at: now,
          uploader_user_id: user.id,
          overwatch_session_id: overwatchSessionId,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'EVIDENCE_UPLOADED',
        target_type: 'evidence',
        target_id: row.id,
        case_id: caseRow.id,
        metadata: { case_number: caseRow.case_number, type: 'link', url: input.url },
      });
      return row;
    });
    return this.viewOf(evidence.id, user);
  }

  async supersede(
    request: FastifyRequest,
    user: AuthenticatedUser,
    evidenceId: string,
    fields: { title?: string | undefined; description: string | null; reason: string },
    file: UploadedFile,
  ): Promise<EvidenceView> {
    const old = await repo.findEvidenceById(this.db, evidenceId);
    if (old === undefined) throw notFound('Evidence not found');
    await this.assertUploadPermission(this.db, user, old.case_id);
    if (old.superseded_by_evidence_id !== null) throw new AppError('EVIDENCE_ALREADY_SUPERSEDED');

    // The stored object cannot be rolled back; a failed transaction leaves at most an
    // unreferenced object behind (same trade-off as uploads).
    const stored = await this.storeObject(file);
    const now = this.deps.clock.now();

    const created = await withTransaction(this.db, async (trx) => {
      const current = await trx
        .selectFrom('evidence')
        .select(['id', 'superseded_by_evidence_id', 'case_id'])
        .where('id', '=', old.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.superseded_by_evidence_id !== null) throw new AppError('EVIDENCE_ALREADY_SUPERSEDED');

      const row = await trx
        .insertInto('evidence')
        .values({
          case_id: old.case_id,
          report_id: old.report_id,
          type: old.type,
          title: fields.title ?? old.title,
          description: fields.description ?? old.description,
          sha256: stored.sha256,
          size_bytes: stored.size,
          mime_type: stored.mime,
          original_filename: stored.filename,
          storage_key: stored.key,
          uploaded_at: now,
          uploader_user_id: user.id,
          overwatch_session_id: old.overwatch_session_id,
          supersedes_evidence_id: old.id,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.updateTable('evidence').set({ superseded_by_evidence_id: row.id }).where('id', '=', old.id).execute();
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'EVIDENCE_SUPERSEDED',
        target_type: 'evidence',
        target_id: old.id,
        case_id: old.case_id,
        metadata: { superseded_by: row.id, reason: fields.reason, sha256: stored.sha256, size_bytes: stored.size },
      });
      return row;
    });
    return this.viewOf(created.id, user);
  }

  private async storeObject(file: UploadedFile): Promise<StoredObject> {
    const { mime, stream } = await sniffUpload(file.stream, file.mimeType);
    const now = this.deps.clock.now();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `evidence/${yyyy}/${mm}/${generateUuid()}`;
    const result = await this.deps.storage.put(key, stream, {
      contentType: mime,
      maxBytes: this.deps.config.evidence.maxBytes,
    });
    return { key, sha256: result.sha256, size: result.size, mime, filename: sanitizeFilename(file.filename) };
  }

  private async resolveReportId(caseId: string, reportId: string | null | undefined): Promise<string | null> {
    if (reportId === undefined || reportId === null) return null;
    const report = await repo.findReportOnCase(this.db, caseId, reportId);
    if (report === undefined) throw validation([{ path: 'report_id', message: 'Report does not belong to this case' }]);
    return report.id;
  }

  private async resolveOverwatchSessionId(sessionId: string | null | undefined): Promise<string | null> {
    if (sessionId === undefined || sessionId === null) return null;
    const session = await repo.findOverwatchSession(this.db, sessionId);
    if (session === undefined) throw validation([{ path: 'overwatch_session_id', message: 'Unknown Overwatch session' }]);
    return session.id;
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  private async viewOf(id: string, viewer: AuthenticatedUser): Promise<EvidenceView> {
    const row = await repo.getEvidenceDetailRow(this.db, id);
    if (row === undefined) throw notFound('Evidence not found');
    return toEvidenceView(row.case_number, this.redact(row, viewer));
  }

  async list(query: EvidenceListQuery): Promise<{ items: EvidenceView[]; total: number }> {
    const filters: repo.EvidenceListFilters = {};
    if (query.status !== undefined) filters.status = query.status;
    if (query.type !== undefined) filters.type = query.type;
    if (query.case !== undefined) {
      const caseRow = await caseRepo.findCaseByNumber(this.db, query.case);
      if (caseRow === undefined) return { items: [], total: 0 };
      filters.caseId = caseRow.id;
    }
    const { items, total } = await repo.listEvidenceViews(this.db, filters, {
      limit: query.page_size,
      offset: (query.page - 1) * query.page_size,
    });
    return { items: items.map((row) => toEvidenceView(row.case_number, row)), total };
  }

  async getDetail(request: FastifyRequest, user: AuthenticatedUser, id: string, verify: boolean): Promise<EvidenceDetail> {
    const row = await repo.getEvidenceDetailRow(this.db, id);
    if (row === undefined) throw notFound('Evidence not found');
    await this.assertAccess(user, row);

    let integrity: EvidenceDetail['integrity'] = null;
    if (verify) {
      // Integrity re-hash is reviewer+ only (it reads the stored object).
      if (!userHasPermission(user, Permission.EVIDENCE_VIEW)) throw forbidden();
      integrity = await this.verifyIntegrity(request, row);
    }

    const reviews = await repo.listReviewsForEvidence(this.db, id);
    return {
      ...toEvidenceView(row.case_number, this.redact(row, user)),
      reviews: reviews.map((r) => this.toReviewView(r)),
      integrity,
    };
  }

  private async verifyIntegrity(request: FastifyRequest, row: repo.EvidenceDetailRow): Promise<EvidenceDetail['integrity']> {
    const now = this.deps.clock.now();
    if (row.storage_key === null || row.sha256 === null) {
      return { verified: false, computed_sha256: null, checked_at: toIso(now) };
    }
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256');
    const stream = await this.deps.storage.get(row.storage_key);
    for await (const chunk of stream) hash.update(chunk as Buffer);
    const computed = hash.digest('hex');
    const verified = computed === row.sha256;
    await withTransaction(this.db, async (trx) => {
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'EVIDENCE_ACCESSED',
        target_type: 'evidence',
        target_id: row.id,
        case_id: row.case_id,
        metadata: { verify: true, integrity_failed: !verified, ...(verified ? {} : { computed_sha256: computed }) },
      });
    });
    return { verified, computed_sha256: computed, checked_at: toIso(now) };
  }

  private toReviewView(row: repo.ReviewViewRow): EvidenceReviewView {
    return {
      id: row.id,
      evidence_id: row.evidence_id,
      reviewer: toReviewerRef(row.reviewer_number),
      status: row.status,
      identity_status: row.identity_status,
      authenticity_status: row.authenticity_status,
      cheating_status: row.cheating_status,
      comment: row.comment,
      created_at: toIso(row.created_at),
    };
  }

  // -------------------------------------------------------------------------
  // Tickets & content (§12.1)
  // -------------------------------------------------------------------------

  async issueTicket(request: FastifyRequest, user: AuthenticatedUser, id: string): Promise<EvidenceTicketResponse> {
    const row = await repo.findEvidenceById(this.db, id);
    if (row === undefined) throw notFound('Evidence not found');
    await this.assertAccess(user, row);
    if (row.storage_key === null) throw notFound('Link evidence has no stored content');
    const { ticket, expiresAt } = issueEvidenceTicket(this.deps.config.secrets.jwtSecret, id, user.id, this.deps.clock.now());
    await withTransaction(this.db, async (trx) => {
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'EVIDENCE_ACCESSED',
        target_type: 'evidence',
        target_id: id,
        case_id: row.case_id,
        metadata: { ticket_issued: true },
      });
    });
    return {
      ticket,
      url: `/api/v1/evidence/${id}/content?ticket=${encodeURIComponent(ticket)}`,
      expires_at: toIso(expiresAt),
    };
  }

  /** Access via session (access rule) or a valid single-evidence ticket; audited. */
  async getContent(
    request: FastifyRequest,
    user: AuthenticatedUser | null,
    id: string,
    ticket: string | undefined,
  ): Promise<{ row: EvidenceRow; stream: Readable }> {
    const row = await repo.findEvidenceById(this.db, id);
    if (row === undefined) throw notFound('Evidence not found');

    let actorUserId: string | null = null;
    if (ticket !== undefined) {
      const ticketUser = verifyEvidenceTicket(this.deps.config.secrets.jwtSecret, ticket, id, this.deps.clock.now());
      if (ticketUser === null) throw new AppError('UNAUTHENTICATED', 'Invalid or expired download ticket');
      actorUserId = ticketUser;
    } else if (user !== null) {
      await this.assertAccess(user, row);
      actorUserId = user.id;
    } else {
      throw new AppError('UNAUTHENTICATED');
    }

    if (row.storage_key === null) throw notFound('Link evidence has no stored content');
    const stream = await this.deps.storage.get(row.storage_key);
    await withTransaction(this.db, async (trx) => {
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        actor: { actor_type: 'user', actor_id: actorUserId },
        action: 'EVIDENCE_ACCESSED',
        target_type: 'evidence',
        target_id: id,
        case_id: row.case_id,
        metadata: { content: true, ...(ticket !== undefined ? { via: 'ticket' } : {}) },
      });
    });
    return { row, stream };
  }

  // -------------------------------------------------------------------------
  // Reviews (§11.3, R2 — never touches the case verdict)
  // -------------------------------------------------------------------------

  async review(request: FastifyRequest, user: AuthenticatedUser, id: string, input: EvidenceReviewRequest): Promise<EvidenceReviewView> {
    const now = this.deps.clock.now();
    const review = await withTransaction(this.db, async (trx) => {
      const row = await trx.selectFrom('evidence').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (row === undefined) throw notFound('Evidence not found');
      if (row.uploader_user_id !== null && row.uploader_user_id === user.id) {
        throw new AppError('CONFLICT_OF_INTEREST', 'You cannot review evidence you uploaded');
      }
      const inserted = await trx
        .insertInto('evidence_reviews')
        .values({
          evidence_id: row.id,
          reviewer_user_id: user.id,
          status: input.status,
          identity_status: input.identity_status,
          authenticity_status: input.authenticity_status,
          cheating_status: input.cheating_status,
          comment: input.comment,
          created_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('evidence')
        .set({
          status: input.status,
          identity_status: input.identity_status,
          authenticity_status: input.authenticity_status,
          cheating_status: input.cheating_status,
          updated_at: now,
        })
        .where('id', '=', row.id)
        .execute();

      const audit = auditContext(request);
      const metadata = {
        status: input.status,
        identity_status: input.identity_status,
        authenticity_status: input.authenticity_status,
        cheating_status: input.cheating_status,
      };
      await this.deps.audit.record(trx, {
        ...audit,
        action: 'EVIDENCE_REVIEWED',
        target_type: 'evidence',
        target_id: row.id,
        case_id: row.case_id,
        metadata,
      });
      if (row.status !== input.status && (input.status === 'verified' || input.status === 'rejected')) {
        await this.deps.audit.record(trx, {
          ...audit,
          action: input.status === 'verified' ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_REJECTED',
          target_type: 'evidence',
          target_id: row.id,
          case_id: row.case_id,
          metadata: { previous_status: row.status },
        });
      }
      return inserted;
    });

    const reviewer = await this.db.selectFrom('users').select('reviewer_number').where('id', '=', user.id).executeTakeFirst();
    return this.toReviewView({ ...review, reviewer_number: reviewer?.reviewer_number ?? null });
  }
}
