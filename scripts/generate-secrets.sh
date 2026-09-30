#!/bin/sh
# Prints freshly generated secrets (openssl rand -base64 32, one distinct value per variable).
#
#   scripts/generate-secrets.sh              the four backend secrets as KEY=value lines
#   scripts/generate-secrets.sh --env        a production env-file skeleton for docker-compose.prod.yml
#   scripts/generate-secrets.sh --postgres   .env.postgres for docker-compose.prod.yml (role passwords)
#
# Redirect into a file and `chmod 600` it. Nothing is written by this script itself.
# Keep DATA_ENCRYPTION_KEY and IP_HASH_SECRET in your backup: they cannot be recovered from the
# database (docs/DEPLOYMENT.md, docs/PRIVACY.md).
set -eu

command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 1; }

secret() { openssl rand -base64 32; }
# URL-safe password (no / + =) for connection strings
password() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-40; }

secrets() {
  echo "JWT_SECRET=$(secret)"
  echo "SESSION_SECRET=$(secret)"
  echo "DATA_ENCRYPTION_KEY=$(secret)"
  echo "IP_HASH_SECRET=$(secret)"
}

mode="${1:-}"
case "$mode" in
  "")
    secrets
    ;;
  --postgres)
    echo "# docker-compose.prod.yml → postgres service (scripts/db/init-roles.sh)"
    echo "POSTGRES_USER=postgres"
    echo "POSTGRES_PASSWORD=$(password)"
    echo "POSTGRES_DB=postgres"
    echo "SCPSL_DB_NAME=scpsl_trust"
    echo "SCPSL_OWNER_ROLE=scpsl_owner"
    echo "SCPSL_OWNER_PASSWORD=$(password)"
    echo "SCPSL_APP_ROLE=scpsl_app"
    echo "SCPSL_APP_PASSWORD=$(password)"
    ;;
  --env)
    owner_pw="${SCPSL_OWNER_PASSWORD:-<SCPSL_OWNER_PASSWORD from .env.postgres>}"
    app_pw="${SCPSL_APP_PASSWORD:-<SCPSL_APP_PASSWORD from .env.postgres>}"
    cat <<EOF
# Production environment for docker-compose.prod.yml (docs/CONFIGURATION.md, docs/DEPLOYMENT.md).
NODE_ENV=production
PUBLIC_BASE_URL=https://trust.example.org
WEB_ORIGIN=https://trust.example.org
# host TLS proxy → web (nginx) → backend
TRUST_PROXY=2
COOKIE_SECURE=true

DATABASE_URL=postgres://scpsl_app:${app_pw}@postgres:5432/scpsl_trust
# schema owner, used only by the entrypoint for AUTO_MIGRATE / \`migrate\`
MIGRATE_DATABASE_URL=postgres://scpsl_owner:${owner_pw}@postgres:5432/scpsl_trust
AUTO_MIGRATE=true
REDIS_URL=redis://redis:6379

$(secrets)

MAIL_TRANSPORT=smtp
MAIL_FROM="SCP:SL Trust Network <no-reply@trust.example.org>"
SMTP_URL=smtps://user:password@mail.example.org:465

STORAGE_DRIVER=local
#STORAGE_DRIVER=s3
#STORAGE_ENDPOINT=https://s3.example.org
#STORAGE_REGION=us-east-1
#STORAGE_BUCKET=scpsl-trust-evidence
#STORAGE_ACCESS_KEY=
#STORAGE_SECRET_KEY=
#STORAGE_FORCE_PATH_STYLE=false

OPENAPI_UI=false
LOG_LEVEL=info
LOG_PRETTY=false
EOF
    ;;
  -h | --help)
    sed -n '2,10p' "$0"
    ;;
  *)
    echo "unknown option: $mode (see --help)" >&2
    exit 1
    ;;
esac
