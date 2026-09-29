-- 0009: append-only, hash-chained audit log (ARCHITECTURE §4.9, §9, R8).
--
-- Writers (AuditService.record) run inside the business transaction:
--   pg_advisory_xact_lock(7274001); read last hash; nextval('audit_events_seq');
--   hash = sha256_hex(canonical_json(event_without_hashes) + prev_hash)
-- seq is strictly increasing but may have gaps (rolled back transactions);
-- the chain order is ORDER BY seq.

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
    'user_registered', 'user_email_verified', 'user_login_succeeded', 'user_login_failed',
    'user_locked', 'user_logout', 'user_password_changed', 'user_password_reset_requested',
    'user_password_reset', 'user_2fa_enabled', 'user_2fa_disabled', 'user_recovery_code_used',
    'user_role_changed', 'user_status_changed', 'session_revoked', 'player_linked',
    'player_unlinked', 'server_created', 'server_registration_token_created', 'server_registered',
    'server_updated', 'server_status_changed', 'server_trust_changed', 'server_member_added',
    'server_member_removed', 'server_key_rotated', 'server_key_revoked',
    'server_key_rotation_requested', 'policy_updated', 'case_created', 'case_updated',
    'review_started', 'case_note_added', 'verdict_changed', 'case_reopened',
    'case_confirmed_by_server', 'case_confirmation_revoked', 'report_created',
    'report_status_changed', 'evidence_uploaded', 'evidence_reviewed', 'evidence_verified',
    'evidence_rejected', 'evidence_superseded', 'evidence_accessed', 'appeal_created',
    'appeal_assigned', 'appeal_resolved', 'appeal_withdrawn', 'bypass_requested',
    'bypass_approved', 'bypass_rejected', 'bypass_revoked', 'bypass_expired', 'bypass_created',
    'whitelist_request_expired', 'overwatch_session_started', 'overwatch_session_ended',
    'proof_verified', 'audit_chain_verified', 'retention_run'
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
