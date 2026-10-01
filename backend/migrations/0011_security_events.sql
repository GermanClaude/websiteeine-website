-- 0011: server-side intrusion detection & anomaly flagging (ARCHITECTURE §4, §8, §9).
--
-- security_events is an append-only record of detection signals, crossed thresholds,
-- transient source blocks/unblocks and heuristic anomaly review items. It mirrors the
-- audit log's immutability (forbid_update/delete/truncate) but is a queryable operational
-- store, not part of the hash chain.
--
-- PRIVACY (ARCHITECTURE §8.1, R-privacy): source_ref holds a privacy-preserving identifier
-- only — an HMAC network hash for anonymous traffic, a user id for sessions, or a server id
-- for plugin traffic. A raw IP address is NEVER stored here (or anywhere else).

CREATE TABLE security_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  kind         text        NOT NULL,
  severity     text        NOT NULL,
  source_type  text        NOT NULL,
  source_ref   text        NULL,
  score        numeric     NULL,
  action_taken text        NOT NULL DEFAULT 'none',
  endpoint     text        NULL,
  request_id   text        NULL,
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  expires_at   timestamptz NULL,

  CONSTRAINT security_events_kind_check CHECK (kind IN (
    'auth_failure_burst', 'request_burst', 'invalid_signature', 'replayed_nonce',
    'duplicate_request_id', 'csrf_failure', 'malformed_auth', 'injection_probe',
    'scanner_user_agent', 'threshold_exceeded', 'source_blocked', 'source_unblocked',
    'anomaly'
  )),
  CONSTRAINT security_events_severity_check CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  CONSTRAINT security_events_source_type_check CHECK (source_type IN ('network', 'user', 'server', 'unknown')),
  CONSTRAINT security_events_action_taken_check CHECK (action_taken IN ('none', 'flagged', 'throttled', 'blocked', 'unblocked')),
  CONSTRAINT security_events_source_ref_check CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 200),
  CONSTRAINT security_events_endpoint_check CHECK (endpoint IS NULL OR char_length(endpoint) BETWEEN 1 AND 256),
  CONSTRAINT security_events_request_id_check CHECK (request_id IS NULL OR char_length(request_id) BETWEEN 1 AND 128),
  CONSTRAINT security_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX security_events_created_at_idx ON security_events (created_at DESC);
CREATE INDEX security_events_source_idx ON security_events (source_type, source_ref, created_at DESC);
CREATE INDEX security_events_kind_idx ON security_events (kind, created_at DESC);
CREATE INDEX security_events_severity_idx ON security_events (severity, created_at DESC);

-- Append-only: the operational security record is never modified or deleted in place.
CREATE TRIGGER security_events_forbid_update
  BEFORE UPDATE ON security_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update('Security events are an append-only operational record.');
CREATE TRIGGER security_events_forbid_delete
  BEFORE DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION forbid_delete('Security events are an append-only operational record.');
CREATE TRIGGER security_events_forbid_truncate
  BEFORE TRUNCATE ON security_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE security_events IS
  'Append-only intrusion-detection / anomaly record. source_ref is a privacy-preserving identifier only (network hash / user id / server id) — never a raw IP.';
COMMENT ON COLUMN security_events.source_ref IS 'HMAC network hash, user id or server id. Never a raw IP address.';
COMMENT ON COLUMN security_events.expires_at IS 'For block records: when the transient block auto-expires.';

-- Extend the audit action allow-list with the new security actions (§9.2). Re-created with
-- the same name so the enum sync test keeps covering it.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'USER_REGISTERED', 'USER_EMAIL_VERIFIED', 'USER_LOGIN_SUCCEEDED', 'USER_LOGIN_FAILED',
  'USER_LOCKED', 'USER_LOGOUT', 'USER_PASSWORD_CHANGED', 'USER_PASSWORD_RESET_REQUESTED',
  'USER_PASSWORD_RESET', 'USER_2FA_ENABLED', 'USER_2FA_DISABLED', 'USER_RECOVERY_CODE_USED',
  'USER_ROLE_CHANGED', 'USER_STATUS_CHANGED', 'SESSION_REVOKED', 'PLAYER_LINKED',
  'PLAYER_UNLINKED', 'SERVER_CREATED', 'SERVER_REGISTRATION_TOKEN_CREATED', 'SERVER_REGISTERED',
  'SERVER_UPDATED', 'SERVER_STATUS_CHANGED', 'SERVER_TRUST_CHANGED', 'SERVER_MEMBER_ADDED',
  'SERVER_MEMBER_REMOVED', 'SERVER_KEY_ROTATED', 'SERVER_KEY_REVOKED',
  'SERVER_KEY_ROTATION_REQUESTED', 'POLICY_UPDATED', 'CASE_CREATED', 'CASE_UPDATED',
  'REVIEW_STARTED', 'CASE_NOTE_ADDED', 'VERDICT_CHANGED', 'CASE_REOPENED',
  'CASE_CONFIRMED_BY_SERVER', 'CASE_CONFIRMATION_REVOKED', 'REPORT_CREATED',
  'REPORT_STATUS_CHANGED', 'EVIDENCE_UPLOADED', 'EVIDENCE_REVIEWED', 'EVIDENCE_VERIFIED',
  'EVIDENCE_REJECTED', 'EVIDENCE_SUPERSEDED', 'EVIDENCE_ACCESSED', 'APPEAL_CREATED',
  'APPEAL_ASSIGNED', 'APPEAL_RESOLVED', 'APPEAL_WITHDRAWN', 'BYPASS_REQUESTED',
  'BYPASS_APPROVED', 'BYPASS_REJECTED', 'BYPASS_REVOKED', 'BYPASS_EXPIRED', 'BYPASS_CREATED',
  'WHITELIST_REQUEST_EXPIRED', 'OVERWATCH_SESSION_STARTED', 'OVERWATCH_SESSION_ENDED',
  'PROOF_VERIFIED', 'AUDIT_CHAIN_VERIFIED', 'SECURITY_SOURCE_BLOCKED',
  'SECURITY_SOURCE_UNBLOCKED', 'SECURITY_THRESHOLD_EXCEEDED', 'RETENTION_RUN'
));
