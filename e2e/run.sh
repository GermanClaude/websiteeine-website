#!/usr/bin/env bash
# End-to-end verification: real backend (tsx) + real PostgreSQL/Redis + real DevClient binary.
# Usage: e2e/run.sh [--skip-build] [--keep-db] [--skip-web]   (see docs/E2E.md)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
E2E="$ROOT/e2e"
DATA="$E2E/.data"
SKIP_BUILD=0; KEEP_DB=0; SKIP_WEB=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --keep-db) KEEP_DB=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    *) echo "unknown option $arg" >&2; exit 64 ;;
  esac
done

export DOTNET_ROOT="${DOTNET_ROOT:-/opt/dotnet}"
export PATH="$DOTNET_ROOT:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
PG_ADMIN_URL="${E2E_PG_ADMIN_URL:-postgres://scpsl:scpsl@localhost:5432/postgres}"
DB_NAME="${E2E_DB_NAME:-scpsl_trust_e2e}"
PORT="${E2E_PORT:-3200}"
SCPSL_MANAGED_DIR="${SCPSL_MANAGED_DIR:-/opt/scpsl/SCPSL_Data/Managed}"

rm -rf "$DATA/evidence" "$DATA/identities" "$DATA/mail"
mkdir -p "$DATA/evidence" "$DATA/identities" "$DATA/mail"

# --- backend environment -------------------------------------------------------------
rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('$2'))"; }
export NODE_ENV=development
export DATABASE_URL="postgres://scpsl:scpsl@localhost:5432/$DB_NAME"
export REDIS_URL="${E2E_REDIS_URL:-redis://localhost:6379/14}"
export REDIS_KEY_PREFIX="e2e$(date +%s):"
export PORT HOST=127.0.0.1
export PUBLIC_BASE_URL="http://127.0.0.1:$PORT"
export WEB_ORIGIN="http://127.0.0.1:$PORT"
export COOKIE_SECURE=false EMAIL_VERIFICATION_REQUIRED=false ALLOW_REGISTRATION=true
export MAIL_TRANSPORT=file MAIL_FILE_DIR="$DATA/mail"
export STORAGE_DRIVER=local STORAGE_LOCAL_DIR="$DATA/evidence"
export JOBS_ENABLED=true OPENAPI_UI=true LOG_LEVEL=info
export KEY_ROTATION_GRACE_SECONDS=2
export JWT_SECRET="$(rand 48 base64url)" SESSION_SECRET="$(rand 48 base64url)"
export DATA_ENCRYPTION_KEY="$(rand 32 base64)" IP_HASH_SECRET="$(rand 32 base64url)"
export ADMIN_EMAIL="admin@e2e.test" ADMIN_USERNAME="e2e_admin" ADMIN_PASSWORD="Correct-Horse-Battery-9"

BACKEND_PID=""
cleanup() {
  local code=$?
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ "$KEEP_DB" == 0 ]]; then
    psql "$PG_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  echo "logs: $DATA/backend.log"
  exit "$code"
}
trap cleanup EXIT INT TERM

echo "== setup"
psql "$PG_ADMIN_URL" -q -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" >/dev/null 2>&1
psql "$PG_ADMIN_URL" -q -c "CREATE DATABASE $DB_NAME" >/dev/null
(cd "$ROOT/backend" && pnpm -s migrate) > "$DATA/migrate.log" 2>&1 || { cat "$DATA/migrate.log"; exit 1; }
(cd "$ROOT/backend" && pnpm -s cli:create-admin --email "$ADMIN_EMAIL" --username "$ADMIN_USERNAME") > "$DATA/create-admin.log" 2>&1 \
  || { cat "$DATA/create-admin.log"; exit 1; }

if [[ "$SKIP_BUILD" == 0 ]]; then
  echo "== building plugin solution + DevClient"
  (cd "$ROOT/plugin" && dotnet build ScpslTrust.sln -c Release -p:SCPSL_MANAGED_DIR="$SCPSL_MANAGED_DIR" -v q -nologo) > "$DATA/dotnet-build.log" 2>&1 \
    || { tail -40 "$DATA/dotnet-build.log"; exit 1; }
fi
export DEVCLIENT="$ROOT/plugin/tools/ScpslTrust.DevClient/bin/Release/net8.0/trust-devclient"
[[ -x "$DEVCLIENT" ]] || { echo "DevClient binary missing: $DEVCLIENT" >&2; exit 1; }

echo "== starting backend on :$PORT"
(cd "$ROOT/backend" && exec pnpm exec tsx src/index.ts) > "$DATA/backend.log" 2>&1 &
BACKEND_PID=$!
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$PORT/api/v1/time" >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { tail -40 "$DATA/backend.log"; exit 1; }
  sleep 0.5
done
curl -fsS "http://127.0.0.1:$PORT/api/v1/time" >/dev/null || { echo "backend did not start" >&2; tail -40 "$DATA/backend.log"; exit 1; }

export E2E_API="http://127.0.0.1:$PORT" E2E_DATA="$DATA" E2E_SKIP_WEB="$SKIP_WEB" E2E_ROOT="$ROOT"
node "$E2E/e2e.mjs"
