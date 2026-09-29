/**
 * Cross-component constants: HTTP conventions, field limits (ARCHITECTURE §4) and defaults.
 */

export const API_PREFIX = '/api/v1';

/** Session cookie (§12.1). */
export const SESSION_COOKIE_NAME = 'stn_session';
/** CSRF header required on cookie-authenticated non-GET requests (§12.1). */
export const CSRF_HEADER = 'X-CSRF-Token';
export const CSRF_HEADER_LOWER = 'x-csrf-token';
/** Request id header present on every response (§2.1). */
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const REQUEST_ID_HEADER_LOWER = 'x-request-id';

/** Field length / range limits shared by DB CHECKs, zod schemas and web forms. */
export const LIMITS = Object.freeze({
  EMAIL_MAX: 254,
  USERNAME_MIN: 3,
  USERNAME_MAX: 32,
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  DISPLAY_NAME_MAX: 64,
  USER_AGENT_MAX: 256,
  URL_MAX: 2048,
  SERVER_NAME_MIN: 3,
  SERVER_NAME_MAX: 64,
  SERVER_DESCRIPTION_MAX: 500,
  GAME_VERSION_MAX: 32,
  PLUGIN_VERSION_MAX: 64,
  PLAYER_COUNT_MAX: 1000,
  CASE_REASON_MIN: 3,
  CASE_REASON_MAX: 2000,
  CASE_PUBLIC_SUMMARY_MAX: 500,
  REPORT_REASON_MIN: 3,
  REPORT_REASON_MAX: 200,
  REPORT_DESCRIPTION_MAX: 5000,
  REPORT_NOTE_MIN: 3,
  REPORT_NOTE_MAX: 2000,
  LOG_EXCERPT_MAX_BYTES: 65536,
  REVIEW_COMMENT_MIN: 3,
  REVIEW_COMMENT_MAX: 5000,
  CONFIRMATION_NOTE_MAX: 1000,
  EVIDENCE_TITLE_MAX: 200,
  EVIDENCE_DESCRIPTION_MAX: 5000,
  EVIDENCE_FILENAME_MAX: 255,
  APPEAL_STATEMENT_MIN: 20,
  APPEAL_STATEMENT_MAX: 5000,
  APPEAL_DECISION_REASON_MIN: 10,
  APPEAL_DECISION_REASON_MAX: 5000,
  WHITELIST_REASON_MIN: 10,
  WHITELIST_REASON_MAX: 2000,
  WHITELIST_REQUESTED_DAYS_MIN: 1,
  WHITELIST_REQUESTED_DAYS_MAX: 365,
  WHITELIST_DECISION_NOTE_MAX: 2000,
  BYPASS_DAYS_MAX: 3650,
  BYPASS_REASON_MIN: 3,
  BYPASS_REASON_MAX: 1000,
  REVOKE_REASON_MIN: 3,
  REVOKE_REASON_MAX: 500,
  POLICY_RULES_MAX: 50,
  POLICY_MESSAGE_MAX: 256,
  POLICY_RULE_ID_MAX: 64,
  POLICY_MAX_ACCOUNT_AGE_DAYS: 3650,
  POLICY_MAX_CONFIRMED_SERVERS: 1000,
  POLICY_MAX_OPEN_REPORTS: 1000,
  /** ~10 years; 0 = permanent. */
  POLICY_MAX_BAN_DURATION_MINUTES: 5_256_000,
  SEARCH_QUERY_MAX: 100,
  PAGE_MAX: 10_000,
  PAGE_SIZE_DEFAULT: 25,
  PAGE_SIZE_MAX: 100,
});

/** Evidence upload defaults (§11.3). */
export const DEFAULT_EVIDENCE_MAX_BYTES = 524_288_000;
export const EVIDENCE_ALLOWED_MIME_TYPES = Object.freeze([
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'text/plain',
  'application/json',
  'application/zip',
  'application/gzip',
] as const);
export type EvidenceMimeType = (typeof EVIDENCE_ALLOWED_MIME_TYPES)[number];

/** Default TTLs / timings (overridable via backend env, §16). */
export const DEFAULTS = Object.freeze({
  REGISTRATION_TOKEN_TTL_HOURS: 24,
  LINK_CODE_TTL_SECONDS: 600,
  MFA_TOKEN_TTL_SECONDS: 300,
  WHITELIST_REQUEST_TTL_DAYS: 14,
  EVIDENCE_TICKET_TTL_SECONDS: 60,
  OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS: 90,
  OVERWATCH_START_MAX_SKEW_SECONDS: 60,
  PROOF_RATE_LIMIT_PER_MINUTE: 20,
  RECOVERY_CODE_COUNT: 10,
});
