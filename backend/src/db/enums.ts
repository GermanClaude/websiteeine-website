/**
 * Allowed values of every enum-like text column, exactly as written in the
 * CHECK constraints of the SQL migrations (ARCHITECTURE §3, lowercase snake_case).
 * Exception: audit_action holds the upper-case event names of §9.2
 * (REPORT_CREATED, ...), matching shared/src/enums.ts and the audit-chain vectors.
 *
 * The DB layer intentionally does not import @scpsl-trust/shared; these unions
 * are structurally identical to the shared enums. tests/db/enums.test.ts
 * verifies them against the live CHECK constraints.
 */
export const DB_ENUMS = {
  user_role: ['player', 'server_admin', 'reviewer', 'moderator', 'admin', 'super_admin'],
  user_status: ['active', 'disabled'],
  user_token_type: ['email_verification', 'password_reset'],
  server_status: ['pending', 'active', 'suspended', 'revoked'],
  server_member_role: ['owner', 'admin', 'moderator'],
  server_key_status: ['active', 'retiring', 'retired', 'revoked'],
  backend_unavailable_action: ['allow', 'admin_notify', 'kick'],
  policy_signal: ['global_verdict', 'account_age', 'vpn', 'alt_account', 'open_reports'],
  policy_action: ['allow', 'admin_notify', 'warn', 'require_review', 'require_whitelist', 'kick', 'ban'],
  global_status: ['none', 'rejected', 'inconclusive', 'reported', 'under_review', 'confirmed'],
  vpn_confidence: ['not_detected', 'possible', 'likely', 'confirmed'],
  alt_confidence: ['none', 'low', 'medium', 'high'],
  alt_signal: [
    'same_network_identifier',
    'same_network_prefix',
    'linked_account_confirmed_case',
    'linked_account_recently_seen',
    'shared_network_many_accounts',
    'network_is_vpn',
  ],
  player_id_type: ['steam', 'discord', 'northwood'],
  account_age_source: ['steam', 'server_reported', 'unknown'],
  player_signal_type: ['vpn_detected', 'possible_alt_account', 'young_account'],
  player_signal_confidence: ['not_detected', 'possible', 'likely', 'confirmed', 'none', 'low', 'medium', 'high'],
  case_verdict: ['unknown', 'inconclusive', 'confirmed', 'rejected'],
  case_status: ['open', 'under_review', 'closed'],
  report_status: ['open', 'under_review', 'resolved', 'rejected'],
  reporter_type: ['user', 'server'],
  review_kind: ['review_started', 'verdict_set', 'note', 'appeal_decision', 'reopened'],
  evidence_type: ['video', 'image', 'log', 'demo', 'text', 'link', 'other'],
  evidence_status: ['unverified', 'verified', 'rejected', 'inconclusive'],
  overwatch_session_status: ['active', 'ended', 'expired'],
  appeal_status: ['open', 'under_review', 'decided', 'withdrawn'],
  appeal_decision: ['confirm', 'reverse', 'inconclusive'],
  whitelist_request_type: ['vpn_whitelist', 'account_age_whitelist'],
  whitelist_request_status: ['pending', 'approved', 'rejected', 'expired', 'revoked'],
  bypass_type: ['vpn_whitelist', 'account_age_whitelist', 'alt_account_whitelist', 'verdict_override'],
  bypass_scope: ['server', 'global'],
  actor_type: ['user', 'server', 'system', 'player'],
  audit_action: [
    'USER_REGISTERED',
    'USER_EMAIL_VERIFIED',
    'USER_LOGIN_SUCCEEDED',
    'USER_LOGIN_FAILED',
    'USER_LOCKED',
    'USER_LOGOUT',
    'USER_PASSWORD_CHANGED',
    'USER_PASSWORD_RESET_REQUESTED',
    'USER_PASSWORD_RESET',
    'USER_2FA_ENABLED',
    'USER_2FA_DISABLED',
    'USER_RECOVERY_CODE_USED',
    'USER_ROLE_CHANGED',
    'USER_STATUS_CHANGED',
    'SESSION_REVOKED',
    'PLAYER_LINKED',
    'PLAYER_UNLINKED',
    'SERVER_CREATED',
    'SERVER_REGISTRATION_TOKEN_CREATED',
    'SERVER_REGISTERED',
    'SERVER_UPDATED',
    'SERVER_STATUS_CHANGED',
    'SERVER_TRUST_CHANGED',
    'SERVER_MEMBER_ADDED',
    'SERVER_MEMBER_REMOVED',
    'SERVER_KEY_ROTATED',
    'SERVER_KEY_REVOKED',
    'SERVER_KEY_ROTATION_REQUESTED',
    'POLICY_UPDATED',
    'CASE_CREATED',
    'CASE_UPDATED',
    'REVIEW_STARTED',
    'CASE_NOTE_ADDED',
    'VERDICT_CHANGED',
    'CASE_REOPENED',
    'CASE_CONFIRMED_BY_SERVER',
    'CASE_CONFIRMATION_REVOKED',
    'REPORT_CREATED',
    'REPORT_STATUS_CHANGED',
    'EVIDENCE_UPLOADED',
    'EVIDENCE_REVIEWED',
    'EVIDENCE_VERIFIED',
    'EVIDENCE_REJECTED',
    'EVIDENCE_SUPERSEDED',
    'EVIDENCE_ACCESSED',
    'APPEAL_CREATED',
    'APPEAL_ASSIGNED',
    'APPEAL_RESOLVED',
    'APPEAL_WITHDRAWN',
    'BYPASS_REQUESTED',
    'BYPASS_APPROVED',
    'BYPASS_REJECTED',
    'BYPASS_REVOKED',
    'BYPASS_EXPIRED',
    'BYPASS_CREATED',
    'WHITELIST_REQUEST_EXPIRED',
    'OVERWATCH_SESSION_STARTED',
    'OVERWATCH_SESSION_ENDED',
    'PROOF_VERIFIED',
    'AUDIT_CHAIN_VERIFIED',
    'RETENTION_RUN',
  ],
  job_run_result: ['running', 'succeeded', 'failed', 'skipped'],
} as const;

export type DbEnumName = keyof typeof DB_ENUMS;
export type DbEnumValue<N extends DbEnumName> = (typeof DB_ENUMS)[N][number];

export type UserRole = DbEnumValue<'user_role'>;
export type UserStatus = DbEnumValue<'user_status'>;
export type UserTokenType = DbEnumValue<'user_token_type'>;
export type ServerStatus = DbEnumValue<'server_status'>;
export type ServerMemberRole = DbEnumValue<'server_member_role'>;
export type ServerKeyStatus = DbEnumValue<'server_key_status'>;
export type BackendUnavailableAction = DbEnumValue<'backend_unavailable_action'>;
export type PolicySignal = DbEnumValue<'policy_signal'>;
export type PolicyAction = DbEnumValue<'policy_action'>;
export type GlobalStatus = DbEnumValue<'global_status'>;
export type VpnConfidence = DbEnumValue<'vpn_confidence'>;
export type AltConfidence = DbEnumValue<'alt_confidence'>;
export type AltSignal = DbEnumValue<'alt_signal'>;
export type PlayerIdType = DbEnumValue<'player_id_type'>;
export type AccountAgeSource = DbEnumValue<'account_age_source'>;
export type PlayerSignalType = DbEnumValue<'player_signal_type'>;
export type PlayerSignalConfidence = DbEnumValue<'player_signal_confidence'>;
export type CaseVerdict = DbEnumValue<'case_verdict'>;
export type CaseStatus = DbEnumValue<'case_status'>;
export type ReportStatus = DbEnumValue<'report_status'>;
export type ReporterType = DbEnumValue<'reporter_type'>;
export type ReviewKind = DbEnumValue<'review_kind'>;
export type EvidenceType = DbEnumValue<'evidence_type'>;
export type EvidenceStatus = DbEnumValue<'evidence_status'>;
export type OverwatchSessionStatus = DbEnumValue<'overwatch_session_status'>;
export type AppealStatus = DbEnumValue<'appeal_status'>;
export type AppealDecision = DbEnumValue<'appeal_decision'>;
export type WhitelistRequestType = DbEnumValue<'whitelist_request_type'>;
export type WhitelistRequestStatus = DbEnumValue<'whitelist_request_status'>;
export type BypassType = DbEnumValue<'bypass_type'>;
export type BypassScope = DbEnumValue<'bypass_scope'>;
export type ActorType = DbEnumValue<'actor_type'>;
export type AuditAction = DbEnumValue<'audit_action'>;
export type JobRunResult = DbEnumValue<'job_run_result'>;
