#!/bin/sh
# Entrypoint of the backend image (backend/Dockerfile).
#
#   serve                 (default) optionally migrate, then start the API + job scheduler
#   migrate [--status]    apply pending migrations (or list them) and exit
#   create-admin --email <e> --username <u>   bootstrap a verified super_admin (ADMIN_PASSWORD or prompt; use -it)
#   verify-audit [--from-seq N] [--limit N] [--record] [--json]
#   <anything else>       executed as-is (e.g. `sh`)
#
# Environment handled here (everything else is read by the backend, see docs/CONFIGURATION.md):
#   AUTO_MIGRATE=true        `serve` runs `node dist/cli/migrate.js` first and aborts on failure.
#                            The backend process itself is then started with AUTO_MIGRATE=false so
#                            the migrations are not run twice.
#   MIGRATE_DATABASE_URL     optional connection string of the schema OWNER role (docs/DATABASE.md
#                            §1.1). Used only for migrations; removed from the environment before the
#                            API starts, which then uses DATABASE_URL (the runtime role).
set -eu

# the image's WORKDIR; overridable for running the same layout outside a container
cd "${APP_HOME:-/app}"

is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    true | 1 | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

run_migrations() {
  if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
    DATABASE_URL="$MIGRATE_DATABASE_URL" node dist/cli/migrate.js "$@"
  else
    node dist/cli/migrate.js "$@"
  fi
}

command="${1:-serve}"
if [ "$#" -gt 0 ]; then shift; fi

case "$command" in
  serve)
    if is_true "${AUTO_MIGRATE:-false}"; then
      run_migrations
    fi
    unset MIGRATE_DATABASE_URL
    AUTO_MIGRATE=false
    export AUTO_MIGRATE
    exec node --enable-source-maps dist/index.js
    ;;
  migrate)
    run_migrations "$@"
    ;;
  create-admin)
    unset MIGRATE_DATABASE_URL
    exec node dist/cli/create-admin.js "$@"
    ;;
  verify-audit)
    unset MIGRATE_DATABASE_URL
    exec node dist/cli/verify-audit.js "$@"
    ;;
  *)
    exec "$command" "$@"
    ;;
esac
