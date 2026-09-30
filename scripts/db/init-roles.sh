#!/bin/sh
# Creates the database and the two application roles of docs/DATABASE.md §1.1:
#
#   owner role   (SCPSL_OWNER_ROLE, default scpsl_owner)  owns the schema, runs the migrations
#   runtime role (SCPSL_APP_ROLE,   default scpsl_app)    used by the backend; does NOT own the
#                tables, so it cannot disable the protection triggers (R7/R8)
#
# Used as /docker-entrypoint-initdb.d script of the postgres container (docker-compose.prod.yml),
# or by hand against any PostgreSQL ≥ 13 as a superuser:
#
#   PGHOST=db.internal PGUSER=postgres SCPSL_OWNER_PASSWORD=… SCPSL_APP_PASSWORD=… scripts/db/init-roles.sh
#
# After the first `migrate`, run scripts/db/post-migrate-grants.sql once as the owner role.
set -eu

: "${SCPSL_OWNER_PASSWORD:?SCPSL_OWNER_PASSWORD is required}"
: "${SCPSL_APP_PASSWORD:?SCPSL_APP_PASSWORD is required}"
SCPSL_DB_NAME="${SCPSL_DB_NAME:-scpsl_trust}"
SCPSL_OWNER_ROLE="${SCPSL_OWNER_ROLE:-scpsl_owner}"
SCPSL_APP_ROLE="${SCPSL_APP_ROLE:-scpsl_app}"

# Inside the official image the superuser is POSTGRES_USER on the local socket.
if [ -n "${POSTGRES_USER:-}" ] && [ -z "${PGUSER:-}" ]; then
  PGUSER="$POSTGRES_USER"
  export PGUSER
fi

psql_super() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc -X "$@"
}

# Identifiers and passwords are passed as psql variables and quoted by psql (:"ident", :'literal').
psql_super -d postgres \
  -v db="$SCPSL_DB_NAME" -v owner="$SCPSL_OWNER_ROLE" -v app="$SCPSL_APP_ROLE" \
  -v owner_pw="$SCPSL_OWNER_PASSWORD" -v app_pw="$SCPSL_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
ALTER ROLE :"owner" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'owner_pw';
ALTER ROLE :"app"   WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_pw';
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'owner')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL

psql_super -d "$SCPSL_DB_NAME" -v owner="$SCPSL_OWNER_ROLE" -v app="$SCPSL_APP_ROLE" -v db="$SCPSL_DB_NAME" <<'SQL'
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO :"app";
ALTER SCHEMA public OWNER TO :"owner";
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app";
-- tables and sequences created later by the owner (migrations) are usable by the runtime role
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO :"app";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner" IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO :"app";
SQL

echo "init-roles: database ${SCPSL_DB_NAME}, owner ${SCPSL_OWNER_ROLE}, runtime role ${SCPSL_APP_ROLE} ready"
