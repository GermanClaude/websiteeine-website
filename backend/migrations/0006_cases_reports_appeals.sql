-- 0006: cases, reports, appeals, review history and server confirmations
-- (ARCHITECTURE §4.5, §4.8, §11). Case history is never deleted (R7).

-- Per-year case number counter:
--   INSERT INTO case_counters (year, last_value) VALUES ($1, 1)
--   ON CONFLICT (year) DO UPDATE SET last_value = case_counters.last_value + 1
--   RETURNING last_value
CREATE TABLE case_counters (
  year       integer PRIMARY KEY,
  last_value integer NOT NULL,

  CONSTRAINT case_counters_year_check CHECK (year BETWEEN 2000 AND 9999),
  -- case_number carries a 6-digit counter
  CONSTRAINT case_counters_last_value_check CHECK (last_value BETWEEN 1 AND 999999)
);

COMMENT ON TABLE case_counters IS 'Last allocated per-year counter for CASE-<yyyy>-<nnnnnn>.';

CREATE TABLE cases (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number          text        NOT NULL,
  player_id            uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  current_verdict      text        NOT NULL DEFAULT 'unknown',
  status               text        NOT NULL DEFAULT 'open',
  reason               text        NOT NULL,
  public_summary       text        NULL,
  created_by_user_id   uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_by_server_id uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  verdict_set_by       uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  verdict_set_at       timestamptz NULL,
  closed_at            timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cases_case_number_key UNIQUE (case_number),
  CONSTRAINT cases_case_number_check CHECK (case_number ~ '^CASE-[0-9]{4}-[0-9]{6}$'),
  CONSTRAINT cases_current_verdict_check CHECK (
    current_verdict IN ('unknown', 'inconclusive', 'confirmed', 'rejected')
  ),
  CONSTRAINT cases_status_check CHECK (status IN ('open', 'under_review', 'closed')),
  CONSTRAINT cases_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000),
  CONSTRAINT cases_public_summary_check CHECK (char_length(public_summary) <= 500),
  CONSTRAINT cases_closed_at_check CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

CREATE INDEX cases_player_id_idx ON cases (player_id);
CREATE INDEX cases_status_idx ON cases (status);
CREATE INDEX cases_current_verdict_idx ON cases (current_verdict);
CREATE INDEX cases_created_by_user_id_idx ON cases (created_by_user_id);
CREATE INDEX cases_created_by_server_id_idx ON cases (created_by_server_id);
CREATE INDEX cases_verdict_set_by_idx ON cases (verdict_set_by);
CREATE INDEX cases_created_at_idx ON cases (created_at);

CREATE TRIGGER cases_set_updated_at
  BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER cases_forbid_delete
  BEFORE DELETE ON cases
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER cases_forbid_truncate
  BEFORE TRUNCATE ON cases
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE cases IS
  'Central moderation unit (CASE-yyyy-nnnnnn). Verdict is separate from evidence assessments (R2). Never deleted (R7).';
COMMENT ON COLUMN cases.reason IS 'Internal summary (staff only).';
COMMENT ON COLUMN cases.public_summary IS 'Limited text shown on public case pages.';

CREATE TABLE reports (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id            uuid        NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  player_id          uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  server_id          uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  reporter_type      text        NOT NULL,
  reporter_user_id   uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  reporter_player_id uuid        NULL REFERENCES players (id) ON DELETE RESTRICT,
  reason             text        NOT NULL,
  description        text        NULL,
  status             text        NOT NULL DEFAULT 'open',
  resolution_note    text        NULL,
  resolved_by        uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  resolved_at        timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reports_reporter_type_check CHECK (reporter_type IN ('user', 'server')),
  CONSTRAINT reports_status_check CHECK (status IN ('open', 'under_review', 'resolved', 'rejected')),
  CONSTRAINT reports_reason_check CHECK (char_length(reason) BETWEEN 1 AND 200),
  CONSTRAINT reports_description_check CHECK (char_length(description) <= 5000),
  CONSTRAINT reports_resolution_note_check CHECK (char_length(resolution_note) <= 5000),
  -- web reports name the reporting account; plugin reports name the submitting server
  CONSTRAINT reports_reporter_check CHECK (
    (reporter_type = 'user' AND reporter_user_id IS NOT NULL)
    OR (reporter_type = 'server' AND server_id IS NOT NULL)
  )
);

CREATE INDEX reports_case_id_idx ON reports (case_id);
CREATE INDEX reports_player_id_idx ON reports (player_id);
CREATE INDEX reports_status_idx ON reports (status);
CREATE INDEX reports_server_id_idx ON reports (server_id);
CREATE INDEX reports_reporter_user_id_idx ON reports (reporter_user_id);
CREATE INDEX reports_reporter_player_id_idx ON reports (reporter_player_id);
CREATE INDEX reports_resolved_by_idx ON reports (resolved_by);
CREATE INDEX reports_created_at_idx ON reports (created_at);

CREATE TRIGGER reports_set_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER reports_forbid_delete
  BEFORE DELETE ON reports
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER reports_forbid_truncate
  BEFORE TRUNCATE ON reports
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE reports IS
  'Player reports (web or in-game), always attached to a case. Never deleted; report counts never change verdicts.';

CREATE TABLE appeals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid        NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  player_id            uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  submitted_by_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  statement            text        NOT NULL,
  status               text        NOT NULL DEFAULT 'open',
  assigned_reviewer_id uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  decision             text        NULL,
  decision_reason      text        NULL,
  decided_by           uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  decided_at           timestamptz NULL,
  conflict_override    boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appeals_statement_check CHECK (char_length(statement) BETWEEN 20 AND 5000),
  CONSTRAINT appeals_status_check CHECK (status IN ('open', 'under_review', 'decided', 'withdrawn')),
  CONSTRAINT appeals_decision_check CHECK (decision IN ('confirm', 'reverse', 'inconclusive')),
  CONSTRAINT appeals_decision_reason_check CHECK (char_length(decision_reason) <= 5000),
  CONSTRAINT appeals_decided_check CHECK ((status = 'decided') = (decision IS NOT NULL))
);

-- One open appeal per case.
CREATE UNIQUE INDEX appeals_one_open_per_case_key
  ON appeals (case_id)
  WHERE status IN ('open', 'under_review');
CREATE INDEX appeals_case_id_idx ON appeals (case_id);
CREATE INDEX appeals_player_id_idx ON appeals (player_id);
CREATE INDEX appeals_submitted_by_user_id_idx ON appeals (submitted_by_user_id);
CREATE INDEX appeals_assigned_reviewer_id_idx ON appeals (assigned_reviewer_id);
CREATE INDEX appeals_decided_by_idx ON appeals (decided_by);
CREATE INDEX appeals_status_idx ON appeals (status);

CREATE TRIGGER appeals_set_updated_at
  BEFORE UPDATE ON appeals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER appeals_forbid_delete
  BEFORE DELETE ON appeals
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER appeals_forbid_truncate
  BEFORE TRUNCATE ON appeals
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE appeals IS 'Player appeals against a case verdict. Never deleted.';

CREATE TABLE reviews (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          uuid        NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  reviewer_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind             text        NOT NULL,
  previous_verdict text        NULL,
  new_verdict      text        NULL,
  comment          text        NOT NULL,
  appeal_id        uuid        NULL REFERENCES appeals (id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT reviews_kind_check CHECK (
    kind IN ('review_started', 'verdict_set', 'note', 'appeal_decision', 'reopened')
  ),
  CONSTRAINT reviews_previous_verdict_check CHECK (
    previous_verdict IN ('unknown', 'inconclusive', 'confirmed', 'rejected')
  ),
  CONSTRAINT reviews_new_verdict_check CHECK (
    new_verdict IN ('unknown', 'inconclusive', 'confirmed', 'rejected')
  ),
  CONSTRAINT reviews_comment_check CHECK (char_length(comment) <= 5000),
  CONSTRAINT reviews_verdict_set_check CHECK (kind <> 'verdict_set' OR new_verdict IS NOT NULL),
  CONSTRAINT reviews_appeal_decision_check CHECK (kind <> 'appeal_decision' OR appeal_id IS NOT NULL)
);

CREATE INDEX reviews_case_id_created_at_idx ON reviews (case_id, created_at);
CREATE INDEX reviews_reviewer_user_id_idx ON reviews (reviewer_user_id);
CREATE INDEX reviews_appeal_id_idx ON reviews (appeal_id);

CREATE TRIGGER reviews_forbid_update
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER reviews_forbid_delete
  BEFORE DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER reviews_forbid_truncate
  BEFORE TRUNCATE ON reviews
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE reviews IS 'Append-only case review history (review start, notes, verdicts, appeal decisions).';

CREATE TABLE case_server_confirmations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id              uuid        NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  server_id            uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  confirmed_by_user_id uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  note                 text        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  revoked_at           timestamptz NULL,
  revoked_by           uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  revoke_reason        text        NULL,

  CONSTRAINT case_server_confirmations_note_check CHECK (char_length(note) <= 1000),
  CONSTRAINT case_server_confirmations_revoke_reason_check CHECK (char_length(revoke_reason) <= 1000)
);

-- One active confirmation per (case, server).
CREATE UNIQUE INDEX case_server_confirmations_one_active_key
  ON case_server_confirmations (case_id, server_id)
  WHERE revoked_at IS NULL;
CREATE INDEX case_server_confirmations_case_id_idx ON case_server_confirmations (case_id);
CREATE INDEX case_server_confirmations_server_id_idx ON case_server_confirmations (server_id);
CREATE INDEX case_server_confirmations_confirmed_by_user_id_idx ON case_server_confirmations (confirmed_by_user_id);
CREATE INDEX case_server_confirmations_revoked_by_idx ON case_server_confirmations (revoked_by);

-- Confirmations are only ever revoked (soft); a revoked row is frozen.
CREATE FUNCTION case_server_confirmation_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed text[];
BEGIN
  changed := changed_columns(to_jsonb(OLD), to_jsonb(NEW), ARRAY['revoked_at', 'revoked_by', 'revoke_reason']);
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TN403',
      MESSAGE = format('UPDATE of column(s) %s on table "%s" is forbidden',
                       array_to_string(changed, ', '), TG_TABLE_NAME),
      DETAIL = 'A server confirmation can only be revoked.',
      SCHEMA = TG_TABLE_SCHEMA,
      TABLE = TG_TABLE_NAME,
      COLUMN = changed[1];
  END IF;
  IF OLD.revoked_at IS NOT NULL
     AND (NEW.revoked_at, NEW.revoked_by, NEW.revoke_reason)
         IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by, OLD.revoke_reason) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TN403',
      MESSAGE = format('Revoked rows of table "%s" cannot be changed', TG_TABLE_NAME),
      DETAIL = 'Create a new confirmation instead of reinstating a revoked one.',
      SCHEMA = TG_TABLE_SCHEMA,
      TABLE = TG_TABLE_NAME,
      COLUMN = 'revoked_at';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_server_confirmations_guard_update
  BEFORE UPDATE ON case_server_confirmations
  FOR EACH ROW EXECUTE FUNCTION case_server_confirmation_guard_update();
CREATE TRIGGER case_server_confirmations_forbid_delete
  BEFORE DELETE ON case_server_confirmations
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER case_server_confirmations_forbid_truncate
  BEFORE TRUNCATE ON case_server_confirmations
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE case_server_confirmations IS
  'A server (owner/admin member) confirms a case. Soft-revocable, never deleted; never changes verdicts automatically.';
