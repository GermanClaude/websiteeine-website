-- 0003: SCP:SL servers, memberships, registration tokens and Ed25519 keys (ARCHITECTURE §4.2, §5).

CREATE TABLE servers (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id                  text        NOT NULL,
  name                       text        NOT NULL,
  description                text        NULL,
  owner_user_id              uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status                     text        NOT NULL DEFAULT 'pending',
  is_trusted                 boolean     NOT NULL DEFAULT false,
  accepts_whitelist_requests boolean     NOT NULL DEFAULT true,
  plugin_version             text        NULL,
  game_version               text        NULL,
  last_seen_at               timestamptz NULL,
  key_rotation_requested_at  timestamptz NULL,
  registered_at              timestamptz NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT servers_server_id_key UNIQUE (server_id),
  -- srv_ + 16 chars Crockford base32 lower-case (no i, l, o, u)
  CONSTRAINT servers_server_id_check CHECK (server_id ~ '^srv_[0-9a-hjkmnp-tv-z]{16}$'),
  CONSTRAINT servers_name_check CHECK (char_length(name) BETWEEN 3 AND 64),
  CONSTRAINT servers_description_check CHECK (char_length(description) <= 2000),
  CONSTRAINT servers_status_check CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  CONSTRAINT servers_plugin_version_check CHECK (char_length(plugin_version) <= 64),
  CONSTRAINT servers_game_version_check CHECK (char_length(game_version) <= 64)
);

CREATE INDEX servers_owner_user_id_idx ON servers (owner_user_id);
CREATE INDEX servers_status_idx ON servers (status);

CREATE TRIGGER servers_set_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE servers IS
  'Registered SCP:SL servers. server_id (srv_...) is the public identifier; id is internal.';
COMMENT ON COLUMN servers.is_trusted IS 'Set by admins; shown next to case confirmations.';

CREATE TABLE server_members (
  server_id  uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,

  CONSTRAINT server_members_pkey PRIMARY KEY (server_id, user_id),
  CONSTRAINT server_members_role_check CHECK (role IN ('owner', 'admin', 'moderator'))
);

CREATE INDEX server_members_user_id_idx ON server_members (user_id);
CREATE INDEX server_members_created_by_idx ON server_members (created_by);
-- Exactly the owner (servers.owner_user_id) holds the owner role.
CREATE UNIQUE INDEX server_members_one_owner_key ON server_members (server_id) WHERE role = 'owner';

COMMENT ON TABLE server_members IS 'Web users allowed to manage a server (owner/admin/moderator).';

CREATE TABLE server_registration_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id  uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  token_hash text        NOT NULL,
  created_by uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT server_registration_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT server_registration_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX server_registration_tokens_server_id_idx ON server_registration_tokens (server_id);
CREATE INDEX server_registration_tokens_created_by_idx ON server_registration_tokens (created_by);
-- Only one usable (unused, unrevoked) token per server; issuing a new one revokes the old.
CREATE UNIQUE INDEX server_registration_tokens_one_usable_key
  ON server_registration_tokens (server_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE server_registration_tokens IS
  'One-time registration tokens (sreg_...), stored as sha256 hex; shown to the user once.';

CREATE TABLE server_keys (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id      uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  public_key     text        NOT NULL,
  fingerprint    text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  activated_at   timestamptz NOT NULL DEFAULT now(),
  retiring_until timestamptz NULL,
  retired_at     timestamptz NULL,
  revoked_at     timestamptz NULL,
  revoked_by     uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  revoke_reason  text        NULL,

  CONSTRAINT server_keys_fingerprint_key UNIQUE (fingerprint),
  -- base64 (standard, padded) of the 32 raw Ed25519 public key bytes
  CONSTRAINT server_keys_public_key_check CHECK (public_key ~ '^[A-Za-z0-9+/]{43}=$'),
  CONSTRAINT server_keys_fingerprint_check CHECK (fingerprint ~ '^SHA256:[0-9a-f]{64}$'),
  CONSTRAINT server_keys_status_check CHECK (status IN ('active', 'retiring', 'retired', 'revoked')),
  CONSTRAINT server_keys_retiring_check CHECK (status <> 'retiring' OR retiring_until IS NOT NULL),
  CONSTRAINT server_keys_retired_check CHECK (status <> 'retired' OR retired_at IS NOT NULL),
  CONSTRAINT server_keys_revoked_check CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT server_keys_revoke_reason_check CHECK (char_length(revoke_reason) <= 500)
);

CREATE INDEX server_keys_server_id_status_idx ON server_keys (server_id, status);
CREATE INDEX server_keys_revoked_by_idx ON server_keys (revoked_by);
-- At most one active key per server (the retiring key covers the rotation grace period).
CREATE UNIQUE INDEX server_keys_one_active_key ON server_keys (server_id) WHERE status = 'active';

COMMENT ON TABLE server_keys IS
  'Ed25519 public keys of servers. Private keys never leave the SCP:SL server (R9).';
COMMENT ON COLUMN server_keys.retiring_until IS 'End of the rotation grace period for a retiring key.';
