/**
 * Realistic response fixtures for the moderation pages (shapes follow the shared zod schemas).
 */
import type {
  AppealView,
  AuditEventSummary,
  CasePublicView,
  CaseReviewView,
  CaseStaffView,
  EvidenceDetail,
  EvidenceView,
  ProofResponse,
  ReportView,
} from '@scpsl-trust/shared';

import { USER_ID } from './helpers';

export const CASE_NUMBER = 'CASE-2026-000001';
export const PLAYER_USER_ID = '76561198000000001@steam';
export const SPECTATOR_USER_ID = '76561198000000002@steam';
export const SERVER_ID = 'srv_7k4x92m8pq174kf9';
export const CASE_ID = '0a1b2c3d-1111-4111-8111-000000000001';
export const REPORT_ID = '0a1b2c3d-2222-4222-8222-000000000002';
export const EVIDENCE_ID = '0a1b2c3d-3333-4333-8333-000000000003';
export const EVIDENCE_ID_2 = '0a1b2c3d-3333-4333-8333-000000000004';
export const SESSION_ID = '0a1b2c3d-4444-4444-8444-000000000004';
export const REVIEW_ID = '0a1b2c3d-5555-4555-8555-000000000005';
export const APPEAL_ID = '0a1b2c3d-6666-4666-8666-000000000006';
export const OTHER_USER_ID = '0a1b2c3d-7777-4777-8777-000000000007';
export const SHA256 = 'a'.repeat(64);

const T0 = '2026-09-20T10:00:00.000Z';
const T1 = '2026-09-21T10:00:00.000Z';

export const player = { user_id: PLAYER_USER_ID, type: 'steam' as const, id: '76561198000000001', display_name: 'Suspect' };
export const server = { server_id: SERVER_ID, name: 'Alpha Server', is_trusted: true };
export const reporter = { id: OTHER_USER_ID, username: 'witness' };
export const reviewer = { reviewer_number: 184, pseudonym: 'Reviewer #184' };

export function fakeReport(overrides: Partial<ReportView> = {}): ReportView {
  return {
    id: REPORT_ID,
    case_number: CASE_NUMBER,
    player,
    server,
    reporter_type: 'user',
    reporter_user: reporter,
    reporter_player: null,
    reason: 'Aimbot on Surface',
    description: 'Snapped onto three players through smoke.',
    status: 'open',
    resolution_note: null,
    resolved_by: null,
    resolved_at: null,
    evidence_count: 1,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function fakeEvidence(overrides: Partial<EvidenceView> = {}): EvidenceView {
  return {
    id: EVIDENCE_ID,
    case_number: CASE_NUMBER,
    report_id: REPORT_ID,
    type: 'video',
    title: 'Round 3 recording',
    description: 'Clip from 15:42 UTC',
    sha256: SHA256,
    size_bytes: 12_345_678,
    mime_type: 'video/mp4',
    original_filename: 'round3.mp4',
    external_url: null,
    uploaded_at: T0,
    uploader_user: reporter,
    uploader_server: null,
    overwatch_session_id: SESSION_ID,
    supersedes_evidence_id: null,
    superseded_by_evidence_id: null,
    status: 'unverified',
    identity_status: 'unverified',
    authenticity_status: 'unverified',
    cheating_status: 'unverified',
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function fakeEvidenceDetail(overrides: Partial<EvidenceDetail> = {}): EvidenceDetail {
  return { ...fakeEvidence(), reviews: [], integrity: null, ...overrides };
}

export function fakeReview(overrides: Partial<CaseReviewView> = {}): CaseReviewView {
  return {
    id: REVIEW_ID,
    kind: 'review_started',
    reviewer,
    previous_verdict: null,
    new_verdict: null,
    comment: 'Taking this one.',
    appeal_id: null,
    created_at: T1,
    ...overrides,
  };
}

export function fakeAppeal(overrides: Partial<AppealView> = {}): AppealView {
  return {
    id: APPEAL_ID,
    case_number: CASE_NUMBER,
    player,
    submitted_by: { id: USER_ID, username: 'testuser' },
    statement: 'I did not cheat, my monitor was just very large.',
    status: 'open',
    assigned_reviewer: null,
    decision: null,
    decision_reason: null,
    decided_by: null,
    decided_at: null,
    conflict_override: false,
    created_at: T1,
    updated_at: T1,
    ...overrides,
  };
}

export function fakeAuditEvent(overrides: Partial<AuditEventSummary> = {}): AuditEventSummary {
  return {
    seq: 1,
    event_id: '0a1b2c3d-8888-4888-8888-000000000008',
    created_at: T0,
    action: 'REPORT_CREATED',
    actor_type: 'user',
    actor_label: 'witness',
    target_type: 'report',
    target_id: REPORT_ID,
    ...overrides,
  };
}

export function fakeCase(overrides: Partial<CaseStaffView> = {}): CaseStaffView {
  return {
    id: CASE_ID,
    case_number: CASE_NUMBER,
    player,
    status: 'open',
    verdict: 'unknown',
    reason: 'Reported for aimbot',
    public_summary: null,
    verdict_set_by: null,
    verdict_set_at: null,
    closed_at: null,
    created_at: T0,
    updated_at: T1,
    confirmed_servers: 1,
    independent_confirmed_servers: 1,
    reports: [fakeReport()],
    evidence: [fakeEvidence()],
    reviews: [fakeReview()],
    appeals: [],
    confirmations: [
      {
        id: '0a1b2c3d-9999-4999-8999-000000000009',
        server,
        confirmed_by: reporter,
        note: 'Seen it ourselves.',
        created_at: T1,
        revoked_at: null,
        revoke_reason: null,
        active: true,
      },
    ],
    history: [fakeAuditEvent(), fakeAuditEvent({ seq: 2, action: 'EVIDENCE_UPLOADED', target_type: 'evidence', target_id: EVIDENCE_ID, created_at: T1 })],
    ...overrides,
  };
}

export function fakePublicCase(overrides: Partial<CasePublicView> = {}): CasePublicView {
  return {
    case_number: CASE_NUMBER,
    player: { user_id: PLAYER_USER_ID, display_name: 'Suspect' },
    status: 'closed',
    verdict: 'confirmed',
    public_summary: 'Verified recording shows aim assistance.',
    verdict_set_at: T1,
    report_count: 3,
    evidence_count: 2,
    verified_evidence_count: 1,
    confirmed_servers: 2,
    appeal_status: null,
    created_at: T0,
    updated_at: T1,
    ...overrides,
  };
}

export function fakeProof(overrides: Partial<ProofResponse> = {}): ProofResponse {
  return {
    valid: true,
    server_id: SERVER_ID,
    player_id: PLAYER_USER_ID,
    spectator_id: SPECTATOR_USER_ID,
    session_id: SESSION_ID,
    timestamp_window: { start: '2026-09-20T15:42:20.000Z', end: '2026-09-20T15:42:30.000Z' },
    window_offset: 0,
    ...overrides,
  };
}
