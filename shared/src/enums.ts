/**
 * All enumerations of the SCP:SL Trust Network (ARCHITECTURE §3, §4, §9.2).
 *
 * Pattern per enum:
 *   export const X = { UPPER: 'lower' } as const;   // named constants
 *   export type X = (typeof X)[keyof typeof X];      // union of wire values
 *   export const XS = [...]                          // ordered value tuple
 *   export const XSchema = z.enum(XS);               // zod validator
 *
 * Wire/DB values are lowercase snake_case. The only exception is AuditAction,
 * whose values are upper-case event names.
 * Value order is significant for the ordinal enums (documented per enum).
 */
import { z } from 'zod';

type EnumTuple<T extends Record<string, string>> = [T[keyof T], ...T[keyof T][]];

/** Ordered value tuple of an `as const` enum object (insertion order). */
function enumValues<const T extends Record<string, string>>(obj: T): EnumTuple<T> {
  return Object.freeze(Object.values(obj)) as unknown as EnumTuple<T>;
}

/** Index of `value` in an ordered enum tuple, or -1 when not a member (forward compatibility). */
function ordinal(values: readonly string[], value: string): number {
  return values.indexOf(value);
}

// ---------------------------------------------------------------------------
// Identity & access
// ---------------------------------------------------------------------------

/** Web user role; ascending privilege (see roleRank). */
export const UserRole = {
  PLAYER: 'player',
  SERVER_ADMIN: 'server_admin',
  REVIEWER: 'reviewer',
  MODERATOR: 'moderator',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES = enumValues(UserRole);
export const UserRoleSchema = z.enum(USER_ROLES);

export const UserStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = enumValues(UserStatus);
export const UserStatusSchema = z.enum(USER_STATUSES);

/** user_tokens.type (§4.1). */
export const UserTokenType = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
} as const;
export type UserTokenType = (typeof UserTokenType)[keyof typeof UserTokenType];
export const USER_TOKEN_TYPES = enumValues(UserTokenType);
export const UserTokenTypeSchema = z.enum(USER_TOKEN_TYPES);

/** sessions.revoked_reason (§4.1, §12.1). */
export const SessionRevokeReason = {
  LOGOUT: 'logout',
  USER_REVOKED: 'user_revoked',
  ADMIN_REVOKED: 'admin_revoked',
  PASSWORD_CHANGED: 'password_changed',
  PASSWORD_RESET: 'password_reset',
  MFA_CHANGED: 'mfa_changed',
  ROLE_CHANGED: 'role_changed',
  ACCOUNT_DISABLED: 'account_disabled',
} as const;
export type SessionRevokeReason = (typeof SessionRevokeReason)[keyof typeof SessionRevokeReason];
export const SESSION_REVOKE_REASONS = enumValues(SessionRevokeReason);
export const SessionRevokeReasonSchema = z.enum(SESSION_REVOKE_REASONS);

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

export const ServerStatus = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REVOKED: 'revoked',
} as const;
export type ServerStatus = (typeof ServerStatus)[keyof typeof ServerStatus];
export const SERVER_STATUSES = enumValues(ServerStatus);
export const ServerStatusSchema = z.enum(SERVER_STATUSES);

export const ServerKeyStatus = {
  ACTIVE: 'active',
  RETIRING: 'retiring',
  RETIRED: 'retired',
  REVOKED: 'revoked',
} as const;
export type ServerKeyStatus = (typeof ServerKeyStatus)[keyof typeof ServerKeyStatus];
export const SERVER_KEY_STATUSES = enumValues(ServerKeyStatus);
export const ServerKeyStatusSchema = z.enum(SERVER_KEY_STATUSES);

export const ServerMemberRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
} as const;
export type ServerMemberRole = (typeof ServerMemberRole)[keyof typeof ServerMemberRole];
export const SERVER_MEMBER_ROLES = enumValues(ServerMemberRole);
export const ServerMemberRoleSchema = z.enum(SERVER_MEMBER_ROLES);

// ---------------------------------------------------------------------------
// Players & signals
// ---------------------------------------------------------------------------

export const PlayerIdType = {
  STEAM: 'steam',
  DISCORD: 'discord',
  NORTHWOOD: 'northwood',
} as const;
export type PlayerIdType = (typeof PlayerIdType)[keyof typeof PlayerIdType];
export const PLAYER_ID_TYPES = enumValues(PlayerIdType);
export const PlayerIdTypeSchema = z.enum(PLAYER_ID_TYPES);

/** Aggregated player status; ascending priority (see globalStatusPriority). */
export const GlobalStatus = {
  NONE: 'none',
  REJECTED: 'rejected',
  INCONCLUSIVE: 'inconclusive',
  REPORTED: 'reported',
  UNDER_REVIEW: 'under_review',
  CONFIRMED: 'confirmed',
} as const;
export type GlobalStatus = (typeof GlobalStatus)[keyof typeof GlobalStatus];
export const GLOBAL_STATUSES = enumValues(GlobalStatus);
export const GlobalStatusSchema = z.enum(GLOBAL_STATUSES);

/** VPN detection confidence; ascending (see vpnConfidenceRank). */
export const VpnConfidence = {
  NOT_DETECTED: 'not_detected',
  POSSIBLE: 'possible',
  LIKELY: 'likely',
  CONFIRMED: 'confirmed',
} as const;
export type VpnConfidence = (typeof VpnConfidence)[keyof typeof VpnConfidence];
export const VPN_CONFIDENCES = enumValues(VpnConfidence);
export const VpnConfidenceSchema = z.enum(VPN_CONFIDENCES);

export const VpnType = {
  VPN: 'vpn',
  PROXY: 'proxy',
  TOR: 'tor',
  HOSTING: 'hosting',
  RELAY: 'relay',
  UNKNOWN: 'unknown',
} as const;
export type VpnType = (typeof VpnType)[keyof typeof VpnType];
export const VPN_TYPES = enumValues(VpnType);
export const VpnTypeSchema = z.enum(VPN_TYPES);

/** `vpn.error` value of the player check when providers failed (§6.4). */
export const VpnCheckError = {
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
} as const;
export type VpnCheckError = (typeof VpnCheckError)[keyof typeof VpnCheckError];
export const VPN_CHECK_ERRORS = enumValues(VpnCheckError);
export const VpnCheckErrorSchema = z.enum(VPN_CHECK_ERRORS);

/** Alt-account confidence; ascending (see altConfidenceRank). */
export const AltConfidence = {
  NONE: 'none',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const;
export type AltConfidence = (typeof AltConfidence)[keyof typeof AltConfidence];
export const ALT_CONFIDENCES = enumValues(AltConfidence);
export const AltConfidenceSchema = z.enum(ALT_CONFIDENCES);

export const AltSignal = {
  SAME_NETWORK_IDENTIFIER: 'same_network_identifier',
  SAME_NETWORK_PREFIX: 'same_network_prefix',
  LINKED_ACCOUNT_CONFIRMED_CASE: 'linked_account_confirmed_case',
  LINKED_ACCOUNT_RECENTLY_SEEN: 'linked_account_recently_seen',
  SHARED_NETWORK_MANY_ACCOUNTS: 'shared_network_many_accounts',
  NETWORK_IS_VPN: 'network_is_vpn',
} as const;
export type AltSignal = (typeof AltSignal)[keyof typeof AltSignal];
export const ALT_SIGNALS = enumValues(AltSignal);
export const AltSignalSchema = z.enum(ALT_SIGNALS);

export const AccountAgeSource = {
  STEAM: 'steam',
  SERVER_REPORTED: 'server_reported',
  UNKNOWN: 'unknown',
} as const;
export type AccountAgeSource = (typeof AccountAgeSource)[keyof typeof AccountAgeSource];
export const ACCOUNT_AGE_SOURCES = enumValues(AccountAgeSource);
export const AccountAgeSourceSchema = z.enum(ACCOUNT_AGE_SOURCES);

/** player_signals.signal (§4.4). */
export const PlayerSignalType = {
  VPN_DETECTED: 'vpn_detected',
  POSSIBLE_ALT_ACCOUNT: 'possible_alt_account',
  YOUNG_ACCOUNT: 'young_account',
} as const;
export type PlayerSignalType = (typeof PlayerSignalType)[keyof typeof PlayerSignalType];
export const PLAYER_SIGNAL_TYPES = enumValues(PlayerSignalType);
export const PlayerSignalTypeSchema = z.enum(PLAYER_SIGNAL_TYPES);

// ---------------------------------------------------------------------------
// Cases, reports, evidence, appeals
// ---------------------------------------------------------------------------

export const CaseVerdict = {
  UNKNOWN: 'unknown',
  INCONCLUSIVE: 'inconclusive',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
} as const;
export type CaseVerdict = (typeof CaseVerdict)[keyof typeof CaseVerdict];
export const CASE_VERDICTS = enumValues(CaseVerdict);
export const CaseVerdictSchema = z.enum(CASE_VERDICTS);

export const CaseStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  CLOSED: 'closed',
} as const;
export type CaseStatus = (typeof CaseStatus)[keyof typeof CaseStatus];
export const CASE_STATUSES = enumValues(CaseStatus);
export const CaseStatusSchema = z.enum(CASE_STATUSES);

/** reviews.kind (§4.5). */
export const ReviewKind = {
  REVIEW_STARTED: 'review_started',
  VERDICT_SET: 'verdict_set',
  NOTE: 'note',
  APPEAL_DECISION: 'appeal_decision',
  REOPENED: 'reopened',
} as const;
export type ReviewKind = (typeof ReviewKind)[keyof typeof ReviewKind];
export const REVIEW_KINDS = enumValues(ReviewKind);
export const ReviewKindSchema = z.enum(REVIEW_KINDS);

export const ReportStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  RESOLVED: 'resolved',
  REJECTED: 'rejected',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];
export const REPORT_STATUSES = enumValues(ReportStatus);
export const ReportStatusSchema = z.enum(REPORT_STATUSES);

export const ReporterType = {
  USER: 'user',
  SERVER: 'server',
} as const;
export type ReporterType = (typeof ReporterType)[keyof typeof ReporterType];
export const REPORTER_TYPES = enumValues(ReporterType);
export const ReporterTypeSchema = z.enum(REPORTER_TYPES);

export const EvidenceType = {
  VIDEO: 'video',
  IMAGE: 'image',
  LOG: 'log',
  DEMO: 'demo',
  TEXT: 'text',
  LINK: 'link',
  OTHER: 'other',
} as const;
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];
export const EVIDENCE_TYPES = enumValues(EvidenceType);
export const EvidenceTypeSchema = z.enum(EVIDENCE_TYPES);

/** Evidence overall status and each of the three independent assessments (R2). */
export const EvidenceStatus = {
  UNVERIFIED: 'unverified',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  INCONCLUSIVE: 'inconclusive',
} as const;
export type EvidenceStatus = (typeof EvidenceStatus)[keyof typeof EvidenceStatus];
export const EVIDENCE_STATUSES = enumValues(EvidenceStatus);
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES);

export const AppealStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  DECIDED: 'decided',
  WITHDRAWN: 'withdrawn',
} as const;
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus];
export const APPEAL_STATUSES = enumValues(AppealStatus);
export const AppealStatusSchema = z.enum(APPEAL_STATUSES);

export const AppealDecision = {
  CONFIRM: 'confirm',
  REVERSE: 'reverse',
  INCONCLUSIVE: 'inconclusive',
} as const;
export type AppealDecision = (typeof AppealDecision)[keyof typeof AppealDecision];
export const APPEAL_DECISIONS = enumValues(AppealDecision);
export const AppealDecisionSchema = z.enum(APPEAL_DECISIONS);

// ---------------------------------------------------------------------------
// Whitelist & bypasses
// ---------------------------------------------------------------------------

export const WhitelistRequestStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;
export type WhitelistRequestStatus = (typeof WhitelistRequestStatus)[keyof typeof WhitelistRequestStatus];
export const WHITELIST_REQUEST_STATUSES = enumValues(WhitelistRequestStatus);
export const WhitelistRequestStatusSchema = z.enum(WHITELIST_REQUEST_STATUSES);

export const WhitelistRequestType = {
  VPN_WHITELIST: 'vpn_whitelist',
  ACCOUNT_AGE_WHITELIST: 'account_age_whitelist',
} as const;
export type WhitelistRequestType = (typeof WhitelistRequestType)[keyof typeof WhitelistRequestType];
export const WHITELIST_REQUEST_TYPES = enumValues(WhitelistRequestType);
export const WhitelistRequestTypeSchema = z.enum(WHITELIST_REQUEST_TYPES);

/** Decision on a whitelist request (§11.6). */
export const WhitelistDecision = {
  APPROVE: 'approve',
  REJECT: 'reject',
} as const;
export type WhitelistDecision = (typeof WhitelistDecision)[keyof typeof WhitelistDecision];
export const WHITELIST_DECISIONS = enumValues(WhitelistDecision);
export const WhitelistDecisionSchema = z.enum(WHITELIST_DECISIONS);

export const BypassType = {
  VPN_WHITELIST: 'vpn_whitelist',
  ACCOUNT_AGE_WHITELIST: 'account_age_whitelist',
  ALT_ACCOUNT_WHITELIST: 'alt_account_whitelist',
  VERDICT_OVERRIDE: 'verdict_override',
} as const;
export type BypassType = (typeof BypassType)[keyof typeof BypassType];
export const BYPASS_TYPES = enumValues(BypassType);
export const BypassTypeSchema = z.enum(BYPASS_TYPES);

export const BypassScope = {
  SERVER: 'server',
  GLOBAL: 'global',
} as const;
export type BypassScope = (typeof BypassScope)[keyof typeof BypassScope];
export const BYPASS_SCOPES = enumValues(BypassScope);
export const BypassScopeSchema = z.enum(BYPASS_SCOPES);

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export const PolicySignal = {
  GLOBAL_VERDICT: 'global_verdict',
  ACCOUNT_AGE: 'account_age',
  VPN: 'vpn',
  ALT_ACCOUNT: 'alt_account',
  OPEN_REPORTS: 'open_reports',
} as const;
export type PolicySignal = (typeof PolicySignal)[keyof typeof PolicySignal];
export const POLICY_SIGNALS = enumValues(PolicySignal);
export const PolicySignalSchema = z.enum(POLICY_SIGNALS);

/** Local enforcement action; ascending severity 0–6 (see policyActionSeverity). */
export const PolicyAction = {
  ALLOW: 'allow',
  ADMIN_NOTIFY: 'admin_notify',
  WARN: 'warn',
  REQUIRE_REVIEW: 'require_review',
  REQUIRE_WHITELIST: 'require_whitelist',
  KICK: 'kick',
  BAN: 'ban',
} as const;
export type PolicyAction = (typeof PolicyAction)[keyof typeof PolicyAction];
export const POLICY_ACTIONS = enumValues(PolicyAction);
export const PolicyActionSchema = z.enum(POLICY_ACTIONS);

/** Subset of PolicyAction allowed for `backend_unavailable_action` (§4.3). */
export const BackendUnavailableAction = {
  ALLOW: 'allow',
  ADMIN_NOTIFY: 'admin_notify',
  KICK: 'kick',
} as const satisfies Record<string, PolicyAction>;
export type BackendUnavailableAction = (typeof BackendUnavailableAction)[keyof typeof BackendUnavailableAction];
export const BACKEND_UNAVAILABLE_ACTIONS = enumValues(BackendUnavailableAction);
export const BackendUnavailableActionSchema = z.enum(BACKEND_UNAVAILABLE_ACTIONS);

/** `reason_code` of an applied/bypassed rule in a PolicyDecision (§7.2). */
export const PolicyReasonCode = {
  GLOBAL_VERDICT_MATCH: 'global_verdict_match',
  ACCOUNT_AGE_BELOW_THRESHOLD: 'account_age_below_threshold',
  ACCOUNT_AGE_UNKNOWN: 'account_age_unknown',
  VPN_CONFIDENCE: 'vpn_confidence',
  ALT_ACCOUNT_CONFIDENCE: 'alt_account_confidence',
  OPEN_REPORTS_THRESHOLD: 'open_reports_threshold',
} as const;
export type PolicyReasonCode = (typeof PolicyReasonCode)[keyof typeof PolicyReasonCode];
export const POLICY_REASON_CODES = enumValues(PolicyReasonCode);
export const PolicyReasonCodeSchema = z.enum(POLICY_REASON_CODES);

// ---------------------------------------------------------------------------
// Overwatch
// ---------------------------------------------------------------------------

export const OverwatchSessionStatus = {
  ACTIVE: 'active',
  ENDED: 'ended',
  EXPIRED: 'expired',
} as const;
export type OverwatchSessionStatus = (typeof OverwatchSessionStatus)[keyof typeof OverwatchSessionStatus];
export const OVERWATCH_SESSION_STATUSES = enumValues(OverwatchSessionStatus);
export const OverwatchSessionStatusSchema = z.enum(OVERWATCH_SESSION_STATUSES);

/**
 * overwatch_sessions.end_reason. The first six are sent by the plugin (§10.1);
 * `heartbeat_timeout` is only set by the backend expiry job.
 */
export const OverwatchEndReason = {
  TARGET_CHANGED: 'target_changed',
  OVERWATCH_DISABLED: 'overwatch_disabled',
  SPECTATOR_LEFT: 'spectator_left',
  TARGET_LEFT: 'target_left',
  ROUND_ENDED: 'round_ended',
  MANUAL: 'manual',
  HEARTBEAT_TIMEOUT: 'heartbeat_timeout',
} as const;
export type OverwatchEndReason = (typeof OverwatchEndReason)[keyof typeof OverwatchEndReason];
export const OVERWATCH_END_REASONS = enumValues(OverwatchEndReason);
export const OverwatchEndReasonSchema = z.enum(OVERWATCH_END_REASONS);

/** End reasons a plugin may submit (excludes backend-only `heartbeat_timeout`). */
export const PLUGIN_OVERWATCH_END_REASONS = OVERWATCH_END_REASONS.filter(
  (reason) => reason !== OverwatchEndReason.HEARTBEAT_TIMEOUT,
) as [Exclude<OverwatchEndReason, 'heartbeat_timeout'>, ...Exclude<OverwatchEndReason, 'heartbeat_timeout'>[]];
export type PluginOverwatchEndReason = (typeof PLUGIN_OVERWATCH_END_REASONS)[number];
export const PluginOverwatchEndReasonSchema = z.enum(PLUGIN_OVERWATCH_END_REASONS);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const ActorType = {
  USER: 'user',
  SERVER: 'server',
  SYSTEM: 'system',
  PLAYER: 'player',
} as const;
export type ActorType = (typeof ActorType)[keyof typeof ActorType];
export const ACTOR_TYPES = enumValues(ActorType);
export const ActorTypeSchema = z.enum(ACTOR_TYPES);

/** Audit event names (§9.2). Values are the upper-case names themselves. */
export const AuditAction = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_EMAIL_VERIFIED: 'USER_EMAIL_VERIFIED',
  USER_LOGIN_SUCCEEDED: 'USER_LOGIN_SUCCEEDED',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOCKED: 'USER_LOCKED',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_PASSWORD_CHANGED: 'USER_PASSWORD_CHANGED',
  USER_PASSWORD_RESET_REQUESTED: 'USER_PASSWORD_RESET_REQUESTED',
  USER_PASSWORD_RESET: 'USER_PASSWORD_RESET',
  USER_2FA_ENABLED: 'USER_2FA_ENABLED',
  USER_2FA_DISABLED: 'USER_2FA_DISABLED',
  USER_RECOVERY_CODE_USED: 'USER_RECOVERY_CODE_USED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PLAYER_LINKED: 'PLAYER_LINKED',
  PLAYER_UNLINKED: 'PLAYER_UNLINKED',
  SERVER_CREATED: 'SERVER_CREATED',
  SERVER_REGISTRATION_TOKEN_CREATED: 'SERVER_REGISTRATION_TOKEN_CREATED',
  SERVER_REGISTERED: 'SERVER_REGISTERED',
  SERVER_UPDATED: 'SERVER_UPDATED',
  SERVER_STATUS_CHANGED: 'SERVER_STATUS_CHANGED',
  SERVER_TRUST_CHANGED: 'SERVER_TRUST_CHANGED',
  SERVER_MEMBER_ADDED: 'SERVER_MEMBER_ADDED',
  SERVER_MEMBER_REMOVED: 'SERVER_MEMBER_REMOVED',
  SERVER_KEY_ROTATED: 'SERVER_KEY_ROTATED',
  SERVER_KEY_REVOKED: 'SERVER_KEY_REVOKED',
  SERVER_KEY_ROTATION_REQUESTED: 'SERVER_KEY_ROTATION_REQUESTED',
  POLICY_UPDATED: 'POLICY_UPDATED',
  CASE_CREATED: 'CASE_CREATED',
  CASE_UPDATED: 'CASE_UPDATED',
  REVIEW_STARTED: 'REVIEW_STARTED',
  CASE_NOTE_ADDED: 'CASE_NOTE_ADDED',
  VERDICT_CHANGED: 'VERDICT_CHANGED',
  CASE_REOPENED: 'CASE_REOPENED',
  CASE_CONFIRMED_BY_SERVER: 'CASE_CONFIRMED_BY_SERVER',
  CASE_CONFIRMATION_REVOKED: 'CASE_CONFIRMATION_REVOKED',
  REPORT_CREATED: 'REPORT_CREATED',
  REPORT_STATUS_CHANGED: 'REPORT_STATUS_CHANGED',
  EVIDENCE_UPLOADED: 'EVIDENCE_UPLOADED',
  EVIDENCE_REVIEWED: 'EVIDENCE_REVIEWED',
  EVIDENCE_VERIFIED: 'EVIDENCE_VERIFIED',
  EVIDENCE_REJECTED: 'EVIDENCE_REJECTED',
  EVIDENCE_SUPERSEDED: 'EVIDENCE_SUPERSEDED',
  EVIDENCE_ACCESSED: 'EVIDENCE_ACCESSED',
  APPEAL_CREATED: 'APPEAL_CREATED',
  APPEAL_ASSIGNED: 'APPEAL_ASSIGNED',
  APPEAL_RESOLVED: 'APPEAL_RESOLVED',
  APPEAL_WITHDRAWN: 'APPEAL_WITHDRAWN',
  BYPASS_REQUESTED: 'BYPASS_REQUESTED',
  BYPASS_APPROVED: 'BYPASS_APPROVED',
  BYPASS_REJECTED: 'BYPASS_REJECTED',
  BYPASS_REVOKED: 'BYPASS_REVOKED',
  BYPASS_EXPIRED: 'BYPASS_EXPIRED',
  BYPASS_CREATED: 'BYPASS_CREATED',
  WHITELIST_REQUEST_EXPIRED: 'WHITELIST_REQUEST_EXPIRED',
  OVERWATCH_SESSION_STARTED: 'OVERWATCH_SESSION_STARTED',
  OVERWATCH_SESSION_ENDED: 'OVERWATCH_SESSION_ENDED',
  PROOF_VERIFIED: 'PROOF_VERIFIED',
  AUDIT_CHAIN_VERIFIED: 'AUDIT_CHAIN_VERIFIED',
  SECURITY_SOURCE_BLOCKED: 'SECURITY_SOURCE_BLOCKED',
  SECURITY_SOURCE_UNBLOCKED: 'SECURITY_SOURCE_UNBLOCKED',
  SECURITY_THRESHOLD_EXCEEDED: 'SECURITY_THRESHOLD_EXCEEDED',
  RETENTION_RUN: 'RETENTION_RUN',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
export const AUDIT_ACTIONS = enumValues(AuditAction);
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

/**
 * Recommended audit_events.target_type values. The column is free text for
 * forward compatibility; views therefore accept any string.
 */
export const AuditTargetType = {
  USER: 'user',
  SESSION: 'session',
  PLAYER: 'player',
  SERVER: 'server',
  SERVER_KEY: 'server_key',
  SERVER_MEMBER: 'server_member',
  SERVER_POLICY: 'server_policy',
  CASE: 'case',
  REPORT: 'report',
  EVIDENCE: 'evidence',
  APPEAL: 'appeal',
  WHITELIST_REQUEST: 'whitelist_request',
  BYPASS: 'bypass',
  OVERWATCH_SESSION: 'overwatch_session',
  AUDIT_LOG: 'audit_log',
  SYSTEM: 'system',
} as const;
export type AuditTargetType = (typeof AuditTargetType)[keyof typeof AuditTargetType];
export const AUDIT_TARGET_TYPES = enumValues(AuditTargetType);
export const AuditTargetTypeSchema = z.enum(AUDIT_TARGET_TYPES);

/** Why an audit-chain verification failed (§9.1). */
export const AuditVerifyFailure = {
  HASH_MISMATCH: 'hash_mismatch',
  PREV_HASH_MISMATCH: 'prev_hash_mismatch',
} as const;
export type AuditVerifyFailure = (typeof AuditVerifyFailure)[keyof typeof AuditVerifyFailure];
export const AUDIT_VERIFY_FAILURES = enumValues(AuditVerifyFailure);
export const AuditVerifyFailureSchema = z.enum(AUDIT_VERIFY_FAILURES);

// ---------------------------------------------------------------------------
// Security monitoring (server-side intrusion detection & anomaly flagging)
// ---------------------------------------------------------------------------

/**
 * Kind of a recorded `security_events` row. Detection kinds describe a signal or a
 * crossed threshold; `anomaly` is a heuristic review item (never auto-punishing).
 */
export const SecurityEventKind = {
  AUTH_FAILURE_BURST: 'auth_failure_burst',
  REQUEST_BURST: 'request_burst',
  INVALID_SIGNATURE: 'invalid_signature',
  REPLAYED_NONCE: 'replayed_nonce',
  DUPLICATE_REQUEST_ID: 'duplicate_request_id',
  CSRF_FAILURE: 'csrf_failure',
  MALFORMED_AUTH: 'malformed_auth',
  INJECTION_PROBE: 'injection_probe',
  SCANNER_USER_AGENT: 'scanner_user_agent',
  THRESHOLD_EXCEEDED: 'threshold_exceeded',
  SOURCE_BLOCKED: 'source_blocked',
  SOURCE_UNBLOCKED: 'source_unblocked',
  ANOMALY: 'anomaly',
} as const;
export type SecurityEventKind = (typeof SecurityEventKind)[keyof typeof SecurityEventKind];
export const SECURITY_EVENT_KINDS = enumValues(SecurityEventKind);
export const SecurityEventKindSchema = z.enum(SECURITY_EVENT_KINDS);

/** Severity of a security event; ascending (see securitySeverityRank). */
export const SecuritySeverity = {
  INFO: 'info',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type SecuritySeverity = (typeof SecuritySeverity)[keyof typeof SecuritySeverity];
export const SECURITY_SEVERITIES = enumValues(SecuritySeverity);
export const SecuritySeveritySchema = z.enum(SECURITY_SEVERITIES);

/** Privacy-preserving source identity of a signal/block (never a raw IP). */
export const SecuritySourceType = {
  /** HMAC network hash of anonymous traffic. */
  NETWORK: 'network',
  /** Authenticated web user id. */
  USER: 'user',
  /** Signed plugin server id. */
  SERVER: 'server',
  UNKNOWN: 'unknown',
} as const;
export type SecuritySourceType = (typeof SecuritySourceType)[keyof typeof SecuritySourceType];
export const SECURITY_SOURCE_TYPES = enumValues(SecuritySourceType);
export const SecuritySourceTypeSchema = z.enum(SECURITY_SOURCE_TYPES);

/** What the detector did about a source when the event was recorded. */
export const SecurityActionTaken = {
  NONE: 'none',
  /** Surfaced for human review (anomalies); no request impact. */
  FLAGGED: 'flagged',
  /** The request was answered with 429/403 because the source is blocked. */
  THROTTLED: 'throttled',
  /** A transient block was placed on the source. */
  BLOCKED: 'blocked',
  /** A block was cleared (auto-expiry is not recorded; only admin clears). */
  UNBLOCKED: 'unblocked',
} as const;
export type SecurityActionTaken = (typeof SecurityActionTaken)[keyof typeof SecurityActionTaken];
export const SECURITY_ACTIONS_TAKEN = enumValues(SecurityActionTaken);
export const SecurityActionTakenSchema = z.enum(SECURITY_ACTIONS_TAKEN);

/** info 0 … critical 4. */
export function securitySeverityRank(severity: SecuritySeverity): number {
  return ordinal(SECURITY_SEVERITIES, severity);
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** True when `value` is one of the given enum values. */
export function isEnumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isUserRole = (value: unknown): value is UserRole => isEnumValue(USER_ROLES, value);
export const isPolicySignal = (value: unknown): value is PolicySignal => isEnumValue(POLICY_SIGNALS, value);
export const isPolicyAction = (value: unknown): value is PolicyAction => isEnumValue(POLICY_ACTIONS, value);
export const isBypassType = (value: unknown): value is BypassType => isEnumValue(BYPASS_TYPES, value);
export const isPlayerIdType = (value: unknown): value is PlayerIdType => isEnumValue(PLAYER_ID_TYPES, value);
export const isAuditAction = (value: unknown): value is AuditAction => isEnumValue(AUDIT_ACTIONS, value);

// ---------------------------------------------------------------------------
// Ordinal helpers (all return -1 for values outside the enum)
// ---------------------------------------------------------------------------

/** Severity 0 (allow) … 6 (ban). */
export function policyActionSeverity(action: PolicyAction): number {
  return ordinal(POLICY_ACTIONS, action);
}

/** Comparator by severity (negative when `a` is less severe than `b`). */
export function comparePolicyActions(a: PolicyAction, b: PolicyAction): number {
  return policyActionSeverity(a) - policyActionSeverity(b);
}

/** Most severe action of the list; `allow` for an empty list. */
export function maxPolicyAction(actions: Iterable<PolicyAction>): PolicyAction {
  let winner: PolicyAction = PolicyAction.ALLOW;
  for (const action of actions) {
    if (policyActionSeverity(action) > policyActionSeverity(winner)) winner = action;
  }
  return winner;
}

/** not_detected 0 … confirmed 3. */
export function vpnConfidenceRank(confidence: VpnConfidence): number {
  return ordinal(VPN_CONFIDENCES, confidence);
}

/** none 0 … high 3. */
export function altConfidenceRank(confidence: AltConfidence): number {
  return ordinal(ALT_CONFIDENCES, confidence);
}

/** none 0 … confirmed 5. */
export function globalStatusPriority(status: GlobalStatus): number {
  return ordinal(GLOBAL_STATUSES, status);
}

/** player 0 … super_admin 5. */
export function roleRank(role: UserRole): number {
  return ordinal(USER_ROLES, role);
}

// ---------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------

/** Bypass type that exempts a matching rule of each signal (§7.2 step 2). */
export const BYPASS_TYPE_FOR_SIGNAL = Object.freeze({
  global_verdict: 'verdict_override',
  account_age: 'account_age_whitelist',
  vpn: 'vpn_whitelist',
  alt_account: 'alt_account_whitelist',
  open_reports: 'verdict_override',
} as const satisfies Record<PolicySignal, BypassType>);

/** Bypass type created when a whitelist request of each type is approved (§11.6). */
export const BYPASS_TYPE_FOR_WHITELIST_REQUEST = Object.freeze({
  vpn_whitelist: 'vpn_whitelist',
  account_age_whitelist: 'account_age_whitelist',
} as const satisfies Record<WhitelistRequestType, BypassType>);
