# Production deployment

The platform consists of one stateless backend process (API + background jobs), a static web
panel, PostgreSQL 16, Redis 7 and evidence storage (local disk or S3-compatible). Docker is
supported ([§3](#3-deployment-with-docker)) but not required ([§4](#4-deployment-without-docker)).
Configuration is exclusively environment variables — [CONFIGURATION.md](./CONFIGURATION.md) is the
reference and ends with a production checklist.

## 1. Topology

```
Internet ──TLS──▶ reverse proxy (host nginx / load balancer)   https://trust.example.org
                     │  sets X-Forwarded-For = client, X-Forwarded-Proto = https
                     ▼
                  web (nginx: static panel, /api → backend)   ── or directly ──▶ backend :3000
                     ▼
                  backend (Node 22) ──▶ PostgreSQL (runtime role)   Redis   evidence storage
```

* Panel and API share **one origin** (`WEB_ORIGIN` = `PUBLIC_BASE_URL` = `https://trust.example.org`);
  the session cookie is `SameSite=Lax; Secure` and CSRF checks compare `Origin` with `WEB_ORIGIN`.
* SCP:SL servers use the same origin (`api_base_url: https://trust.example.org` in the plugin config).
  The plugin signs the path **including the query string** and the raw body: proxies must forward both
  unchanged (no URL normalisation, re-encoding, body rewriting or compression of requests).
* `/healthz` and `/readyz` are for your orchestrator/monitoring; the bundled nginx does not expose them.
* `TRUST_PROXY` must describe exactly the proxies you control, otherwise rate limits and network
  hashes are computed from spoofable `X-Forwarded-For` values (see §3.4 / §4.3).

## 2. Secrets

```bash
openssl rand -base64 32      # once per variable: JWT_SECRET, SESSION_SECRET, DATA_ENCRYPTION_KEY, IP_HASH_SECRET
scripts/generate-secrets.sh  # prints all four at once
```

All four are required with `NODE_ENV=production`, must be distinct and strong (the backend refuses
to start otherwise). Store them in a secret manager or root-only files (`chmod 600`).

| Secret | Effect of loss / rotation |
|---|---|
| `SESSION_SECRET` | rotation logs every user out and invalidates CSRF tokens |
| `JWT_SECRET` | rotation only invalidates evidence download tickets (60 s lifetime) |
| `DATA_ENCRYPTION_KEY` | **loss makes all stored TOTP secrets and Overwatch session secrets unreadable** — back it up |
| `IP_HASH_SECRET` | rotation breaks alt-account correlation with older network observations ([PRIVACY.md](./PRIVACY.md#6-ip_hash_secret-rotation)) — back it up |

Database passwords: `scripts/generate-secrets.sh --postgres` (URL-safe values for connection strings).

## 3. Deployment with Docker

Files: [`docker-compose.prod.yml`](../docker-compose.prod.yml), [`backend/Dockerfile`](../backend/Dockerfile),
[`web/Dockerfile`](../web/Dockerfile) + [`web/nginx.conf`](../web/nginx.conf).

### 3.1 Images

* **backend** — multi-stage build on `node:22-bookworm-slim`: `pnpm fetch` + offline install of the
  backend and `shared`, `tsup` builds, then `pnpm deploy --prod --legacy` produces a tree with only
  production dependencies. The runtime stage contains `dist/`, `migrations/` (next to `dist/`, found
  automatically; `MIGRATIONS_DIR=/app/migrations` is set as well) and `node_modules/`, runs as the
  unprivileged `node` user and writes only to `/data` (local evidence storage). `argon2` loads its
  prebuilt glibc binary, so no compiler is installed. `HEALTHCHECK` calls `/healthz`.
  Entrypoint commands (`scripts/docker/backend-entrypoint.sh`):

  | Command | Action |
  |---|---|
  | `serve` (default) | if `AUTO_MIGRATE=true`: run migrations first (abort on failure), then start the API with `AUTO_MIGRATE=false` |
  | `migrate [--status]` | apply / list migrations, exit |
  | `create-admin --email … --username …` | bootstrap a verified `super_admin` (hidden password prompt — `docker compose run`/`exec` allocate a TTY by default — or `ADMIN_PASSWORD`) |
  | `verify-audit [--from-seq N] [--limit N] [--record] [--json]` | recompute the audit hash chain (exit 2 when broken) |

  `MIGRATE_DATABASE_URL` (entrypoint only): connection string of the schema **owner** used for
  migrations; it is removed from the environment before the API starts, which uses `DATABASE_URL`
  (runtime role).
* **web** — Vite build served by `nginxinc/nginx-unprivileged` (uid 101, port 8080): SPA fallback,
  `/api/` proxied to `BACKEND_UPSTREAM` (default `backend:3000`, resolved at request time through
  `NGINX_RESOLVER`, default Docker's `127.0.0.11`), gzip, `Cache-Control: public, max-age=31536000,
  immutable` for hashed `/assets/`, `no-cache` for `index.html`, and CSP / `X-Frame-Options` /
  `nosniff` / `Referrer-Policy` / `Permissions-Policy` / COOP on panel responses (the CSP contains the
  SHA-256 of the inline theme script, computed during the image build). API responses keep the
  backend's own security headers. `CLIENT_MAX_BODY_SIZE` (default `520m`) must be ≥ `EVIDENCE_MAX_BYTES`
  plus multipart overhead.

### 3.2 First installation

```bash
scripts/generate-secrets.sh --postgres > .env.postgres
set -a; . ./.env.postgres; set +a
scripts/generate-secrets.sh --env > .env.production   # fills the DB passwords from the variables above
chmod 600 .env.postgres .env.production
$EDITOR .env.production      # PUBLIC_BASE_URL, WEB_ORIGIN, SMTP_URL, MAIL_FROM, storage, TRUST_PROXY

docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml run --rm backend migrate
docker compose -f docker-compose.prod.yml exec postgres \
  sh -c 'psql -U "$SCPSL_OWNER_ROLE" -d "$SCPSL_DB_NAME" -v app="$SCPSL_APP_ROLE" -f /opt/scpsl/post-migrate-grants.sql'
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml run --rm backend create-admin --email admin@example.org --username admin
```

On its first start with an empty volume the postgres container runs
[`scripts/db/init-roles.sh`](../scripts/db/init-roles.sh): it creates the database, the owner role and
the runtime role, and sets default privileges (§5). The generated `.env.production` sets
`AUTO_MIGRATE=true` with `MIGRATE_DATABASE_URL`, so later upgrades migrate on start; set
`AUTO_MIGRATE=false` if you prefer the explicit `run --rm backend migrate` step (it also keeps the
owner credential out of the long-running container's environment).

What the production compose file does: `restart: always`, JSON-file log rotation, PostgreSQL and Redis
only on an `internal` network without published ports, Redis with AOF persistence and
`noeviction`, backend with a read-only root filesystem, `no-new-privileges` and all capabilities
dropped. `web` (`8080`) and `backend` (`3000`) are published on `${BIND_ADDRESS:-127.0.0.1}` only —
put a TLS reverse proxy in front (§3.3). Image names can be overridden with `BACKEND_IMAGE` /
`WEB_IMAGE` (e.g. images built in CI and pushed to your registry).

### 3.3 TLS reverse proxy (host nginx)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name trust.example.org;

    ssl_certificate     /etc/letsencrypt/live/trust.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/trust.example.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    client_max_body_size 520m;           # ≥ EVIDENCE_MAX_BYTES + multipart overhead

    location / {
        proxy_pass http://127.0.0.1:8080;   # no URI part: request line forwarded unchanged
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never trust client-supplied values
        proxy_set_header X-Forwarded-Proto https;
        proxy_request_buffering off;          # stream evidence uploads
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
server {
    listen 80;
    server_name trust.example.org;
    return 301 https://$host$request_uri;
}
```

### 3.4 `TRUST_PROXY` with Docker

Host proxy → `web` → `backend` are two hops: `TRUST_PROXY=2` (the value written by
`generate-secrets.sh --env`). The host proxy must *overwrite* `X-Forwarded-For` as above. If plugins
reach the published backend port through the host proxy directly (host proxy → backend), that path is
also correct with `TRUST_PROXY=2` only because the host proxy overwrites the header; the simplest
setup is to send everything through `web`.

## 4. Deployment without Docker

### 4.1 Build

```bash
# on a build host with Node 22 + pnpm 10
pnpm install --frozen-lockfile
pnpm --filter @scpsl-trust/shared build
pnpm --filter @scpsl-trust/backend build
pnpm --filter @scpsl-trust/backend deploy --prod --legacy /tmp/scpsl-trust-backend
#   → package.json, dist/, migrations/, node_modules/ (production dependencies only)
VITE_REGISTRATION_ENABLED=true pnpm --filter @scpsl-trust/web build     # → web/dist/
```

Copy `/tmp/scpsl-trust-backend/{package.json,dist,migrations,node_modules}` to
`/opt/scpsl-trust/backend/` and `web/dist/` to `/var/www/scpsl-trust/` on a host with the same OS
family and CPU architecture (argon2 ships prebuilt binaries for linux x64/arm64, glibc and musl).

```bash
useradd --system --home /var/lib/scpsl-trust --shell /usr/sbin/nologin scpsl-trust
install -d -o scpsl-trust -g scpsl-trust -m 0750 /var/lib/scpsl-trust/evidence
install -d -m 0750 /etc/scpsl-trust
```

### 4.2 systemd

`/etc/scpsl-trust/backend.env` (mode `0640`, group `scpsl-trust`): `NODE_ENV=production`,
`HOST=127.0.0.1`, `PORT=3000`, `PUBLIC_BASE_URL`, `WEB_ORIGIN`, `TRUST_PROXY=1`,
`DATABASE_URL` (runtime role), `REDIS_URL`, the four secrets, mail and storage settings,
`STORAGE_LOCAL_DIR=/var/lib/scpsl-trust/evidence`, `LOG_PRETTY=false`.
`/etc/scpsl-trust/migrate.env` (mode `0600`, root): `DATABASE_URL` of the **owner** role.

`/etc/systemd/system/scpsl-trust-backend.service`:

```ini
[Unit]
Description=SCP:SL Trust Network backend
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=scpsl-trust
Group=scpsl-trust
WorkingDirectory=/opt/scpsl-trust/backend
EnvironmentFile=/etc/scpsl-trust/backend.env
ExecStart=/usr/bin/node --enable-source-maps dist/index.js
Restart=on-failure
RestartSec=5
# SHUTDOWN_TIMEOUT_MS (10 s) + margin
TimeoutStopSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
CapabilityBoundingSet=
ReadWritePaths=/var/lib/scpsl-trust

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/scpsl-trust-migrate.service` (run explicitly during installs and upgrades):

```ini
[Unit]
Description=SCP:SL Trust Network database migrations
After=network-online.target postgresql.service

[Service]
Type=oneshot
User=scpsl-trust
WorkingDirectory=/opt/scpsl-trust/backend
EnvironmentFile=/etc/scpsl-trust/migrate.env
ExecStart=/usr/bin/node dist/cli/migrate.js
```

```bash
systemctl daemon-reload
systemctl start scpsl-trust-migrate          # journalctl -u scpsl-trust-migrate shows the applied files
systemctl enable --now scpsl-trust-backend
cd /opt/scpsl-trust/backend && sudo -u scpsl-trust sh -c \
  'set -a; . /etc/scpsl-trust/backend.env; set +a; exec node dist/cli/create-admin.js --email admin@example.org --username admin'
```

Background jobs (key retirement, retention, Overwatch expiry, whitelist/bypass expiry) run inside the
backend process (`JOBS_ENABLED=true`); no cron/timer is needed. Jobs take a Redis lock per run, so
several replicas can run behind a load balancer (Redis is required for multiple replicas).

### 4.3 nginx (TLS, static panel, API)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name trust.example.org;
    ssl_certificate     /etc/letsencrypt/live/trust.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/trust.example.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;

    root /var/www/scpsl-trust;
    client_max_body_size 520m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;        # no URI part → path + query forwarded unchanged
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options nosniff always;
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options nosniff always;
        add_header X-Frame-Options DENY always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
        # copy the CSP (incl. the inline-script hash) from web/nginx.conf; compute the hash with:
        #   node -e "const h=require('fs').readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
        #            console.log(require('crypto').createHash('sha256').update(h).digest('base64'))"
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'sha256-<hash>'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
    }
}
```

(`add_header` in a `location` replaces the server-level headers, hence the repetition.) With this
single proxy hop use `TRUST_PROXY=1` (or `TRUST_PROXY=127.0.0.1`).

## 5. Database roles and migrations

Follow [DATABASE.md §1.1](./DATABASE.md#11-roles-and-database): the schema **owner** (`scpsl_owner`)
runs migrations, the backend runs as **`scpsl_app`**, which does not own any table and therefore cannot
disable the protection triggers (R7, R8). [`scripts/db/init-roles.sh`](../scripts/db/init-roles.sh)
automates the superuser part (roles, database, schema ownership, default privileges; idempotent) and
[`scripts/db/post-migrate-grants.sql`](../scripts/db/post-migrate-grants.sql) the owner part
(grants on existing tables, `REVOKE UPDATE, DELETE, TRUNCATE ON audit_events`, read-only
`schema_migrations`):

```bash
PGHOST=db.internal PGUSER=postgres SCPSL_OWNER_PASSWORD=… SCPSL_APP_PASSWORD=… scripts/db/init-roles.sh
DATABASE_URL=postgres://scpsl_owner:…@db.internal/scpsl_trust node dist/cli/migrate.js
psql postgres://scpsl_owner:…@db.internal/scpsl_trust -v app=scpsl_app -f scripts/db/post-migrate-grants.sql
```

Migration facts ([DATABASE.md §1.2](./DATABASE.md#12-running-migrations)): forward-only plain SQL files,
one transaction per file, checksums of applied files are verified on every run (never edit an applied
migration), and a PostgreSQL advisory lock serialises concurrent migrators, so replicas starting with
`AUTO_MIGRATE=true` at the same time are safe. There are no down-migrations: a rollback is a restore
from backup (§7).

## 6. Evidence storage

| Option | Configuration | Notes |
|---|---|---|
| Local filesystem | `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR` (Docker: `/data/evidence` on the `backenddata` volume) | single backend host only; put it on persistent, backed-up storage |
| S3-compatible (AWS S3, MinIO, Ceph, Cloudflare R2, …) | `STORAGE_DRIVER=s3`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT` (non-AWS), `STORAGE_FORCE_PATH_STYLE=true` (MinIO and most self-hosted), `STORAGE_ACCESS_KEY` + `STORAGE_SECRET_KEY` or the AWS default credential chain | required for several replicas |

Bucket recommendations: private (block all public access — downloads always go through the backend's
permission check and audit), server-side encryption, versioning or object lock (evidence is immutable by
design; the backend never deletes objects), a dedicated credential limited to that bucket with
`s3:PutObject`, `s3:GetObject`, `s3:AbortMultipartUpload` and `s3:ListBucket` (the driver uses
`HeadBucket` for readiness and `HeadObject`/`GetObject` for downloads and `?verify=true` re-hashing).
Uploads use multipart streaming, so large files never sit in memory.

## 7. Backups

| What | How | Why |
|---|---|---|
| PostgreSQL | `pg_dump -Fc -U scpsl_owner scpsl_trust > scpsl_trust-$(date +%F).dump` (Docker: `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -Fc -U scpsl_owner scpsl_trust > …`), or continuous WAL archiving / PITR | system of record, includes the audit chain |
| Evidence | the `backenddata` volume / `STORAGE_LOCAL_DIR` (e.g. restic, rsync), or bucket replication/versioning | files are referenced by `storage_key` and verified by SHA-256 |
| Secrets | `DATA_ENCRYPTION_KEY`, `IP_HASH_SECRET`, `SESSION_SECRET`, `JWT_SECRET` and the env files, stored separately from data backups | not recoverable from the database |
| Redis | not required (nonces, rate limits, caches, short-lived tokens only); AOF is enabled so a restart keeps the replay-protection window | |
| SCP:SL servers | each server's `configs/<port>/ScpslTrust/identity.json` (backed up by the server owner) | a lost key needs a new registration token |

After a restore, run `verify-audit` (Docker: `docker compose -f docker-compose.prod.yml run --rm backend verify-audit`)
and a test download with `GET /api/v1/evidence/{id}?verify=true`. Test restores regularly.

## 8. Logs and monitoring

The backend writes structured JSON (pino) to stdout: `time, level, request_id, server_id?, user_id?,
method, route, status_code, latency_ms, result`. Sensitive headers and fields (cookies, signatures, CSRF
tokens, passwords, tokens, secrets, codes, IPs) are redacted; bodies are never logged; client IPs are
not logged unless `LOG_CLIENT_IP=true`, and then only as a network hash. Keep `LOG_PRETTY=false`
(`pino-pretty` is not installed in production).

* systemd: journald (`journalctl -u scpsl-trust-backend -o cat`), forward with your journald shipper.
* Docker: `json-file` driver with rotation (20 MB × 5) in `docker-compose.prod.yml`; ship with Vector,
  Fluent Bit, Promtail or switch the logging driver (e.g. `journald`, `gelf`, `awslogs`).
* Useful alerts: `GET /readyz` ≠ 200, `level >= 50` (error), bursts of `INVALID_SIGNATURE`,
  `REPLAYED_NONCE`, `RATE_LIMITED` or `ACCOUNT_LOCKED`, and a failing scheduled `verify-audit`
  (exit code 2 = chain broken; e.g. a daily `docker compose … run --rm backend verify-audit --record`).

## 9. Upgrade procedure

1. Read the release notes / diff of `backend/migrations/` and `.env.example` for new variables.
2. Back up the database (§7).
3. Build (or pull) the new images: `docker compose -f docker-compose.prod.yml build`
   (without Docker: §4.1, deploy into a new directory and switch a symlink).
4. Apply migrations as the owner: `docker compose -f docker-compose.prod.yml run --rm backend migrate`
   (or rely on `AUTO_MIGRATE=true`; without Docker `systemctl start scpsl-trust-migrate`). If a
   migration added tables, re-run `post-migrate-grants.sql` (idempotent) — default privileges already
   cover them, the script only re-asserts the audit/migration table revokes.
5. Restart: `docker compose -f docker-compose.prod.yml up -d` (without Docker
   `systemctl restart scpsl-trust-backend`). Shutdown is graceful (`SHUTDOWN_TIMEOUT_MS`).
6. Check `GET /readyz`, log in, and run `verify-audit`.

Rollback: stop the backend, restore the pre-upgrade dump, start the previous image/directory.

## 10. Plugin updates (SCP:SL servers)

1. Build: `cd plugin && dotnet build ScpslTrust.sln -c Release -p:SCPSL_MANAGED_DIR=<server>/SCPSL_Data/Managed`
   (build against the game version you run) — outputs `plugin/dist/plugins/ScpslTrust.Plugin.dll` and
   `plugin/dist/dependencies/ScpslTrust.Core.dll`.
2. Stop the SCP:SL server (LabAPI loads plugins at startup), replace both DLLs in `LabAPI/plugins/…` and
   `LabAPI/dependencies/…` ([PLUGIN.md §4](./PLUGIN.md#4-installation)). Do **not** touch
   `configs/<port>/ScpslTrust/identity.json`; `config.yml` keeps your settings (compare new keys with
   [PLUGIN.md §5](./PLUGIN.md#5-configuration-reference-configyml)).
3. Start the server and run `trust status` in the console; the backend shows the new `plugin_version`
   after the next signed request/heartbeat.
4. Optional: rotate the key (`trust rotatekey`, [SERVER_REGISTRATION.md §3](./SERVER_REGISTRATION.md#3-key-rotation)).

A backend upgrade does not require a plugin update unless the release notes say so; the request
signing format is versioned (`SCPSL-TRUST-V1`).
