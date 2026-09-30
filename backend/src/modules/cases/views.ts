/**
 * Pure row → wire-view mappers of the cases and reports modules. Response schemas
 * contain no transforms, so every Date is converted with toISOString() here.
 * Reviewers are always shown by pseudonym (`Reviewer #n`), never username/email.
 */
import {
  formatReviewerPseudonym,
  toUserId,
  type CaseConfirmationView,
  type CaseReviewView,
  type CaseSummary,
  type EvidenceView,
  type PlayerSummary,
  type ReportView,
  type ReviewerRef,
  type ServerRef,
  type UserRef,
} from '@scpsl-trust/shared';

import type {
  CaseServerConfirmationRow,
  EvidenceRow,
} from '../../db/types';
import type { CaseStatus, CaseVerdict, EvidenceStatus, EvidenceType, PlayerIdType, ReportStatus, ReporterType, ReviewKind } from '../../db/enums';

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

export function toPlayerSummary(p: { id_type: PlayerIdType; external_id: string; display_name: string | null }): PlayerSummary {
  return {
    user_id: toUserId({ type: p.id_type, id: p.external_id }),
    type: p.id_type,
    id: p.external_id,
    display_name: p.display_name,
  };
}

export function toReviewerRef(reviewerNumber: number | null): ReviewerRef {
  return {
    reviewer_number: reviewerNumber,
    pseudonym: reviewerNumber !== null ? formatReviewerPseudonym(reviewerNumber) : 'Reviewer',
  };
}

export function toUserRef(user: { id: string; username: string }): UserRef {
  return { id: user.id, username: user.username };
}

export function toServerRef(server: { server_id: string; name: string; is_trusted: boolean }): ServerRef {
  return { server_id: server.server_id, name: server.name, is_trusted: server.is_trusted };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Joined row shape produced by reports/repository.reportViewQuery. */
export interface ReportViewRow {
  id: string;
  case_number: string;
  reporter_type: ReporterType;
  reason: string;
  description: string | null;
  status: ReportStatus;
  resolution_note: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  evidence_count: number;
  player_id_type: PlayerIdType;
  player_external_id: string;
  player_display_name: string | null;
  server_public_id: string | null;
  server_name: string | null;
  server_is_trusted: boolean | null;
  reporter_user_id: string | null;
  reporter_username: string | null;
  reporter_player_id_type: PlayerIdType | null;
  reporter_player_external_id: string | null;
  reporter_player_display_name: string | null;
  resolved_by_reviewer_number: number | null;
  resolved_by: string | null;
}

export function toReportView(row: ReportViewRow): ReportView {
  return {
    id: row.id,
    case_number: row.case_number,
    player: toPlayerSummary({
      id_type: row.player_id_type,
      external_id: row.player_external_id,
      display_name: row.player_display_name,
    }),
    server:
      row.server_public_id !== null
        ? toServerRef({ server_id: row.server_public_id, name: row.server_name ?? '', is_trusted: row.server_is_trusted ?? false })
        : null,
    reporter_type: row.reporter_type,
    reporter_user:
      row.reporter_user_id !== null && row.reporter_username !== null
        ? toUserRef({ id: row.reporter_user_id, username: row.reporter_username })
        : null,
    reporter_player:
      row.reporter_player_id_type !== null && row.reporter_player_external_id !== null
        ? toPlayerSummary({
            id_type: row.reporter_player_id_type,
            external_id: row.reporter_player_external_id,
            display_name: row.reporter_player_display_name,
          })
        : null,
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolution_note: row.resolution_note,
    resolved_by: row.resolved_by !== null ? toReviewerRef(row.resolved_by_reviewer_number) : null,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    evidence_count: Number(row.evidence_count),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Evidence (read-only view over the evidence table; the evidence module owns writes)
// ---------------------------------------------------------------------------

export interface EvidenceViewRow extends Pick<
  EvidenceRow,
  | 'id'
  | 'report_id'
  | 'type'
  | 'title'
  | 'description'
  | 'status'
  | 'identity_status'
  | 'authenticity_status'
  | 'cheating_status'
  | 'sha256'
  | 'size_bytes'
  | 'mime_type'
  | 'original_filename'
  | 'external_url'
  | 'overwatch_session_id'
  | 'supersedes_evidence_id'
  | 'superseded_by_evidence_id'
> {
  uploaded_at: Date;
  created_at: Date;
  updated_at: Date;
  uploader_user_id: string | null;
  uploader_username: string | null;
  uploader_server_public_id: string | null;
  uploader_server_name: string | null;
  uploader_server_is_trusted: boolean | null;
}

export function toEvidenceView(caseNumber: string, row: EvidenceViewRow): EvidenceView {
  return {
    id: row.id,
    case_number: caseNumber,
    report_id: row.report_id,
    type: row.type as EvidenceType,
    title: row.title,
    description: row.description,
    status: row.status as EvidenceStatus,
    identity_status: row.identity_status as EvidenceStatus,
    authenticity_status: row.authenticity_status as EvidenceStatus,
    cheating_status: row.cheating_status as EvidenceStatus,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    mime_type: row.mime_type,
    original_filename: row.original_filename,
    external_url: row.external_url,
    uploaded_at: row.uploaded_at.toISOString(),
    uploader_user:
      row.uploader_user_id !== null && row.uploader_username !== null
        ? toUserRef({ id: row.uploader_user_id, username: row.uploader_username })
        : null,
    uploader_server:
      row.uploader_server_public_id !== null
        ? toServerRef({
            server_id: row.uploader_server_public_id,
            name: row.uploader_server_name ?? '',
            is_trusted: row.uploader_server_is_trusted ?? false,
          })
        : null,
    overwatch_session_id: row.overwatch_session_id,
    supersedes_evidence_id: row.supersedes_evidence_id,
    superseded_by_evidence_id: row.superseded_by_evidence_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reviews & confirmations
// ---------------------------------------------------------------------------

export interface ReviewViewRow {
  id: string;
  kind: ReviewKind;
  previous_verdict: CaseVerdict | null;
  new_verdict: CaseVerdict | null;
  comment: string;
  appeal_id: string | null;
  created_at: Date;
  reviewer_number: number | null;
}

export function toCaseReviewView(row: ReviewViewRow): CaseReviewView {
  return {
    id: row.id,
    kind: row.kind,
    reviewer: toReviewerRef(row.reviewer_number),
    previous_verdict: row.previous_verdict,
    new_verdict: row.new_verdict,
    comment: row.comment,
    appeal_id: row.appeal_id,
    created_at: row.created_at.toISOString(),
  };
}

export interface ConfirmationViewRow extends Pick<CaseServerConfirmationRow, 'id' | 'note' | 'revoke_reason'> {
  created_at: Date;
  revoked_at: Date | null;
  server_public_id: string;
  server_name: string;
  server_is_trusted: boolean;
  confirmed_by_id: string;
  confirmed_by_username: string;
}

export function toConfirmationView(row: ConfirmationViewRow): CaseConfirmationView {
  return {
    id: row.id,
    server: toServerRef({ server_id: row.server_public_id, name: row.server_name, is_trusted: row.server_is_trusted }),
    confirmed_by: toUserRef({ id: row.confirmed_by_id, username: row.confirmed_by_username }),
    note: row.note,
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
    revoke_reason: row.revoke_reason,
    active: row.revoked_at === null,
  };
}

// ---------------------------------------------------------------------------
// Case summaries
// ---------------------------------------------------------------------------

export interface CaseSummaryRow {
  case_number: string;
  status: CaseStatus;
  current_verdict: CaseVerdict;
  reason: string;
  created_at: Date;
  updated_at: Date;
  player_id_type: PlayerIdType;
  player_external_id: string;
  player_display_name: string | null;
  report_count: number;
  open_report_count: number;
  evidence_count: number;
  confirmed_servers: number;
}

export function toCaseSummary(row: CaseSummaryRow): CaseSummary {
  return {
    case_number: row.case_number,
    player: toPlayerSummary({
      id_type: row.player_id_type,
      external_id: row.player_external_id,
      display_name: row.player_display_name,
    }),
    status: row.status,
    verdict: row.current_verdict,
    reason: row.reason,
    report_count: Number(row.report_count),
    open_report_count: Number(row.open_report_count),
    evidence_count: Number(row.evidence_count),
    confirmed_servers: Number(row.confirmed_servers),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
