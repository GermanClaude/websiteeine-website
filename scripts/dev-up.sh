#!/bin/sh
# Starts PostgreSQL 16 and Redis 7 from docker-compose.yml for host-based development
# (docs/SETUP.md) and waits until both are healthy. The ports match .env.example
# (5432, 6379; override with POSTGRES_PORT / REDIS_PORT).
#
#   scripts/dev-up.sh            start postgres + redis
#   scripts/dev-up.sh storage    also start MinIO and create the evidence bucket
#   scripts/dev-up.sh down       stop the containers (volumes are kept)
set -eu

cd "$(dirname "$0")/.."

case "${1:-}" in
  down)
    exec docker compose --profile storage stop postgres redis minio
    ;;
  storage)
    docker compose --profile storage up -d --wait postgres redis minio
    docker compose --profile storage run --rm minio-init
    echo "MinIO: http://localhost:${MINIO_PORT:-9000} (console :${MINIO_CONSOLE_PORT:-9001}), bucket scpsl-trust-evidence"
    ;;
  "")
    docker compose up -d --wait postgres redis
    ;;
  *)
    echo "usage: $0 [storage|down]" >&2
    exit 1
    ;;
esac

# `scpsl` is a superuser in this container, so the backend test suite can create its throw-away
# databases with the default TEST_DATABASE_ADMIN_URL.
echo "PostgreSQL: postgres://scpsl:scpsl@localhost:${POSTGRES_PORT:-5432}/scpsl_trust"
echo "Redis:      redis://localhost:${REDIS_PORT:-6379}"
echo "Next: cp -n .env.example .env && pnpm migrate && pnpm dev:backend"
