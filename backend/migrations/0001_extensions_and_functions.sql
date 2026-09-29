-- 0001: extensions and shared helper / trigger functions.
--
-- Every protection trigger raises SQLSTATE 'TN403' ("forbidden operation") so the
-- application can map it reliably (see src/db/errors.ts: isForbiddenOperation).

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive e-mail addresses

-- ---------------------------------------------------------------------------
-- Pure helpers (usable in CHECK constraints)
-- ---------------------------------------------------------------------------

-- True when every element of arr is non-NULL and matches the regex pattern.
-- An empty array matches.
CREATE FUNCTION all_elements_match(arr text[], pattern text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(bool_and(e IS NOT NULL AND e ~ pattern), true)
  FROM unnest(arr) AS e
$$;

COMMENT ON FUNCTION all_elements_match(text[], text) IS
  'True when every array element is non-NULL and matches the regex (empty array = true).';

-- Names of the top-level keys whose values differ between two row images,
-- ignoring the keys listed in mutable_columns.
CREATE FUNCTION changed_columns(old_row jsonb, new_row jsonb, mutable_columns text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(array_agg(n.key ORDER BY n.key), '{}'::text[])
  FROM jsonb_each(new_row) AS n(key, value)
  WHERE NOT (n.key = ANY (coalesce(mutable_columns, '{}'::text[])))
    AND n.value IS DISTINCT FROM (old_row -> n.key)
$$;

COMMENT ON FUNCTION changed_columns(jsonb, jsonb, text[]) IS
  'Keys whose values differ between two row images, excluding the given mutable columns.';

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- BEFORE UPDATE row trigger: keeps updated_at current.
CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- BEFORE DELETE row trigger: history rows are never deleted (R7/R8).
-- Optional TG_ARGV[0] overrides the DETAIL text.
CREATE FUNCTION forbid_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'TN403',
    MESSAGE = format('DELETE on table "%s" is forbidden', TG_TABLE_NAME),
    DETAIL = coalesce(TG_ARGV[0],
      'Rows of this table are case history or audit records and are never deleted (ARCHITECTURE R7/R8).'),
    HINT = 'Record a status change, a revocation or a new superseding record instead.',
    SCHEMA = TG_TABLE_SCHEMA,
    TABLE = TG_TABLE_NAME;
END;
$$;

-- BEFORE UPDATE row trigger: append-only rows are never modified.
CREATE FUNCTION forbid_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'TN403',
    MESSAGE = format('UPDATE on table "%s" is forbidden', TG_TABLE_NAME),
    DETAIL = coalesce(TG_ARGV[0],
      'Rows of this table are append-only history and are never modified (ARCHITECTURE R7/R8).'),
    HINT = 'Insert a new record instead.',
    SCHEMA = TG_TABLE_SCHEMA,
    TABLE = TG_TABLE_NAME;
END;
$$;

-- BEFORE TRUNCATE statement trigger: TRUNCATE bypasses row-level DELETE
-- triggers, so every protected table also blocks it.
CREATE FUNCTION forbid_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'TN403',
    MESSAGE = format('TRUNCATE on table "%s" is forbidden', TG_TABLE_NAME),
    DETAIL = 'Rows of this table are case history or audit records and are never deleted (ARCHITECTURE R7/R8).',
    SCHEMA = TG_TABLE_SCHEMA,
    TABLE = TG_TABLE_NAME;
END;
$$;

-- BEFORE UPDATE row trigger: only the columns named in the trigger arguments
-- may change; every other column is immutable.
CREATE FUNCTION forbid_update_except()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed text[];
BEGIN
  changed := changed_columns(to_jsonb(OLD), to_jsonb(NEW), TG_ARGV);
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'TN403',
      MESSAGE = format('UPDATE of column(s) %s on table "%s" is forbidden',
                       array_to_string(changed, ', '), TG_TABLE_NAME),
      DETAIL = format('Only these columns may change: %s.',
                      coalesce(array_to_string(TG_ARGV, ', '), '(none)')),
      SCHEMA = TG_TABLE_SCHEMA,
      TABLE = TG_TABLE_NAME,
      COLUMN = changed[1];
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION forbid_update_except() IS
  'BEFORE UPDATE trigger: raises TN403 when a column not listed in the trigger arguments changes.';
