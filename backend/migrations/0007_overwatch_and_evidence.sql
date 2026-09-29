-- 0007: Overwatch proof sessions and evidence (ARCHITECTURE §4.6, §4.7, §10, §11.3).
-- Evidence rows are immutable except for their review status columns;
-- a replacement is a new row (supersedes_evidence_id) - history is preserved (R7).

CREATE TABLE overwatch_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id           uuid        NOT NULL REFERENCES servers (id) ON DELETE RESTRICT,
  target_player_id    uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  spectator_player_id uuid        NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  secret_enc          text        NULL,
  interval_seconds    integer     NOT NULL DEFAULT 10,
  status              text        NOT NULL DEFAULT 'active',
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz NULL,
  last_heartbeat_at   timestamptz NOT NULL,
  end_reason          text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT overwatch_sessions_interval_seconds_check CHECK (interval_seconds BETWEEN 5 AND 60),
  CONSTRAINT overwatch_sessions_status_check CHECK (status IN ('active', 'ended', 'expired')),
  CONSTRAINT overwatch_sessions_secret_enc_check CHECK (
    char_length(secret_enc) <= 512
    AND secret_enc ~ '^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$'
  ),
  CONSTRAINT overwatch_sessions_end_reason_check CHECK (end_reason ~ '^[a-z][a-z_]{0,63}$')
);

CREATE INDEX overwatch_sessions_lookup_idx
  ON overwatch_sessions (server_id, target_player_id, spectator_player_id, started_at);
CREATE INDEX overwatch_sessions_target_player_id_idx ON overwatch_sessions (target_player_id);
CREATE INDEX overwatch_sessions_spectator_player_id_idx ON overwatch_sessions (spectator_player_id);
CREATE INDEX overwatch_sessions_status_last_heartbeat_at_idx ON overwatch_sessions (status, last_heartbeat_at);
CREATE INDEX overwatch_sessions_started_at_idx ON overwatch_sessions (started_at);

COMMENT ON TABLE overwatch_sessions IS
  'Overwatch proof sessions (id = session_id). A valid proof establishes recording identity only, never guilt (R6).';
COMMENT ON COLUMN overwatch_sessions.secret_enc IS
  'AES-256-GCM encrypted 32-byte HMAC secret; wiped after retention (proofs then become unverifiable).';

CREATE TABLE evidence (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                   uuid        NOT NULL REFERENCES cases (id) ON DELETE RESTRICT,
  report_id                 uuid        NULL REFERENCES reports (id) ON DELETE RESTRICT,
  type                      text        NOT NULL,
  title                     text        NOT NULL,
  description               text        NULL,
  status                    text        NOT NULL DEFAULT 'unverified',
  identity_status           text        NOT NULL DEFAULT 'unverified',
  authenticity_status       text        NOT NULL DEFAULT 'unverified',
  cheating_status           text        NOT NULL DEFAULT 'unverified',
  sha256                    char(64)    NULL,
  size_bytes                bigint      NULL,
  mime_type                 text        NULL,
  original_filename         text        NULL,
  storage_key               text        NULL,
  external_url              text        NULL,
  uploaded_at               timestamptz NOT NULL DEFAULT now(),
  uploader_user_id          uuid        NULL REFERENCES users (id) ON DELETE RESTRICT,
  uploader_server_id        uuid        NULL REFERENCES servers (id) ON DELETE RESTRICT,
  overwatch_session_id      uuid        NULL REFERENCES overwatch_sessions (id) ON DELETE RESTRICT,
  supersedes_evidence_id    uuid        NULL REFERENCES evidence (id) ON DELETE RESTRICT,
  superseded_by_evidence_id uuid        NULL REFERENCES evidence (id) ON DELETE RESTRICT,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_storage_key_key UNIQUE (storage_key),
  CONSTRAINT evidence_supersedes_evidence_id_key UNIQUE (supersedes_evidence_id),
  CONSTRAINT evidence_type_check CHECK (
    type IN ('video', 'image', 'log', 'demo', 'text', 'link', 'other')
  ),
  CONSTRAINT evidence_status_check CHECK (
    status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_identity_status_check CHECK (
    identity_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_authenticity_status_check CHECK (
    authenticity_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_cheating_status_check CHECK (
    cheating_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT evidence_description_check CHECK (char_length(description) <= 5000),
  CONSTRAINT evidence_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT evidence_size_bytes_check CHECK (size_bytes >= 0),
  CONSTRAINT evidence_mime_type_check CHECK (char_length(mime_type) <= 255),
  CONSTRAINT evidence_original_filename_check CHECK (char_length(original_filename) <= 255),
  CONSTRAINT evidence_storage_key_check CHECK (char_length(storage_key) BETWEEN 1 AND 1024),
  CONSTRAINT evidence_external_url_check CHECK (
    char_length(external_url) <= 2048 AND external_url ~* '^https://'
  ),
  -- link evidence is only a URL; everything else is a stored, hashed object
  CONSTRAINT evidence_content_check CHECK (
    (type = 'link'
      AND external_url IS NOT NULL AND sha256 IS NULL
      AND size_bytes IS NULL AND storage_key IS NULL)
    OR
    (type <> 'link'
      AND external_url IS NULL AND sha256 IS NOT NULL
      AND size_bytes IS NOT NULL AND mime_type IS NOT NULL AND storage_key IS NOT NULL)
  ),
  CONSTRAINT evidence_uploader_check CHECK (uploader_user_id IS NOT NULL OR uploader_server_id IS NOT NULL),
  CONSTRAINT evidence_supersedes_self_check CHECK (supersedes_evidence_id <> id),
  CONSTRAINT evidence_superseded_by_self_check CHECK (superseded_by_evidence_id <> id)
);

CREATE INDEX evidence_case_id_idx ON evidence (case_id);
CREATE INDEX evidence_status_idx ON evidence (status);
CREATE INDEX evidence_sha256_idx ON evidence (sha256);
CREATE INDEX evidence_report_id_idx ON evidence (report_id);
CREATE INDEX evidence_uploader_user_id_idx ON evidence (uploader_user_id);
CREATE INDEX evidence_uploader_server_id_idx ON evidence (uploader_server_id);
CREATE INDEX evidence_overwatch_session_id_idx ON evidence (overwatch_session_id);
CREATE INDEX evidence_superseded_by_evidence_id_idx ON evidence (superseded_by_evidence_id);

-- A superseding row must replace evidence of the same case that is not yet superseded.
CREATE FUNCTION evidence_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_case uuid;
  target_superseded_by uuid;
BEGIN
  IF NEW.superseded_by_evidence_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TN403',
      MESSAGE = 'superseded_by_evidence_id cannot be set on insert',
      SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, COLUMN = 'superseded_by_evidence_id';
  END IF;
  IF NEW.supersedes_evidence_id IS NOT NULL THEN
    SELECT case_id, superseded_by_evidence_id INTO target_case, target_superseded_by
    FROM evidence WHERE id = NEW.supersedes_evidence_id;
    IF FOUND AND (target_case <> NEW.case_id OR target_superseded_by IS NOT NULL) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'TN403',
        MESSAGE = 'Evidence can only supersede not-yet-superseded evidence of the same case',
        SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, COLUMN = 'supersedes_evidence_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Evidence is immutable: only the overall/assessment statuses (and updated_at)
-- change; superseded_by_evidence_id may be set exactly once, to the row that
-- supersedes this one.
CREATE FUNCTION evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed text[];
BEGIN
  changed := changed_columns(
    to_jsonb(OLD), to_jsonb(NEW),
    ARRAY['status', 'identity_status', 'authenticity_status', 'cheating_status',
          'superseded_by_evidence_id', 'updated_at']);
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TN403',
      MESSAGE = format('UPDATE of column(s) %s on table "evidence" is forbidden', array_to_string(changed, ', ')),
      DETAIL = 'Evidence is immutable (ARCHITECTURE R7); upload a superseding evidence object instead.',
      SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, COLUMN = changed[1];
  END IF;

  IF NEW.superseded_by_evidence_id IS DISTINCT FROM OLD.superseded_by_evidence_id THEN
    IF OLD.superseded_by_evidence_id IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'TN403',
        MESSAGE = 'superseded_by_evidence_id can only be set once',
        SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, COLUMN = 'superseded_by_evidence_id';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM evidence
      WHERE id = NEW.superseded_by_evidence_id AND supersedes_evidence_id = OLD.id
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'TN403',
        MESSAGE = 'superseded_by_evidence_id must reference the evidence that supersedes this row',
        SCHEMA = TG_TABLE_SCHEMA, TABLE = TG_TABLE_NAME, COLUMN = 'superseded_by_evidence_id';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_guard_insert
  BEFORE INSERT ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_guard_insert();
CREATE TRIGGER evidence_guard_update
  BEFORE UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_guard_update();
CREATE TRIGGER evidence_set_updated_at
  BEFORE UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER evidence_forbid_delete
  BEFORE DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER evidence_forbid_truncate
  BEFORE TRUNCATE ON evidence
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE evidence IS
  'Evidence metadata. Identity, authenticity and cheating are assessed independently (R2). Immutable except statuses.';
COMMENT ON COLUMN evidence.sha256 IS 'Lower-case hex SHA-256 of the stored object; NULL only for link evidence.';
COMMENT ON COLUMN evidence.status IS 'Overall review status (latest evidence_reviews row).';
COMMENT ON COLUMN evidence.identity_status IS 'Q1: is the identity of the recorded player correct?';
COMMENT ON COLUMN evidence.authenticity_status IS 'Q2: is the evidence authentic?';
COMMENT ON COLUMN evidence.cheating_status IS 'Q3: does it demonstrate cheating?';

CREATE TABLE evidence_reviews (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id         uuid        NOT NULL REFERENCES evidence (id) ON DELETE RESTRICT,
  reviewer_user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status              text        NOT NULL,
  identity_status     text        NOT NULL,
  authenticity_status text        NOT NULL,
  cheating_status     text        NOT NULL,
  comment             text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT evidence_reviews_status_check CHECK (
    status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_reviews_identity_status_check CHECK (
    identity_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_reviews_authenticity_status_check CHECK (
    authenticity_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_reviews_cheating_status_check CHECK (
    cheating_status IN ('unverified', 'verified', 'rejected', 'inconclusive')
  ),
  CONSTRAINT evidence_reviews_comment_check CHECK (char_length(comment) BETWEEN 1 AND 5000)
);

CREATE INDEX evidence_reviews_evidence_id_created_at_idx ON evidence_reviews (evidence_id, created_at);
CREATE INDEX evidence_reviews_reviewer_user_id_idx ON evidence_reviews (reviewer_user_id);

CREATE TRIGGER evidence_reviews_forbid_update
  BEFORE UPDATE ON evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_update();
CREATE TRIGGER evidence_reviews_forbid_delete
  BEFORE DELETE ON evidence_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();
CREATE TRIGGER evidence_reviews_forbid_truncate
  BEFORE TRUNCATE ON evidence_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_truncate();

COMMENT ON TABLE evidence_reviews IS
  'Append-only evidence assessments; the latest row determines the current values on evidence.';
