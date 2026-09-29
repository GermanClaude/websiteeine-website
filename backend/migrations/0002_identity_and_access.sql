-- 0002: identity & access (ARCHITECTURE §4.1).
-- users.player_id gets its foreign key in 0005, once players exists.

-- Reviewer pseudonyms ("Reviewer #<n>"); nextval() is called by the application
-- when a user is first granted a reviewer+ role.
CREATE SEQUENCE users_reviewer_number_seq AS integer START WITH 1 MINVALUE 1 NO CYCLE;

CREATE TABLE users (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               citext      NOT NULL,
  username            text        NOT NULL,
  password_hash       text        NOT NULL,
  role                text        NOT NULL DEFAULT 'player',
  status              text        NOT NULL DEFAULT 'active',
  email_verified_at   timestamptz NULL,
  failed_login_count  integer     NOT NULL DEFAULT 0,
  locked_until        timestamptz NULL,
  totp_secret_enc     text        NULL,
  totp_enabled_at     timestamptz NULL,
  totp_last_used_step bigint      NULL,
  reviewer_number     integer     NULL,
  player_id           uuid        NULL,
  last_login_at       timestamptz NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_reviewer_number_key UNIQUE (reviewer_number),
  CONSTRAINT users_player_id_key UNIQUE (player_id),
  CONSTRAINT users_email_check CHECK (
    char_length(email::text) BETWEEN 3 AND 254
    AND email::text LIKE '_%@_%'
    AND email::text = lower(email::text)
  ),
  CONSTRAINT users_username_check CHECK (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  CONSTRAINT users_password_hash_check CHECK (
    password_hash LIKE '$argon2id$%' AND char_length(password_hash) <= 512
  ),
  CONSTRAINT users_role_check CHECK (
    role IN ('player', 'server_admin', 'reviewer', 'moderator', 'admin', 'super_admin')
  ),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_failed_login_count_check CHECK (failed_login_count >= 0),
  CONSTRAINT users_reviewer_number_check CHECK (reviewer_number > 0),
  CONSTRAINT users_totp_last_used_step_check CHECK (totp_last_used_step >= 0),
  CONSTRAINT users_totp_secret_check CHECK (
    char_length(totp_secret_enc) <= 512
    AND totp_secret_enc ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
  ),
  CONSTRAINT users_totp_enabled_check CHECK (totp_enabled_at IS NULL OR totp_secret_enc IS NOT NULL)
);

-- Usernames are unique case-insensitively ("Admin" must not coexist with "admin").
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE INDEX users_role_idx ON users (role);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_created_at_idx ON users (created_at);

ALTER SEQUENCE users_reviewer_number_seq OWNED BY users.reviewer_number;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE users IS
  'Web accounts. Passwords are argon2id hashes; TOTP secrets are AES-256-GCM encrypted (v1:iv:ct:tag).';
COMMENT ON COLUMN users.email IS 'Normalized lower-case e-mail (citext, unique).';
COMMENT ON COLUMN users.reviewer_number IS
  'Pseudonym number (Reviewer #n), assigned from users_reviewer_number_seq on first reviewer+ grant.';
COMMENT ON COLUMN users.totp_enabled_at IS '2FA is active iff NOT NULL.';
COMMENT ON COLUMN users.totp_last_used_step IS 'Last accepted TOTP time step (replay protection).';

CREATE TABLE user_recovery_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text        NOT NULL,
  used_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_recovery_codes_user_id_code_hash_key UNIQUE (user_id, code_hash),
  CONSTRAINT user_recovery_codes_code_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE user_recovery_codes IS '2FA recovery codes, stored as sha256 hex; single use.';

CREATE TABLE user_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type       text        NOT NULL,
  token_hash text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_tokens_type_check CHECK (type IN ('email_verification', 'password_reset')),
  CONSTRAINT user_tokens_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX user_tokens_user_id_type_idx ON user_tokens (user_id, type);
CREATE INDEX user_tokens_expires_at_idx ON user_tokens (expires_at);

COMMENT ON TABLE user_tokens IS
  'E-mail verification and password reset tokens (sha256 hex of the secret), single use.';

CREATE TABLE sessions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  token_hash      text        NOT NULL,
  mfa_verified    boolean     NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  revoked_reason  text        NULL,
  user_agent      text        NULL,
  ip_hash         text        NULL,

  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_ip_hash_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_user_agent_check CHECK (char_length(user_agent) <= 256),
  CONSTRAINT sessions_revoked_reason_check CHECK (char_length(revoked_reason) <= 200)
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

COMMENT ON TABLE sessions IS
  'Web sessions. token_hash = sha256 hex of the cookie token; ip_hash is an HMAC network hash, never a raw IP.';
