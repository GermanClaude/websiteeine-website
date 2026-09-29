-- 0010: operational bookkeeping for background jobs (ARCHITECTURE §4.10).

CREATE TABLE job_runs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job         text        NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  result      text        NOT NULL DEFAULT 'running',
  details     jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT job_runs_job_check CHECK (job ~ '^[a-z][a-z0-9_-]{0,63}$'),
  CONSTRAINT job_runs_result_check CHECK (result IN ('running', 'succeeded', 'failed', 'skipped')),
  CONSTRAINT job_runs_finished_check CHECK ((result = 'running') = (finished_at IS NULL)),
  CONSTRAINT job_runs_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX job_runs_job_started_at_idx ON job_runs (job, started_at DESC);
CREATE INDEX job_runs_started_at_idx ON job_runs (started_at);

COMMENT ON TABLE job_runs IS 'History of background job runs; details holds small counters only (no personal data).';
