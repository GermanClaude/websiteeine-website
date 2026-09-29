-- 0005: players and privacy-preserving signals (ARCHITECTURE §4.4, §8).
-- Raw IP addresses are never stored: only 64-hex HMAC-SHA256 network hashes.

CREATE TABLE players (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  id_type                text        NOT NULL,
  external_id            text        NOT NULL,
  display_name           text        NULL,
  first_seen_at          timestamptz NULL,
  last_seen_at           timestamptz NULL,
  account_created_at     timestamptz NULL,
  account_age_source     text        NOT NULL DEFAULT 'unknown',
  account_age_checked_at timestamptz NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT players_id_type_external_id_key UNIQUE (id_type, external_id),
  CONSTRAINT players_id_type_check CHECK (id_type IN ('steam', 'discord', 'northwood')),
  CONSTRAINT players_external_id_check CHECK (
    (id_type = 'steam' AND external_id ~ '^[0-9]{17}$')
    OR (id_type = 'discord' AND external_id ~ '^[0-9]{17,20}$')
    OR (id_type = 'northwood' AND external_id ~ '^[a-z0-9_.-]{1,64}$')
  ),
  CONSTRAINT players_display_name_check CHECK (char_length(display_name) <= 64),
  CONSTRAINT players_account_age_source_check CHECK (
    account_age_source IN ('steam', 'server_reported', 'unknown')
  )
);

CREATE INDEX players_last_seen_at_idx ON players (last_seen_at);

CREATE TRIGGER players_set_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE players IS
  'In-game identities (<external_id>@<id_type>). Account age is a policy signal only, never a verdict (R4).';

-- Deferred from 0002: a web account may be linked to one in-game identity.
ALTER TABLE users
  ADD CONSTRAINT users_player_id_fkey FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE RESTRICT;

CREATE TABLE player_network_observations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  network_hash  text        NOT NULL,
  prefix_hash   text        NOT NULL,
  server_id     uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  seen_count    integer     NOT NULL DEFAULT 1,

  CONSTRAINT player_network_observations_player_network_server_key UNIQUE (player_id, network_hash, server_id),
  CONSTRAINT player_network_observations_network_hash_check CHECK (network_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT player_network_observations_prefix_hash_check CHECK (prefix_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT player_network_observations_seen_count_check CHECK (seen_count >= 1)
);

CREATE INDEX player_network_observations_network_hash_idx ON player_network_observations (network_hash, last_seen_at);
CREATE INDEX player_network_observations_prefix_hash_idx ON player_network_observations (prefix_hash, last_seen_at);
CREATE INDEX player_network_observations_server_id_idx ON player_network_observations (server_id);
CREATE INDEX player_network_observations_last_seen_at_idx ON player_network_observations (last_seen_at);

COMMENT ON TABLE player_network_observations IS
  'Alt-account correlation by HMAC network hashes (never raw IPs). Retention-limited (RETENTION_NETWORK_OBSERVATIONS_DAYS).';
COMMENT ON COLUMN player_network_observations.network_hash IS 'HMAC of the full IPv4 address / IPv6 /64.';
COMMENT ON COLUMN player_network_observations.prefix_hash IS 'HMAC of the IPv4 /24 / IPv6 /48.';

CREATE TABLE player_server_sightings (
  player_id     uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  server_id     uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  join_count    integer     NOT NULL DEFAULT 1,

  CONSTRAINT player_server_sightings_pkey PRIMARY KEY (player_id, server_id),
  CONSTRAINT player_server_sightings_join_count_check CHECK (join_count >= 1)
);

CREATE INDEX player_server_sightings_server_id_idx ON player_server_sightings (server_id);

COMMENT ON TABLE player_server_sightings IS 'Which player joined which server (first/last seen, join count).';

CREATE TABLE player_signals (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  server_id    uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  signal       text        NOT NULL,
  confidence   text        NULL,
  source       text        NOT NULL,
  detail_codes text[]      NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NULL,

  CONSTRAINT player_signals_signal_check CHECK (
    signal IN ('vpn_detected', 'possible_alt_account', 'young_account')
  ),
  -- VpnConfidence or AltConfidence values
  CONSTRAINT player_signals_confidence_check CHECK (
    confidence IN ('not_detected', 'possible', 'likely', 'confirmed', 'none', 'low', 'medium', 'high')
  ),
  CONSTRAINT player_signals_source_check CHECK (source ~ '^[a-z][a-z0-9_-]{0,63}$'),
  -- Short lower-case codes only (e.g. AltSignal values). The restricted
  -- alphabet makes it impossible to store an IP address here by mistake.
  CONSTRAINT player_signals_detail_codes_check CHECK (
    cardinality(detail_codes) <= 32 AND all_elements_match(detail_codes, '^[a-z0-9_-]{1,64}$')
  )
);

CREATE INDEX player_signals_player_id_created_at_idx ON player_signals (player_id, created_at DESC);
CREATE INDEX player_signals_server_id_idx ON player_signals (server_id);
CREATE INDEX player_signals_created_at_idx ON player_signals (created_at);

COMMENT ON TABLE player_signals IS
  'Derived signal history (VPN, possible alt, young account). Signals only, never verdicts (R3-R5). Retention-limited.';

CREATE TABLE player_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  linked_player_id  uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  signal            text        NOT NULL,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at  timestamptz NOT NULL DEFAULT now(),
  occurrences       integer     NOT NULL DEFAULT 1,

  CONSTRAINT player_links_player_linked_signal_key UNIQUE (player_id, linked_player_id, signal),
  CONSTRAINT player_links_not_self_check CHECK (player_id <> linked_player_id),
  CONSTRAINT player_links_signal_check CHECK (
    signal IN ('same_network_identifier', 'same_network_prefix', 'linked_account_confirmed_case',
               'linked_account_recently_seen', 'shared_network_many_accounts', 'network_is_vpn')
  ),
  CONSTRAINT player_links_occurrences_check CHECK (occurrences >= 1)
);

CREATE INDEX player_links_linked_player_id_idx ON player_links (linked_player_id);

COMMENT ON TABLE player_links IS
  'Possible alt-account links, visible to staff only. Shared IP is not the same person (R5).';
