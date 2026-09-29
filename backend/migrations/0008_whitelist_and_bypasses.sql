-- 0008: whitelist requests and bypasses (ARCHITECTURE §4.8, §11.6).
-- Both are workflow records: their state changes, but rows are never deleted.

CREATE TABLE whitelist_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  requester_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  server_id         uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  type              text        NOT NULL,
  reason            text        NOT NULL,
  requested_days    integer     NULL,
  status            text        NOT NULL DEFAULT 'pending',
  decided_by        uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  decided_at        timestamptz NULL,
  decision_note     text        NULL,
  bypass_id         uuid        NULL,  -- FK to bypasses added below (circular reference)
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whitelist_requests_bypass_id_key UNIQUE (bypass_id),
  CONSTRAINT whitelist_requests_type_check CHECK (type IN ('vpn_whitelist', 'account_age_whitelist')),
  CONSTRAINT whitelist_requests_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'expired', 'revoked')
  ),
  CONSTRAINT whitelist_requests_reason_check CHECK (char_length(reason) BETWEEN 10 AND 2000),
  CONSTRAINT whitelist_requests_requested_days_check CHECK (requested_days BETWEEN 1 AND 365),
  CONSTRAINT whitelist_requests_decision_note_check CHECK (char_length(decision_note) <= 2000),
  CONSTRAINT whitelist_requests_approved_check CHECK (status <> 'approved' OR bypass_id IS NOT NULL)
);

-- One pending request per (player, server, type).
CREATE UNIQUE INDEX whitelist_requests_one_pending_key
  ON whitelist_requests (player_id, server_id, type)
  WHERE status = 'pending';
CREATE INDEX whitelist_requests_player_id_idx ON whitelist_requests (player_id);
CREATE INDEX whitelist_requests_requester_user_id_idx ON whitelist_requests (requester_user_id);
CREATE INDEX whitelist_requests_server_id_status_idx ON whitelist_requests (server_id, status);
CREATE INDEX whitelist_requests_decided_by_idx ON whitelist_requests (decided_by);
CREATE INDEX whitelist_requests_status_expires_at_idx ON whitelist_requests (status, expires_at);

CREATE TRIGGER whitelist_requests_set_updated_at
  BEFORE UPDATE ON whitelist_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER whitelist_requests_forbid_delete
  BEFORE DELETE ON whitelist_requests
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER whitelist_requests_forbid_truncate
  BEFORE TRUNCATE ON whitelist_requests
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE whitelist_requests IS
  'Player requests for a server-scoped VPN / account-age whitelist. Approval creates a bypass. Never deleted.';

CREATE TABLE bypasses (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id            uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  scope                text        NOT NULL,
  server_id            uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  type                 text        NOT NULL,
  reason               text        NOT NULL,
  granted_by_user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  whitelist_request_id uuid        NULL REFERENCES whitelist_requests (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NULL,
  revoked_at           timestamptz NULL,
  revoked_by           uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  revoke_reason        text        NULL,
  expired_processed_at timestamptz NULL,

  CONSTRAINT bypasses_whitelist_request_id_key UNIQUE (whitelist_request_id),
  CONSTRAINT bypasses_scope_check CHECK (scope IN ('server', 'global')),
  CONSTRAINT bypasses_type_check CHECK (
    type IN ('vpn_whitelist', 'account_age_whitelist', 'alt_account_whitelist', 'verdict_override')
  ),
  -- server-scoped bypasses name their server; global ones must not
  CONSTRAINT bypasses_scope_server_check CHECK ((scope = 'server') = (server_id IS NOT NULL)),
  CONSTRAINT bypasses_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000),
  CONSTRAINT bypasses_revoke_reason_check CHECK (char_length(revoke_reason) <= 2000)
);

CREATE INDEX bypasses_player_id_server_id_type_idx ON bypasses (player_id, server_id, type);
CREATE INDEX bypasses_server_id_idx ON bypasses (server_id);
CREATE INDEX bypasses_granted_by_user_id_idx ON bypasses (granted_by_user_id);
CREATE INDEX bypasses_revoked_by_idx ON bypasses (revoked_by);
-- Expiry job: bypasses that expired but were not yet processed/audited.
CREATE INDEX bypasses_pending_expiry_idx
  ON bypasses (expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL AND expired_processed_at IS NULL;

CREATE TRIGGER bypasses_forbid_delete
  BEFORE DELETE ON bypasses
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER bypasses_forbid_truncate
  BEFORE TRUNCATE ON bypasses
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE bypasses IS
  'Exemptions from policy rules. Active iff revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()). Never deleted.';

ALTER TABLE whitelist_requests
  ADD CONSTRAINT whitelist_requests_bypass_id_fkey
  FOREIGN KEY (bypass_id) REFERENCES bypasses (id) ON DELETE RESTRICT;
