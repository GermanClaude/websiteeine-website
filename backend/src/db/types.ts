/**
 * Kysely `Database` interface — one table interface per table of the SQL
 * migrations (backend/migrations). Keep this file in sync with the SQL;
 * tests/db/schema-manifest.test.ts compares it with the live schema.
 *
 * Conventions:
 * - uuid / text / citext / char(n) -> string; integer / bigint -> number
 *   (int8 is parsed to number with a safe-integer check, see kysely.ts);
 *   text[] -> string[]; jsonb -> JsonObject; timestamptz -> Date (insert/update
 *   also accept ISO strings).
 * - Columns with a DB default are optional on insert (Generated / Default*).
 * - Columns the DB never lets change (primary keys, trigger-protected history
 *   columns) have update type `never`, so Kysely rejects such updates at
 *   compile time. Append-only tables therefore have no *Update alias.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

import type {
  AccountAgeSource,
  ActorType,
  AltConfidence,
  AltSignal,
  AppealDecision,
  AppealStatus,
  AuditAction,
  BackendUnavailableAction,
  BypassScope,
  BypassType,
  CaseStatus,
  CaseVerdict,
  EvidenceStatus,
  EvidenceType,
  GlobalStatus,
  JobRunResult,
  OverwatchSessionStatus,
  PlayerIdType,
  PlayerSignalConfidence,
  PlayerSignalType,
  PolicyAction,
  PolicySignal,
  ReporterType,
  ReportStatus,
  ReviewKind,
  ServerKeyStatus,
  ServerMemberRole,
  ServerStatus,
  UserRole,
  UserStatus,
  UserTokenType,
  VpnConfidence,
  WhitelistRequestStatus,
  WhitelistRequestType,
} from './enums';

// ---------------------------------------------------------------------------
// Column helper types
// ---------------------------------------------------------------------------

/** timestamptz NOT NULL without default. */
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
/** timestamptz NOT NULL DEFAULT now(). */
export type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** timestamptz NULL. */
export type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
/** uuid PRIMARY KEY DEFAULT gen_random_uuid(); primary keys never change. */
export type PrimaryKey = ColumnType<string, string | undefined, never>;

/** Top-level JSON object stored in a jsonb column (CHECK jsonb_typeof = 'object'). */
export type JsonObject = Record<string, unknown>;
/** jsonb NOT NULL DEFAULT '{}'. */
export type DefaultJsonObject = ColumnType<JsonObject, JsonObject | string | undefined, JsonObject | string>;

/** Same select/insert types as C, but the column can never be updated (non-distributive). */
export type Frozen<C> = [C] extends [ColumnType<infer S, infer I, infer _U>]
  ? ColumnType<S, I, never>
  : ColumnType<C, C, never>;

/** Every column frozen: rows of the table are append-only (forbid_update trigger). */
export type AppendOnly<T> = { [K in keyof T]: Frozen<T[K]> };

// ---------------------------------------------------------------------------
// 4.1 Identity & access
// ---------------------------------------------------------------------------

export interface UsersTable {
  id: PrimaryKey;
  email: string;
  username: string;
  password_hash: string;
  role: Generated<UserRole>;
  status: Generated<UserStatus>;
  email_verified_at: NullableTimestamp;
  failed_login_count: Generated<number>;
  locked_until: NullableTimestamp;
  totp_secret_enc: string | null;
  totp_enabled_at: NullableTimestamp;
  totp_last_used_step: number | null;
  reviewer_number: number | null;
  player_id: string | null;
  last_login_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface UserRecoveryCodesTable {
  id: PrimaryKey;
  user_id: string;
  code_hash: string;
  used_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}

export interface UserTokensTable {
  id: PrimaryKey;
  user_id: string;
  type: UserTokenType;
  token_hash: string;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}

export interface SessionsTable {
  id: PrimaryKey;
  user_id: string;
  token_hash: string;
  mfa_verified: boolean;
  created_at: DefaultTimestamp;
  last_seen_at: DefaultTimestamp;
  expires_at: Timestamp;
  idle_expires_at: Timestamp;
  revoked_at: NullableTimestamp;
  revoked_reason: string | null;
  user_agent: string | null;
  ip_hash: string | null;
}

// ---------------------------------------------------------------------------
// 4.2 Servers
// ---------------------------------------------------------------------------

export interface ServersTable {
  id: PrimaryKey;
  server_id: string;
  name: string;
  description: string | null;
  owner_user_id: string;
  status: Generated<ServerStatus>;
  is_trusted: Generated<boolean>;
  accepts_whitelist_requests: Generated<boolean>;
  plugin_version: string | null;
  game_version: string | null;
  last_seen_at: NullableTimestamp;
  key_rotation_requested_at: NullableTimestamp;
  registered_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface ServerMembersTable {
  server_id: string;
  user_id: string;
  role: ServerMemberRole;
  created_at: DefaultTimestamp;
  created_by: string;
}

export interface ServerRegistrationTokensTable {
  id: PrimaryKey;
  server_id: string;
  token_hash: string;
  created_by: string;
  expires_at: Timestamp;
  used_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}

export interface ServerKeysTable {
  id: PrimaryKey;
  server_id: string;
  public_key: string;
  fingerprint: string;
  status: Generated<ServerKeyStatus>;
  created_at: DefaultTimestamp;
  activated_at: DefaultTimestamp;
  retiring_until: NullableTimestamp;
  retired_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  revoked_by: string | null;
  revoke_reason: string | null;
}

// ---------------------------------------------------------------------------
// 4.3 Server policies (versioned; only is_active may change after insert)
// ---------------------------------------------------------------------------

export interface ServerPoliciesTable {
  id: PrimaryKey;
  server_id: Frozen<string>;
  version: Frozen<number>;
  is_active: boolean;
  backend_unavailable_action: Frozen<Generated<BackendUnavailableAction>>;
  notify_on_enforcement: Frozen<Generated<boolean>>;
  honor_global_bypasses: Frozen<Generated<boolean>>;
  whitelist_url: Frozen<string | null>;
  created_by: Frozen<string | null>;
  created_at: Frozen<DefaultTimestamp>;
}

export type ServerPolicyRulesTable = AppendOnly<{
  id: PrimaryKey;
  policy_id: string;
  sort_order: number;
  enabled: Generated<boolean>;
  signal: PolicySignal;
  action: PolicyAction;
  statuses: GlobalStatus[] | null;
  min_confirmed_servers: number | null;
  max_account_age_days: number | null;
  match_unknown_age: boolean | null;
  min_vpn_confidence: VpnConfidence | null;
  min_alt_confidence: AltConfidence | null;
  require_linked_confirmed_case: boolean | null;
  min_open_reports: number | null;
  message: string | null;
  ban_duration_minutes: number | null;
}>;

// ---------------------------------------------------------------------------
// 4.4 Players & signals
// ---------------------------------------------------------------------------

export interface PlayersTable {
  id: PrimaryKey;
  id_type: PlayerIdType;
  external_id: string;
  display_name: string | null;
  first_seen_at: NullableTimestamp;
  last_seen_at: NullableTimestamp;
  account_created_at: NullableTimestamp;
  account_age_source: Generated<AccountAgeSource>;
  account_age_checked_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface PlayerNetworkObservationsTable {
  id: PrimaryKey;
  player_id: string;
  network_hash: string;
  prefix_hash: string;
  server_id: string;
  first_seen_at: DefaultTimestamp;
  last_seen_at: DefaultTimestamp;
  seen_count: Generated<number>;
}

export interface PlayerServerSightingsTable {
  player_id: string;
  server_id: string;
  first_seen_at: DefaultTimestamp;
  last_seen_at: DefaultTimestamp;
  join_count: Generated<number>;
}

export interface PlayerSignalsTable {
  id: PrimaryKey;
  player_id: string;
  server_id: string | null;
  signal: PlayerSignalType;
  confidence: PlayerSignalConfidence | null;
  source: string;
  detail_codes: Generated<string[]>;
  created_at: DefaultTimestamp;
  expires_at: NullableTimestamp;
}

export interface PlayerLinksTable {
  id: PrimaryKey;
  player_id: string;
  linked_player_id: string;
  signal: AltSignal;
  first_detected_at: DefaultTimestamp;
  last_detected_at: DefaultTimestamp;
  occurrences: Generated<number>;
}

// ---------------------------------------------------------------------------
// 4.5 Cases, reports, reviews, confirmations (+ 4.8 appeals)
// ---------------------------------------------------------------------------

export interface CaseCountersTable {
  year: number;
  last_value: number;
}

export interface CasesTable {
  id: PrimaryKey;
  case_number: string;
  player_id: string;
  current_verdict: Generated<CaseVerdict>;
  status: Generated<CaseStatus>;
  reason: string;
  public_summary: string | null;
  created_by_user_id: string | null;
  created_by_server_id: string | null;
  verdict_set_by: string | null;
  verdict_set_at: NullableTimestamp;
  closed_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface ReportsTable {
  id: PrimaryKey;
  case_id: string;
  player_id: string;
  server_id: string | null;
  reporter_type: ReporterType;
  reporter_user_id: string | null;
  reporter_player_id: string | null;
  reason: string;
  description: string | null;
  status: Generated<ReportStatus>;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export type ReviewsTable = AppendOnly<{
  id: PrimaryKey;
  case_id: string;
  reviewer_user_id: string;
  kind: ReviewKind;
  previous_verdict: CaseVerdict | null;
  new_verdict: CaseVerdict | null;
  comment: string;
  appeal_id: string | null;
  created_at: DefaultTimestamp;
}>;

/** Soft-revocable: only the revoke columns change, and only once. */
export interface CaseServerConfirmationsTable {
  id: PrimaryKey;
  case_id: Frozen<string>;
  server_id: Frozen<string>;
  confirmed_by_user_id: Frozen<string>;
  note: Frozen<string | null>;
  created_at: Frozen<DefaultTimestamp>;
  revoked_at: NullableTimestamp;
  revoked_by: string | null;
  revoke_reason: string | null;
}

export interface AppealsTable {
  id: PrimaryKey;
  case_id: string;
  player_id: string;
  submitted_by_user_id: string;
  statement: string;
  status: Generated<AppealStatus>;
  assigned_reviewer_id: string | null;
  decision: AppealDecision | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  conflict_override: Generated<boolean>;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

// ---------------------------------------------------------------------------
// 4.6 Evidence (immutable except statuses; superseded_by set once via UPDATE)
// ---------------------------------------------------------------------------

export interface EvidenceTable {
  id: PrimaryKey;
  case_id: Frozen<string>;
  report_id: Frozen<string | null>;
  type: Frozen<EvidenceType>;
  title: Frozen<string>;
  description: Frozen<string | null>;
  status: Generated<EvidenceStatus>;
  identity_status: Generated<EvidenceStatus>;
  authenticity_status: Generated<EvidenceStatus>;
  cheating_status: Generated<EvidenceStatus>;
  sha256: Frozen<string | null>;
  size_bytes: Frozen<number | null>;
  mime_type: Frozen<string | null>;
  original_filename: Frozen<string | null>;
  storage_key: Frozen<string | null>;
  external_url: Frozen<string | null>;
  uploaded_at: Frozen<DefaultTimestamp>;
  uploader_user_id: Frozen<string | null>;
  uploader_server_id: Frozen<string | null>;
  overwatch_session_id: Frozen<string | null>;
  supersedes_evidence_id: Frozen<string | null>;
  /** NULL on insert (trigger-enforced); set exactly once to the superseding row. */
  superseded_by_evidence_id: ColumnType<string | null, never, string>;
  created_at: Frozen<DefaultTimestamp>;
  updated_at: DefaultTimestamp;
}

export type EvidenceReviewsTable = AppendOnly<{
  id: PrimaryKey;
  evidence_id: string;
  reviewer_user_id: string;
  status: EvidenceStatus;
  identity_status: EvidenceStatus;
  authenticity_status: EvidenceStatus;
  cheating_status: EvidenceStatus;
  comment: string;
  created_at: DefaultTimestamp;
}>;

// ---------------------------------------------------------------------------
// 4.7 Overwatch
// ---------------------------------------------------------------------------

export interface OverwatchSessionsTable {
  id: PrimaryKey;
  server_id: string;
  target_player_id: string;
  spectator_player_id: string;
  secret_enc: string | null;
  interval_seconds: Generated<number>;
  status: Generated<OverwatchSessionStatus>;
  started_at: Timestamp;
  ended_at: NullableTimestamp;
  last_heartbeat_at: Timestamp;
  end_reason: string | null;
  created_at: DefaultTimestamp;
}

// ---------------------------------------------------------------------------
// 4.8 Whitelist requests & bypasses
// ---------------------------------------------------------------------------

export interface WhitelistRequestsTable {
  id: PrimaryKey;
  player_id: string;
  requester_user_id: string;
  server_id: string;
  type: WhitelistRequestType;
  reason: string;
  requested_days: number | null;
  status: Generated<WhitelistRequestStatus>;
  decided_by: string | null;
  decided_at: NullableTimestamp;
  decision_note: string | null;
  bypass_id: string | null;
  expires_at: Timestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface BypassesTable {
  id: PrimaryKey;
  player_id: string;
  scope: BypassScope;
  server_id: string | null;
  type: BypassType;
  reason: string;
  granted_by_user_id: string;
  whitelist_request_id: string | null;
  created_at: DefaultTimestamp;
  expires_at: NullableTimestamp;
  revoked_at: NullableTimestamp;
  revoked_by: string | null;
  revoke_reason: string | null;
  expired_processed_at: NullableTimestamp;
}

// ---------------------------------------------------------------------------
// 4.9 Audit (append-only) / 4.10 Operational
// ---------------------------------------------------------------------------

export type AuditEventsTable = AppendOnly<{
  /** From nextval('audit_events_seq'); supplied by the writer (part of the hash). */
  seq: number;
  event_id: string;
  created_at: Timestamp;
  actor_type: ActorType;
  actor_id: string | null;
  action: AuditAction;
  target_type: string;
  target_id: string | null;
  server_id: string | null;
  case_id: string | null;
  metadata: DefaultJsonObject;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}>;

export interface JobRunsTable {
  id: PrimaryKey;
  job: string;
  started_at: DefaultTimestamp;
  finished_at: NullableTimestamp;
  result: Generated<JobRunResult>;
  details: DefaultJsonObject;
}

/** Managed by src/db/migrator.ts. */
export interface SchemaMigrationsTable {
  version: string;
  checksum: string;
  applied_at: DefaultTimestamp;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface Database {
  users: UsersTable;
  user_recovery_codes: UserRecoveryCodesTable;
  user_tokens: UserTokensTable;
  sessions: SessionsTable;
  servers: ServersTable;
  server_members: ServerMembersTable;
  server_registration_tokens: ServerRegistrationTokensTable;
  server_keys: ServerKeysTable;
  server_policies: ServerPoliciesTable;
  server_policy_rules: ServerPolicyRulesTable;
  players: PlayersTable;
  player_network_observations: PlayerNetworkObservationsTable;
  player_server_sightings: PlayerServerSightingsTable;
  player_signals: PlayerSignalsTable;
  player_links: PlayerLinksTable;
  case_counters: CaseCountersTable;
  cases: CasesTable;
  reports: ReportsTable;
  reviews: ReviewsTable;
  case_server_confirmations: CaseServerConfirmationsTable;
  evidence: EvidenceTable;
  evidence_reviews: EvidenceReviewsTable;
  overwatch_sessions: OverwatchSessionsTable;
  appeals: AppealsTable;
  whitelist_requests: WhitelistRequestsTable;
  bypasses: BypassesTable;
  audit_events: AuditEventsTable;
  job_runs: JobRunsTable;
  schema_migrations: SchemaMigrationsTable;
}

export type TableName = keyof Database;

// ---------------------------------------------------------------------------
// Row aliases: <Name>Row (select), New<Name> (insert), <Name>Update (update)
// ---------------------------------------------------------------------------

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export type UserRecoveryCodeRow = Selectable<UserRecoveryCodesTable>;
export type NewUserRecoveryCode = Insertable<UserRecoveryCodesTable>;
export type UserRecoveryCodeUpdate = Updateable<UserRecoveryCodesTable>;

export type UserTokenRow = Selectable<UserTokensTable>;
export type NewUserToken = Insertable<UserTokensTable>;
export type UserTokenUpdate = Updateable<UserTokensTable>;

export type SessionRow = Selectable<SessionsTable>;
export type NewSession = Insertable<SessionsTable>;
export type SessionUpdate = Updateable<SessionsTable>;

export type ServerRow = Selectable<ServersTable>;
export type NewServer = Insertable<ServersTable>;
export type ServerUpdate = Updateable<ServersTable>;

export type ServerMemberRow = Selectable<ServerMembersTable>;
export type NewServerMember = Insertable<ServerMembersTable>;
export type ServerMemberUpdate = Updateable<ServerMembersTable>;

export type ServerRegistrationTokenRow = Selectable<ServerRegistrationTokensTable>;
export type NewServerRegistrationToken = Insertable<ServerRegistrationTokensTable>;
export type ServerRegistrationTokenUpdate = Updateable<ServerRegistrationTokensTable>;

export type ServerKeyRow = Selectable<ServerKeysTable>;
export type NewServerKey = Insertable<ServerKeysTable>;
export type ServerKeyUpdate = Updateable<ServerKeysTable>;

export type ServerPolicyRow = Selectable<ServerPoliciesTable>;
export type NewServerPolicy = Insertable<ServerPoliciesTable>;
export type ServerPolicyUpdate = Updateable<ServerPoliciesTable>;

export type ServerPolicyRuleRow = Selectable<ServerPolicyRulesTable>;
export type NewServerPolicyRule = Insertable<ServerPolicyRulesTable>;

export type PlayerRow = Selectable<PlayersTable>;
export type NewPlayer = Insertable<PlayersTable>;
export type PlayerUpdate = Updateable<PlayersTable>;

export type PlayerNetworkObservationRow = Selectable<PlayerNetworkObservationsTable>;
export type NewPlayerNetworkObservation = Insertable<PlayerNetworkObservationsTable>;
export type PlayerNetworkObservationUpdate = Updateable<PlayerNetworkObservationsTable>;

export type PlayerServerSightingRow = Selectable<PlayerServerSightingsTable>;
export type NewPlayerServerSighting = Insertable<PlayerServerSightingsTable>;
export type PlayerServerSightingUpdate = Updateable<PlayerServerSightingsTable>;

export type PlayerSignalRow = Selectable<PlayerSignalsTable>;
export type NewPlayerSignal = Insertable<PlayerSignalsTable>;
export type PlayerSignalUpdate = Updateable<PlayerSignalsTable>;

export type PlayerLinkRow = Selectable<PlayerLinksTable>;
export type NewPlayerLink = Insertable<PlayerLinksTable>;
export type PlayerLinkUpdate = Updateable<PlayerLinksTable>;

export type CaseCounterRow = Selectable<CaseCountersTable>;
export type NewCaseCounter = Insertable<CaseCountersTable>;
export type CaseCounterUpdate = Updateable<CaseCountersTable>;

export type CaseRow = Selectable<CasesTable>;
export type NewCase = Insertable<CasesTable>;
export type CaseUpdate = Updateable<CasesTable>;

export type ReportRow = Selectable<ReportsTable>;
export type NewReport = Insertable<ReportsTable>;
export type ReportUpdate = Updateable<ReportsTable>;

export type ReviewRow = Selectable<ReviewsTable>;
export type NewReview = Insertable<ReviewsTable>;

export type CaseServerConfirmationRow = Selectable<CaseServerConfirmationsTable>;
export type NewCaseServerConfirmation = Insertable<CaseServerConfirmationsTable>;
export type CaseServerConfirmationUpdate = Updateable<CaseServerConfirmationsTable>;

export type EvidenceRow = Selectable<EvidenceTable>;
export type NewEvidence = Insertable<EvidenceTable>;
export type EvidenceUpdate = Updateable<EvidenceTable>;

export type EvidenceReviewRow = Selectable<EvidenceReviewsTable>;
export type NewEvidenceReview = Insertable<EvidenceReviewsTable>;

export type OverwatchSessionRow = Selectable<OverwatchSessionsTable>;
export type NewOverwatchSession = Insertable<OverwatchSessionsTable>;
export type OverwatchSessionUpdate = Updateable<OverwatchSessionsTable>;

export type AppealRow = Selectable<AppealsTable>;
export type NewAppeal = Insertable<AppealsTable>;
export type AppealUpdate = Updateable<AppealsTable>;

export type WhitelistRequestRow = Selectable<WhitelistRequestsTable>;
export type NewWhitelistRequest = Insertable<WhitelistRequestsTable>;
export type WhitelistRequestUpdate = Updateable<WhitelistRequestsTable>;

export type BypassRow = Selectable<BypassesTable>;
export type NewBypass = Insertable<BypassesTable>;
export type BypassUpdate = Updateable<BypassesTable>;

export type AuditEventRow = Selectable<AuditEventsTable>;
export type NewAuditEvent = Insertable<AuditEventsTable>;

export type JobRunRow = Selectable<JobRunsTable>;
export type NewJobRun = Insertable<JobRunsTable>;
export type JobRunUpdate = Updateable<JobRunsTable>;

export type SchemaMigrationRow = Selectable<SchemaMigrationsTable>;
