/**
 * Badge with a consistent tone for every enum value of the shared package.
 * Unknown values (newer backends) fall back to the neutral tone.
 */
import {
  ACCOUNT_AGE_SOURCES,
  ACTOR_TYPES,
  ALT_CONFIDENCES,
  ALT_SIGNALS,
  APPEAL_DECISIONS,
  APPEAL_STATUSES,
  AUDIT_ACTIONS,
  AUDIT_VERIFY_FAILURES,
  BACKEND_UNAVAILABLE_ACTIONS,
  BYPASS_SCOPES,
  BYPASS_TYPES,
  CASE_STATUSES,
  CASE_VERDICTS,
  EVIDENCE_STATUSES,
  EVIDENCE_TYPES,
  GLOBAL_STATUSES,
  OVERWATCH_END_REASONS,
  OVERWATCH_SESSION_STATUSES,
  PLAYER_ID_TYPES,
  PLAYER_SIGNAL_TYPES,
  POLICY_ACTIONS,
  POLICY_SIGNALS,
  REPORTER_TYPES,
  REPORT_STATUSES,
  REVIEW_KINDS,
  SERVER_KEY_STATUSES,
  SERVER_MEMBER_ROLES,
  SERVER_STATUSES,
  SESSION_REVOKE_REASONS,
  USER_ROLES,
  USER_STATUSES,
  VPN_CONFIDENCES,
  VPN_TYPES,
  WHITELIST_DECISIONS,
  WHITELIST_REQUEST_STATUSES,
  WHITELIST_REQUEST_TYPES,
  type AccountAgeSource,
  type ActorType,
  type AltConfidence,
  type AltSignal,
  type AppealDecision,
  type AppealStatus,
  type AuditVerifyFailure,
  type BackendUnavailableAction,
  type BypassScope,
  type BypassType,
  type CaseStatus,
  type CaseVerdict,
  type EvidenceStatus,
  type EvidenceType,
  type GlobalStatus,
  type OverwatchEndReason,
  type OverwatchSessionStatus,
  type PlayerIdType,
  type PlayerSignalType,
  type PolicyAction,
  type PolicySignal,
  type ReportStatus,
  type ReporterType,
  type ReviewKind,
  type ServerKeyStatus,
  type ServerMemberRole,
  type ServerStatus,
  type SessionRevokeReason,
  type UserRole,
  type UserStatus,
  type VpnConfidence,
  type VpnType,
  type WhitelistDecision,
  type WhitelistRequestStatus,
  type WhitelistRequestType,
} from '@scpsl-trust/shared';

import { Badge, type BadgeTone } from './Badge';

const TONES = {
  verdict: {
    unknown: 'muted',
    inconclusive: 'warning',
    confirmed: 'danger',
    rejected: 'success',
  } satisfies Record<CaseVerdict, BadgeTone>,
  caseStatus: { open: 'info', under_review: 'warning', closed: 'muted' } satisfies Record<CaseStatus, BadgeTone>,
  reportStatus: {
    open: 'info',
    under_review: 'warning',
    resolved: 'success',
    rejected: 'muted',
  } satisfies Record<ReportStatus, BadgeTone>,
  reporterType: { user: 'info', server: 'accent' } satisfies Record<ReporterType, BadgeTone>,
  evidenceStatus: {
    unverified: 'neutral',
    verified: 'success',
    rejected: 'danger',
    inconclusive: 'warning',
  } satisfies Record<EvidenceStatus, BadgeTone>,
  evidenceType: {
    video: 'info',
    image: 'info',
    log: 'neutral',
    demo: 'accent',
    text: 'neutral',
    link: 'accent',
    other: 'muted',
  } satisfies Record<EvidenceType, BadgeTone>,
  appealStatus: {
    open: 'info',
    under_review: 'warning',
    decided: 'success',
    withdrawn: 'muted',
  } satisfies Record<AppealStatus, BadgeTone>,
  appealDecision: { confirm: 'danger', reverse: 'success', inconclusive: 'warning' } satisfies Record<
    AppealDecision,
    BadgeTone
  >,
  whitelistStatus: {
    pending: 'warning',
    approved: 'success',
    rejected: 'danger',
    expired: 'muted',
    revoked: 'danger',
  } satisfies Record<WhitelistRequestStatus, BadgeTone>,
  whitelistType: { vpn_whitelist: 'info', account_age_whitelist: 'accent' } satisfies Record<
    WhitelistRequestType,
    BadgeTone
  >,
  whitelistDecision: { approve: 'success', reject: 'danger' } satisfies Record<WhitelistDecision, BadgeTone>,
  bypassType: {
    vpn_whitelist: 'info',
    account_age_whitelist: 'accent',
    alt_account_whitelist: 'warning',
    verdict_override: 'danger',
  } satisfies Record<BypassType, BadgeTone>,
  bypassScope: { server: 'neutral', global: 'accent' } satisfies Record<BypassScope, BadgeTone>,
  serverStatus: {
    pending: 'warning',
    active: 'success',
    suspended: 'warning',
    revoked: 'danger',
  } satisfies Record<ServerStatus, BadgeTone>,
  serverKeyStatus: {
    active: 'success',
    retiring: 'warning',
    retired: 'muted',
    revoked: 'danger',
  } satisfies Record<ServerKeyStatus, BadgeTone>,
  serverMemberRole: { owner: 'accent', admin: 'info', moderator: 'neutral' } satisfies Record<ServerMemberRole, BadgeTone>,
  userRole: {
    player: 'neutral',
    server_admin: 'info',
    reviewer: 'accent',
    moderator: 'accent',
    admin: 'warning',
    super_admin: 'danger',
  } satisfies Record<UserRole, BadgeTone>,
  userStatus: { active: 'success', disabled: 'danger' } satisfies Record<UserStatus, BadgeTone>,
  sessionRevokeReason: {
    logout: 'neutral',
    user_revoked: 'info',
    admin_revoked: 'warning',
    password_changed: 'info',
    password_reset: 'info',
    mfa_changed: 'info',
    role_changed: 'info',
    account_disabled: 'danger',
  } satisfies Record<SessionRevokeReason, BadgeTone>,
  policyAction: {
    allow: 'success',
    admin_notify: 'info',
    warn: 'warning',
    require_review: 'warning',
    require_whitelist: 'warning',
    kick: 'danger',
    ban: 'danger',
  } satisfies Record<PolicyAction, BadgeTone>,
  policySignal: {
    global_verdict: 'danger',
    account_age: 'info',
    vpn: 'accent',
    alt_account: 'warning',
    open_reports: 'neutral',
  } satisfies Record<PolicySignal, BadgeTone>,
  backendUnavailableAction: { allow: 'success', admin_notify: 'info', kick: 'danger' } satisfies Record<
    BackendUnavailableAction,
    BadgeTone
  >,
  globalStatus: {
    none: 'muted',
    rejected: 'success',
    inconclusive: 'warning',
    reported: 'info',
    under_review: 'warning',
    confirmed: 'danger',
  } satisfies Record<GlobalStatus, BadgeTone>,
  vpnConfidence: {
    not_detected: 'success',
    possible: 'info',
    likely: 'warning',
    confirmed: 'danger',
  } satisfies Record<VpnConfidence, BadgeTone>,
  vpnType: {
    vpn: 'warning',
    proxy: 'warning',
    tor: 'danger',
    hosting: 'info',
    relay: 'info',
    unknown: 'muted',
  } satisfies Record<VpnType, BadgeTone>,
  altConfidence: { none: 'success', low: 'info', medium: 'warning', high: 'danger' } satisfies Record<
    AltConfidence,
    BadgeTone
  >,
  altSignal: {
    same_network_identifier: 'warning',
    same_network_prefix: 'neutral',
    linked_account_confirmed_case: 'danger',
    linked_account_recently_seen: 'warning',
    shared_network_many_accounts: 'info',
    network_is_vpn: 'info',
  } satisfies Record<AltSignal, BadgeTone>,
  accountAgeSource: { steam: 'info', server_reported: 'warning', unknown: 'muted' } satisfies Record<
    AccountAgeSource,
    BadgeTone
  >,
  playerSignalType: {
    vpn_detected: 'accent',
    possible_alt_account: 'warning',
    young_account: 'info',
  } satisfies Record<PlayerSignalType, BadgeTone>,
  playerIdType: { steam: 'info', discord: 'accent', northwood: 'neutral' } satisfies Record<PlayerIdType, BadgeTone>,
  overwatchStatus: { active: 'success', ended: 'muted', expired: 'warning' } satisfies Record<
    OverwatchSessionStatus,
    BadgeTone
  >,
  overwatchEndReason: {
    target_changed: 'neutral',
    overwatch_disabled: 'neutral',
    spectator_left: 'neutral',
    target_left: 'neutral',
    round_ended: 'neutral',
    manual: 'info',
    heartbeat_timeout: 'warning',
  } satisfies Record<OverwatchEndReason, BadgeTone>,
  actorType: { user: 'info', server: 'accent', system: 'muted', player: 'neutral' } satisfies Record<ActorType, BadgeTone>,
  reviewKind: {
    review_started: 'info',
    verdict_set: 'accent',
    note: 'neutral',
    appeal_decision: 'accent',
    reopened: 'warning',
  } satisfies Record<ReviewKind, BadgeTone>,
  auditVerifyFailure: { hash_mismatch: 'danger', prev_hash_mismatch: 'danger' } satisfies Record<
    AuditVerifyFailure,
    BadgeTone
  >,
} as const;

export type StatusKind = keyof typeof TONES | 'auditAction';

/** Enum value tuples per kind (used by tests to prove coverage). */
export const STATUS_KIND_VALUES: Readonly<Record<StatusKind, readonly string[]>> = {
  verdict: CASE_VERDICTS,
  caseStatus: CASE_STATUSES,
  reportStatus: REPORT_STATUSES,
  reporterType: REPORTER_TYPES,
  evidenceStatus: EVIDENCE_STATUSES,
  evidenceType: EVIDENCE_TYPES,
  appealStatus: APPEAL_STATUSES,
  appealDecision: APPEAL_DECISIONS,
  whitelistStatus: WHITELIST_REQUEST_STATUSES,
  whitelistType: WHITELIST_REQUEST_TYPES,
  whitelistDecision: WHITELIST_DECISIONS,
  bypassType: BYPASS_TYPES,
  bypassScope: BYPASS_SCOPES,
  serverStatus: SERVER_STATUSES,
  serverKeyStatus: SERVER_KEY_STATUSES,
  serverMemberRole: SERVER_MEMBER_ROLES,
  userRole: USER_ROLES,
  userStatus: USER_STATUSES,
  sessionRevokeReason: SESSION_REVOKE_REASONS,
  policyAction: POLICY_ACTIONS,
  policySignal: POLICY_SIGNALS,
  backendUnavailableAction: BACKEND_UNAVAILABLE_ACTIONS,
  globalStatus: GLOBAL_STATUSES,
  vpnConfidence: VPN_CONFIDENCES,
  vpnType: VPN_TYPES,
  altConfidence: ALT_CONFIDENCES,
  altSignal: ALT_SIGNALS,
  accountAgeSource: ACCOUNT_AGE_SOURCES,
  playerSignalType: PLAYER_SIGNAL_TYPES,
  playerIdType: PLAYER_ID_TYPES,
  overwatchStatus: OVERWATCH_SESSION_STATUSES,
  overwatchEndReason: OVERWATCH_END_REASONS,
  actorType: ACTOR_TYPES,
  reviewKind: REVIEW_KINDS,
  auditVerifyFailure: AUDIT_VERIFY_FAILURES,
  auditAction: AUDIT_ACTIONS,
};

/** Tone of an audit event name (§9.2), derived from its verb. */
export function auditActionTone(action: string): BadgeTone {
  const name = action.toUpperCase();
  if (/(FAILED|LOCKED|REVOKED|REJECTED|DISABLED|SUSPENDED|SUPERSEDED)$/.test(name)) return 'danger';
  if (/(CREATED|REGISTERED|VERIFIED|ENABLED|APPROVED|CONFIRMED_BY_SERVER|SUCCEEDED|LINKED|ADDED|RESOLVED)$/.test(name))
    return 'success';
  if (/(CHANGED|UPDATED|ROTATED|ROTATION_REQUESTED|REOPENED|EXPIRED|REQUESTED|UNLINKED|REMOVED|WITHDRAWN)$/.test(name))
    return 'warning';
  if (/^(EVIDENCE_ACCESSED|PROOF_VERIFIED|AUDIT_CHAIN_VERIFIED|RETENTION_RUN)$/.test(name)) return 'muted';
  return 'info';
}

/** Tone for any (kind, value); neutral when the value is unknown. */
export function statusTone(kind: StatusKind, value: string): BadgeTone {
  if (kind === 'auditAction') return auditActionTone(value);
  const map = TONES[kind] as Readonly<Record<string, BadgeTone>>;
  return map[value] ?? 'neutral';
}

const UPPER_TOKENS = new Set(['vpn', '2fa', 'id', 'url', 'ip', 'tor', 'api']);

/** `under_review` → "Under review", `USER_2FA_ENABLED` → "User 2FA enabled", `vpn_whitelist` → "VPN whitelist". */
export function humanizeEnum(value: string): string {
  const words = value
    .split(/[_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase())
    .map((word) => (UPPER_TOKENS.has(word) ? word.toUpperCase() : word));
  if (words.length === 0) return value;
  const [first, ...rest] = words;
  const head = first === undefined ? '' : UPPER_TOKENS.has(first.toLowerCase()) ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(' ');
}

export interface StatusBadgeProps {
  kind: StatusKind;
  value: string;
  /** Overrides the humanized label. */
  label?: string;
  dot?: boolean;
  title?: string;
}

export function StatusBadge({ kind, value, label, dot, title }: StatusBadgeProps) {
  return (
    <Badge tone={statusTone(kind, value)} dot={dot} title={title ?? value}>
      {label ?? humanizeEnum(value)}
    </Badge>
  );
}
