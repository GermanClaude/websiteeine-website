-- Run as the schema OWNER after migrations (first install: once after the first migrate;
-- afterwards whenever a migration adds tables — re-running is harmless).
--
--   psql "$MIGRATE_DATABASE_URL" -v app=scpsl_app -f scripts/db/post-migrate-grants.sql
--   docker compose -f docker-compose.prod.yml exec postgres \
--     sh -c 'psql -U scpsl_owner -d scpsl_trust -v app=scpsl_app -f /opt/scpsl/post-migrate-grants.sql'
--
-- Mirrors docs/DATABASE.md §1.1. The runtime role (:app) must NOT own any table.
\set ON_ERROR_STOP on

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";

-- defense in depth on top of the protection triggers (R7, R8)
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM :"app";
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON schema_migrations FROM :"app";
