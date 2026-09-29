-- 0004: structured, versioned server policies (ARCHITECTURE §4.3, §7).
-- Saving a policy inserts a new version with its rules and deactivates the
-- previous one. Policy versions and their rules are history: never deleted,
-- and only server_policies.is_active may change afterwards.

CREATE TABLE server_policies (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id                  uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  version                    integer     NOT NULL,
  is_active                  boolean     NOT NULL,
  backend_unavailable_action text        NOT NULL DEFAULT 'allow',
  notify_on_enforcement      boolean     NOT NULL DEFAULT true,
  honor_global_bypasses      boolean     NOT NULL DEFAULT false,
  whitelist_url              text        NULL,
  created_by                 uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT server_policies_server_id_version_key UNIQUE (server_id, version),
  CONSTRAINT server_policies_version_check CHECK (version >= 1),
  CONSTRAINT server_policies_backend_unavailable_action_check CHECK (
    backend_unavailable_action IN ('allow', 'admin_notify', 'kick')
  ),
  CONSTRAINT server_policies_whitelist_url_check CHECK (
    char_length(whitelist_url) <= 2048 AND whitelist_url ~* '^https?://'
  )
);

CREATE UNIQUE INDEX server_policies_one_active_key ON server_policies (server_id) WHERE is_active;
CREATE INDEX server_policies_created_by_idx ON server_policies (created_by);

CREATE TRIGGER server_policies_forbid_delete
  BEFORE DELETE ON server_policies
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER server_policies_forbid_truncate
  BEFORE TRUNCATE ON server_policies
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();
CREATE TRIGGER server_policies_guard_update
  BEFORE UPDATE ON server_policies
  FOR EACH ROW EXECUTE FUNCTION forbid_update_except('is_active');

COMMENT ON TABLE server_policies IS
  'Versioned enforcement policy per server; exactly one active version. Never deleted; only is_active changes.';

CREATE TABLE server_policy_rules (
  id                            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id                     uuid    NOT NULL REFERENCES server_policies (id) ON DELETE CASCADE,
  sort_order                    integer NOT NULL,
  enabled                       boolean NOT NULL DEFAULT true,
  signal                        text    NOT NULL,
  action                        text    NOT NULL,
  statuses                      text[]  NULL,
  min_confirmed_servers         integer NULL,
  max_account_age_days          integer NULL,
  match_unknown_age             boolean NULL,
  min_vpn_confidence            text    NULL,
  min_alt_confidence            text    NULL,
  require_linked_confirmed_case boolean NULL,
  min_open_reports              integer NULL,
  message                       text    NULL,
  ban_duration_minutes          integer NULL,

  CONSTRAINT server_policy_rules_policy_id_sort_order_key UNIQUE (policy_id, sort_order),
  CONSTRAINT server_policy_rules_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT server_policy_rules_signal_check CHECK (
    signal IN ('global_verdict', 'account_age', 'vpn', 'alt_account', 'open_reports')
  ),
  CONSTRAINT server_policy_rules_action_check CHECK (
    action IN ('allow', 'admin_notify', 'warn', 'require_review', 'require_whitelist', 'kick', 'ban')
  ),
  CONSTRAINT server_policy_rules_statuses_check CHECK (
    statuses <@ ARRAY['none', 'rejected', 'inconclusive', 'reported', 'under_review', 'confirmed']::text[]
  ),
  CONSTRAINT server_policy_rules_min_vpn_confidence_check CHECK (
    min_vpn_confidence IN ('not_detected', 'possible', 'likely', 'confirmed')
  ),
  CONSTRAINT server_policy_rules_min_alt_confidence_check CHECK (
    min_alt_confidence IN ('none', 'low', 'medium', 'high')
  ),
  CONSTRAINT server_policy_rules_min_confirmed_servers_check CHECK (min_confirmed_servers BETWEEN 0 AND 1000),
  CONSTRAINT server_policy_rules_max_account_age_days_check CHECK (max_account_age_days BETWEEN 1 AND 36500),
  CONSTRAINT server_policy_rules_min_open_reports_check CHECK (min_open_reports BETWEEN 1 AND 1000),
  CONSTRAINT server_policy_rules_message_check CHECK (char_length(message) <= 256),
  -- ban_duration_minutes only for ban rules; 0 = permanent
  CONSTRAINT server_policy_rules_ban_duration_check CHECK (
    ban_duration_minutes IS NULL OR (action = 'ban' AND ban_duration_minutes >= 0)
  ),

  -- Condition columns must match the rule's signal; columns of other signals stay NULL.
  CONSTRAINT server_policy_rules_global_verdict_check CHECK (
    signal <> 'global_verdict' OR (
      statuses IS NOT NULL AND cardinality(statuses) >= 1
      AND max_account_age_days IS NULL AND match_unknown_age IS NULL
      AND min_vpn_confidence IS NULL AND min_alt_confidence IS NULL
      AND require_linked_confirmed_case IS NULL AND min_open_reports IS NULL
    )
  ),
  CONSTRAINT server_policy_rules_account_age_check CHECK (
    signal <> 'account_age' OR (
      (max_account_age_days IS NOT NULL OR match_unknown_age IS TRUE)
      AND statuses IS NULL AND min_confirmed_servers IS NULL
      AND min_vpn_confidence IS NULL AND min_alt_confidence IS NULL
      AND require_linked_confirmed_case IS NULL AND min_open_reports IS NULL
    )
  ),
  CONSTRAINT server_policy_rules_vpn_check CHECK (
    signal <> 'vpn' OR (
      min_vpn_confidence IS NOT NULL
      AND statuses IS NULL AND min_confirmed_servers IS NULL
      AND max_account_age_days IS NULL AND match_unknown_age IS NULL
      AND min_alt_confidence IS NULL AND require_linked_confirmed_case IS NULL
      AND min_open_reports IS NULL
    )
  ),
  CONSTRAINT server_policy_rules_alt_account_check CHECK (
    signal <> 'alt_account' OR (
      min_alt_confidence IS NOT NULL
      AND statuses IS NULL AND min_confirmed_servers IS NULL
      AND max_account_age_days IS NULL AND match_unknown_age IS NULL
      AND min_vpn_confidence IS NULL AND min_open_reports IS NULL
    )
  ),
  CONSTRAINT server_policy_rules_open_reports_check CHECK (
    signal <> 'open_reports' OR (
      min_open_reports IS NOT NULL
      AND statuses IS NULL AND min_confirmed_servers IS NULL
      AND max_account_age_days IS NULL AND match_unknown_age IS NULL
      AND min_vpn_confidence IS NULL AND min_alt_confidence IS NULL
      AND require_linked_confirmed_case IS NULL
    )
  )
);

CREATE TRIGGER server_policy_rules_forbid_update
  BEFORE UPDATE ON server_policy_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_update('Policy rules belong to an immutable policy version; save a new version instead.');
CREATE TRIGGER server_policy_rules_forbid_delete
  BEFORE DELETE ON server_policy_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_delete('Policy rules belong to an immutable policy version; save a new version instead.');
CREATE TRIGGER server_policy_rules_forbid_truncate
  BEFORE TRUNCATE ON server_policy_rules
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE server_policy_rules IS
  'Ordered rules of one policy version. One row per rule; condition columns depend on signal (CHECKed).';
COMMENT ON COLUMN server_policy_rules.max_account_age_days IS 'account_age: matches when account age in days < value.';
COMMENT ON COLUMN server_policy_rules.ban_duration_minutes IS 'Only for action ban; 0 = permanent.';
