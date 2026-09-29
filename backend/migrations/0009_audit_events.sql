-- 0009: append-only, hash-chained audit log (ARCHITECTURE §4.9, §9, R8).
--
-- Writers (AuditService.record) run inside the business transaction:
--   pg_advisory_xact_lock(7274001); read last hash; nextval('audit_events_seq');
--   hash = sha256_hex(canonical_json(event_without_hashes) + prev_hash)
-- seq is strictly increasing but may have gaps (rolled back transactions);
-- the chain order is ORDER BY seq.
-- action holds the upper-case AuditAction event names of §9.2 (e.g. REPORT_CREATED):
-- the one enum whose values are not lowercase (see shared/src/enums.ts; they are hashed).

CREATE SEQUENCE audit_events_seq AS bigint START WITH 1 MINVALUE 1 NO CYCLE;

CREATE TABLE audit_events (
  seq         bigint      PRIMARY KEY,
  event_id    uuid        NOT NULL,
  created_at  timestamptz NOT NULL,
  actor_type  text        NOT NULL,
  actor_id    text        NULL,
  action      text        NOT NULL,
  target_type text        NOT NULL,
  target_id   text        NULL,
  server_id   uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  case_id     uuid        NULL REFERENCES cases (id) ON DELETE RESTRICT,
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  request_id  text        NULL,
  prev_hash   char(64)    NOT NULL,
  hash        char(64)    NOT NULL,

  CONSTRAINT audit_events_event_id_key UNIQUE (event_id),
  CONSTRAINT audit_events_hash_key UNIQUE (hash),
  -- every hash is the predecessor of at most one event: the chain cannot fork
  CONSTRAINT audit_events_prev_hash_key UNIQUE (prev_hash),
  CONSTRAINT audit_events_seq_check CHECK (seq >= 1),
  -- the hash covers the ISO timestamp with millisecond precision
  CONSTRAINT audit_events_created_at_check CHECK (created_at = date_trunc('milliseconds', created_at)),
  CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user', 'server', 'system', 'player')),
  CONSTRAINT audit_events_actor_id_check CHECK (char_length(actor_id) BETWEEN 1 AND 128),
  CONSTRAINT audit_events_action_check CHECK (action IN (
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
    'PROOF_VERIFIED', 'AUDIT_CHAIN_VERIFIED', 'RETENTION_RUN'
  )),
  CONSTRAINT audit_events_target_type_check CHECK (target_type ~ '^[a-z][a-z_]{0,63}$'),
  CONSTRAINT audit_events_target_id_check CHECK (char_length(target_id) BETWEEN 1 AND 256),
  CONSTRAINT audit_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_events_request_id_check CHECK (char_length(request_id) BETWEEN 1 AND 128),
  CONSTRAINT audit_events_prev_hash_check CHECK (prev_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT audit_events_hash_check CHECK (hash ~ '^[0-9a-f]{64}$' AND hash <> prev_hash)
);

ALTER SEQUENCE audit_events_seq OWNED BY audit_events.seq;

CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id, seq);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_type, actor_id, seq);
CREATE INDEX audit_events_action_idx ON audit_events (action, seq);
CREATE INDEX audit_events_created_at_idx ON audit_events (created_at);
CREATE INDEX audit_events_server_id_idx ON audit_events (server_id, seq);
CREATE INDEX audit_events_case_id_idx ON audit_events (case_id, seq);

CREATE TRIGGER audit_events_forbid_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update('The audit log is append-only and hash-chained (ARCHITECTURE R8).');
CREATE TRIGGER audit_events_forbid_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_delete('The audit log is append-only and hash-chained (ARCHITECTURE R8).');
CREATE TRIGGER audit_events_forbid_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE audit_events IS
  'Append-only, hash-chained audit log (R8). UPDATE/DELETE/TRUNCATE are blocked by triggers; revoke TRUNCATE from the app role as well.';
COMMENT ON COLUMN audit_events.created_at IS 'Set by the application with millisecond precision (part of the hash).';
COMMENT ON COLUMN audit_events.prev_hash IS 'hash of the previous event (by seq); 64 x 0 for the genesis event.';
COMMENT ON COLUMN audit_events.server_id IS 'Denormalized scope: servers.id the event relates to (hashed).';
COMMENT ON COLUMN audit_events.case_id IS 'Denormalized scope: cases.id the event relates to (hashed).';
