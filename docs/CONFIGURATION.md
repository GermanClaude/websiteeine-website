# Configuration

The backend is configured exclusively through environment variables (ARCHITECTURE §16). They are
parsed and validated once at startup by [`backend/src/config.ts`](../backend/src/config.ts)
(`loadConfig()`); an invalid configuration stops the process before it listens, listing every
problem at once. [`.env.example`](../.env.example) in the repository root contains every variable
with safe local defaults.

General rules:

* Values are strings. Leading/trailing whitespace is trimmed and **empty values count as unset**
  (the default applies), so `FOO=` in a `.env` file does not override the default.
* Booleans accept `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive).
* Lists are comma-separated; entries are trimmed and empty entries dropped.
* Relative directories (`STORAGE_LOCAL_DIR`, `MAIL_FILE_DIR`, `VPN_CIDR_LIST_PATHS`) are resolved
  against the working directory of the process (`backend/` for `pnpm dev`; `backend/.data/` is git-ignored).
* Secret values are never echoed in error messages or logs.

## Development vs. production

`NODE_ENV=production` makes the following mandatory and refuses to start otherwise:

| Requirement | Reason |
|---|---|
| `PUBLIC_BASE_URL`, `WEB_ORIGIN`, `DATABASE_URL`, `REDIS_URL` | no implicit localhost defaults |
| `JWT_SECRET`, `SESSION_SECRET`, `IP_HASH_SECRET` present, distinct, ≥ 32 bytes of material, ≥ 128 bits estimated entropy, not a placeholder | weak secrets defeat sessions, CSRF, tickets and network hashing |
| `DATA_ENCRYPTION_KEY` base64 of exactly 32 bytes, not repetitive | AES-256-GCM key for secrets at rest |
| `MAIL_TRANSPORT=smtp` needs `SMTP_URL` and `MAIL_FROM`; `file` is refused | the file transport is a development aid |
| `STORAGE_DRIVER=s3` needs `STORAGE_BUCKET` (and both or neither access keys) | |

In `development`, missing secrets are replaced by **ephemeral random values** and a warning is
logged for each (`CONFIGURATION WARNING: …`). Sessions, encrypted 2FA/Overwatch secrets and network
hashes then do not survive a restart. Weak secrets only produce a warning. In `test` the same
fallbacks apply silently.

Generate secrets with:

```
openssl rand -base64 32      # JWT_SECRET, SESSION_SECRET, IP_HASH_SECRET, DATA_ENCRYPTION_KEY
```

Use a different value for each variable.

## Runtime

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | `development` | Environment mode (see above). |
| `PORT` | integer 1–65535 | `3000` | HTTP listen port. |
| `HOST` | string | `0.0.0.0` | HTTP listen address. |
| `PUBLIC_BASE_URL` | http(s) URL | `http://localhost:3000` (dev only) | Public URL of the API: links in e-mails, OpenAPI `servers`, second allowed origin for the CSRF Origin check. Trailing slashes are removed. |
| `WEB_ORIGIN` | origin `scheme://host[:port]` | `http://localhost:5173` (dev only) | The only origin allowed by CORS (with credentials) and by the CSRF `Origin`/`Referer` check. A path, query or fragment is rejected. |
| `TRUST_PROXY` | `false` \| `true` \| hop count 1–10 \| list of IPs/CIDRs/`loopback`/`linklocal`/`uniquelocal` | `false` | Fastify `trustProxy`: which `X-Forwarded-For` hops to believe. Client IPs feed rate limits, failure counters and network hashes, so trust only proxies you control. |
| `SHUTDOWN_TIMEOUT_MS` | integer 0–300000 | `10000` | Grace period for in-flight requests and running jobs on SIGTERM/SIGINT; the process exits forcibly 5 s later. |

## PostgreSQL

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `postgres://` / `postgresql://` URL | `postgres://scpsl:scpsl@localhost:5432/scpsl_trust` (dev only) | Application connection. Use the runtime role, not the schema owner (see [DATABASE.md](./DATABASE.md)). |
| `DATABASE_POOL_MAX` | integer 1–200 | `10` | Connection pool size per process. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | integer 0–3600000 | `30000` | `statement_timeout` for the application pool (0 = none). |
| `AUTO_MIGRATE` | boolean | `false` | Apply pending migrations at startup. Otherwise run `pnpm migrate` (needs the schema-owner role). |
| `MIGRATIONS_DIR` | path | `<backend package>/migrations` | Where the migrator looks for SQL files (used by `pnpm migrate` and `AUTO_MIGRATE`). |

## Redis

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `REDIS_URL` | `redis://` / `rediss://` URL | unset | Nonces and request ids (replay protection), rate-limit counters, failure counters, job locks, single-use MFA tokens, link codes, VPN cache. **Required in production.** Unset in development → in-memory stores (single process, lost on restart; warning logged). |
| `REDIS_KEY_PREFIX` | 1–32 chars `[A-Za-z0-9_.:-]` | `stn:` | Prefix of every key (share one Redis between deployments). |

## Secrets

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | ≥ 32 random bytes (base64/hex/text) | ephemeral (dev), required (prod) | Signs the 60-second evidence download tickets (`POST /evidence/{id}/ticket`). |
| `SESSION_SECRET` | ≥ 32 random bytes | ephemeral (dev), required (prod) | Signs the `stn_session` cookie (`@fastify/cookie`) and derives CSRF tokens (`HMAC-SHA256(SESSION_SECRET, "csrf:v1:" + session id)`). Rotating it invalidates every cookie (all users are logged out). |
| `DATA_ENCRYPTION_KEY` | base64 (standard or url-safe) of exactly 32 bytes | ephemeral (dev), required (prod) | AES-256-GCM key for secrets at rest: TOTP secrets and Overwatch session secrets, stored as `v1:<iv>:<ciphertext>:<tag>`. Losing the key makes every stored secret unreadable (users must re-enroll 2FA; proof verification of old sessions becomes impossible). There is no automatic re-encryption on rotation. |
| `IP_HASH_SECRET` | ≥ 32 random bytes | ephemeral (dev), required (prod) | HMAC key of the network hashes (`net:v1:` / `pfx:v1:`, ARCHITECTURE §8.1) and of pseudonymous client keys in failure counters. Raw IPs are never stored; rotating this key invalidates alt-account correlation with older observations. |

The three text secrets must differ from each other (error in production, warning otherwise).

## Web sessions and authentication

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `COOKIE_SECURE` | boolean | `true` | `Secure` flag of the session cookie and HSTS (`max-age` 1 year, `includeSubDomains`). Set `false` only for plain-HTTP local development; a production `false` is logged as a warning. |
| `SESSION_TTL_HOURS` | integer 1–8760 | `168` | Absolute session lifetime (7 days). |
| `SESSION_IDLE_TIMEOUT_MINUTES` | integer 5–525600 | `720` | Idle timeout (12 h); the idle window slides on use (refresh throttled to once per minute). A value above the absolute lifetime only produces a warning. |
| `EMAIL_VERIFICATION_REQUIRED` | boolean | `true` | Unverified users cannot log in (`403 EMAIL_NOT_VERIFIED`). |
| `ALLOW_REGISTRATION` | boolean | `true` | Enables `POST /auth/register`; otherwise `403 REGISTRATION_DISABLED`. |
| `REQUIRE_2FA_ROLES` | list of `UserRole` values, or `none` | `reviewer,moderator,admin,super_admin` | Users with these roles must enroll 2FA; until then their sessions are flagged `mfa_enrollment_required` and every permission-protected route (except `/auth/*` and `/me`) answers `403 MFA_ENROLLMENT_REQUIRED`. An empty list in production logs a warning. |
| `LOGIN_MAX_FAILURES` | integer 1–100 | `5` | Failed logins before the account is locked for `15 min × 2^(n − LOGIN_MAX_FAILURES)` (max 24 h). |

## Mail

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `MAIL_TRANSPORT` | `smtp` \| `file` \| `noop` | `smtp` (production), `file` (development), `noop` (test) | How e-mails (verification, password reset, notifications) are delivered. `file` writes an `.eml` and a `.json` per message into `MAIL_FILE_DIR` and is refused in production. `noop` discards mail (warning in production). |
| `MAIL_FROM` | RFC 5322 address, ≤ 320 chars | `SCP:SL Trust Network <no-reply@localhost>` (dev only) | Sender address. Required in production with `smtp`. |
| `SMTP_URL` | `smtp://` / `smtps://` URL | unset | nodemailer connection URL, e.g. `smtps://user:pass@mail.example.org:465`. Required with `MAIL_TRANSPORT=smtp`. Contains credentials: keep it out of logs and shell history. |
| `MAIL_FILE_DIR` | path | `./.data/mail` | Output directory of the `file` transport (created with mode 0700). |

## Evidence storage

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `STORAGE_DRIVER` | `local` \| `s3` | `local` | Object storage backend for evidence files. Both are write-once (existing objects are never overwritten, R7). |
| `STORAGE_LOCAL_DIR` | path | `./.data/evidence` | Root directory of the `local` driver (created with mode 0700; files 0600). Keys are validated and resolved strictly inside this directory. |
| `STORAGE_ENDPOINT` | http(s) URL | unset (AWS default endpoint) | Custom S3 endpoint (MinIO, Ceph, R2, …). |
| `STORAGE_REGION` | string ≤ 64 | `us-east-1` | S3 region. |
| `STORAGE_BUCKET` | bucket name | unset | Bucket for the `s3` driver (required with `s3`). |
| `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` | strings | unset | Static S3 credentials; set both or neither (then the AWS SDK default credential chain applies: instance role, `AWS_*` variables, profile). |
| `STORAGE_FORCE_PATH_STYLE` | boolean | `false` | Path-style bucket addressing (needed by MinIO and most self-hosted S3 services). |
| `EVIDENCE_MAX_BYTES` | integer 1024–10 GiB | `524288000` (500 MiB) | Maximum size of one evidence upload; exceeding it aborts the upload with `413 PAYLOAD_TOO_LARGE` and discards the partial object. |
| `EVIDENCE_MAX_BYTES_NON_STAFF` | integer 1024–10 GiB | `209715200` (200 MiB) | Per-file cap for uploaders without `evidence:upload` (reporting users, server teams); never larger than `EVIDENCE_MAX_BYTES`. |
| `EVIDENCE_UPLOADS_PER_HOUR` | integer ≥ 1 | `60` | Evidence uploads, links and supersedes per user and hour for `evidence:upload` holders (reviewer+); `429 RATE_LIMITED` above. |
| `EVIDENCE_UPLOADS_PER_HOUR_NON_STAFF` | integer ≥ 1 | `10` | Same limit for all other uploaders. |
| `EVIDENCE_DAILY_BYTES_NON_STAFF` | integer 1024–1 TiB | `1073741824` (1 GiB) | Stored evidence bytes per non-staff user and UTC day; a single upload is capped to the remaining quota (`413`), an exhausted quota answers `429`. |

## SCP:SL server (plugin) authentication

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `SIGNATURE_MAX_SKEW_SECONDS` | integer 5–600 | `60` | Accepted difference between the backend clock and `X-Timestamp` of signed requests (`401 TIMESTAMP_OUT_OF_RANGE`). Nonces are remembered for `2 × skew + 30 s`. Larger values widen the replay window; the plugin can use `GET /api/v1/time` to diagnose clock drift instead. |
| `KEY_ROTATION_GRACE_SECONDS` | integer 0–86400 | `600` | After a key rotation the previous key stays valid (`retiring`) for this long. |
| `REGISTRATION_TOKEN_TTL_HOURS` | integer 1–720 | `24` | Validity of registration tokens created in the web panel (`sreg_…`, shown once, stored hashed). |

## VPN detection (§6.4)

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `VPN_PROVIDERS` | list of `noop` \| `cidr-list` \| `proxycheck` \| `iphub` | `noop` | Providers queried for each public IP (result = highest confidence). An empty list means `noop`. |
| `VPN_CIDR_LIST_PATHS` | list of file paths | unset | Files with one CIDR per line (required when `cidr-list` is enabled). |
| `VPN_CIDR_CONFIDENCE` | `possible` \| `likely` \| `confirmed` | `likely` | Confidence reported for a CIDR match (type `hosting`). |
| `PROXYCHECK_API_KEY` | string | unset | proxycheck.io API key (the provider works without a key at a lower quota). |
| `IPHUB_API_KEY` | string | unset | iphub.info API key (required when `iphub` is enabled). |
| `VPN_PROVIDER_TIMEOUT_MS` | integer 100–30000 | `1500` | Per-provider timeout; a slow provider is skipped (`checked: false`, `error: provider_unavailable`), the player is never blocked by the backend. |
| `VPN_CACHE_TTL_SECONDS` | integer 0–604800 | `21600` | Redis cache of detection results per network hash (0 = no cache). |

Private, loopback, link-local and other reserved addresses are never sent to a provider. A VPN is
never treated as cheating (R3); it only feeds the `vpn` policy signal.

## Account age and alt-account analysis

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `STEAM_WEB_API_KEY` | string | unset | Steam Web API key (`ISteamUser/GetPlayerSummaries`) for account creation dates. Unset → age from server-reported hints or unknown. |
| `ACCOUNT_AGE_CACHE_DAYS` | integer 1–365 | `7` | Refresh interval of cached account ages (unknown results are retried after one day). |
| `ALT_LOOKBACK_DAYS` | integer 1–365 | `30` | Window of network observations considered for alt-account signals (§8.2). |
| `ALT_MAX_SHARED_ACCOUNTS` | integer 1–100 | `4` | Networks shared by more accounts than this yield at most `low` confidence (`shared_network_many_accounts`). |

## Overwatch proof and whitelist requests

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `OVERWATCH_INTERVAL_SECONDS` | integer 5–60 | `10` | Proof-code interval handed to the plugin when a session starts (§10.2). |
| `OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS` | integer 30–3600 | `90` | Sessions without a heartbeat for longer than this are expired by the job (effective end = last heartbeat + interval). |
| `PROOF_RATE_LIMIT_PER_MINUTE` | integer ≥ 1 | `20` | `GET /evidence/proof` requests per minute per user (or IP when anonymous). Codes carry 30 bits over 3 accepted windows; keep this low. |
| `WHITELIST_REQUEST_TTL_DAYS` | integer 1–365 | `14` | Pending whitelist requests expire after this many days (`WHITELIST_REQUEST_EXPIRED`). |

## Retention (§8.3)

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `RETENTION_NETWORK_OBSERVATIONS_DAYS` | integer 1–36500 | `30` | Delete `player_network_observations` older than this. |
| `RETENTION_PLAYER_SIGNALS_DAYS` | integer 1–36500 | `90` | Delete `player_signals` older than this. |
| `RETENTION_SESSIONS_DAYS` | integer 1–36500 | `30` | Hourly job `auth-sessions-retention` deletes sessions that expired (absolute or idle) or were revoked, and e-mail verification / password reset tokens that were used or expired, more than this many days ago (audited `RETENTION_RUN`). |
| `RETENTION_OVERWATCH_SECRETS_DAYS` | integer 1–36500 | `365` | Wipe `overwatch_sessions.secret_enc` of sessions older than this (rows are kept; proof verification is then impossible). |

Case history, reports, evidence metadata, confirmations, appeals and audit events are never deleted
by retention (R7).

## Features, jobs and logging

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `JOBS_ENABLED` | boolean | `true` | Start the background job scheduler in this process (retention, expiries, key retirement). Jobs take a Redis lock per run, so several replicas may keep it enabled; set `false` to dedicate replicas to HTTP only. |
| `PUBLIC_CASE_LOOKUP` | boolean | `true` | Anonymous `GET /public/cases/{caseNumber}` (limited public view). |
| `OPENAPI_UI` | boolean | `true` outside production, `false` in production | Swagger UI at `/api/docs`. The OpenAPI document at `/api/docs/openapi.json` is always served. |
| `LOG_LEVEL` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` | `info` | pino log level. |
| `LOG_CLIENT_IP` | boolean | `false` | Add `client_network_hash` (HMAC of the network, never the raw IP) to request log lines. |
| `LOG_PRETTY` | boolean | `false` | Human-readable output via `pino-pretty` (development only; JSON in production). |

Logs never contain request bodies, cookies, signatures, CSRF tokens, passwords, tokens, secrets,
private keys or raw IPs (redaction paths in `backend/src/lib/logger.ts`, ARCHITECTURE §15).

## Rate limits (§14)

| Variable | Type / values | Default | Purpose |
|---|---|---|---|
| `RATE_LIMIT_ENABLED` | boolean | `true` | Master switch (disable only in tests). |
| `RATE_LIMIT_GLOBAL_PER_MINUTE` | integer ≥ 1 | `300` | Requests per client IP and minute on every route (`/healthz` and `/readyz` exempt). |
| `RATE_LIMIT_PLUGIN_PER_MINUTE` | integer ≥ 1 | `600` | Signed plugin requests per authenticated server and minute. |
| `RATE_LIMIT_AUTH_PER_MINUTE` | integer ≥ 1 | `10` | Login, registration, password reset, 2FA and server registration requests per IP and minute. |
| `RATE_LIMIT_REPORTS_PER_HOUR` | integer ≥ 1 | `10` | Report creation per user and hour. |
| `RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE` | integer ≥ 1 | `30` | Failed signed-request authentications per (claimed server, client) and minute before `429 RATE_LIMITED`; a single client is limited at 4× this across all servers. |

Counters live in Redis when `REDIS_URL` is set (shared across replicas), otherwise in process
memory. Exceeded limits answer `429 RATE_LIMITED` with a `Retry-After` header.

## Command-line tools and tests

| Variable | Used by | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | `pnpm --filter @scpsl-trust/backend cli:create-admin` | Password of the bootstrap `super_admin`; without it the CLI prompts (hidden input, asked twice). Weak passwords (< 10 chars, equal to/containing the e-mail or username, common, repetitive) are refused. Prefer the prompt: environment variables can end up in shell history and process listings. |
| `DATABASE_URL`, `MIGRATIONS_DIR` | `pnpm migrate`, `cli:create-admin`, `cli:verify-audit` | The CLIs only need the database (no web secrets). Outside production `DATABASE_URL` defaults to the local development database. |
| `TEST_DATABASE_ADMIN_URL` | backend test suite | Admin connection used to create one throw-away database per test file (needs `CREATEDB`; `reset()` needs superuser). Default `postgres://scpsl:scpsl@localhost:5432/postgres`. |
| `REDIS_TEST_URL` | backend test suite | Redis for tests that opt into a real Redis (`buildTestApp({ redis: true })`); each app uses a random key prefix that is deleted afterwards. Default `redis://localhost:6379/15`. |

## Web panel

The web panel is a static build; its variables are read by Vite at build time and documented in
[`web/.env.example`](../web/.env.example):

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | Dev-server proxy target for `/api`. In production the reverse proxy serves the API and the panel from one origin (`WEB_ORIGIN`). |
| `VITE_REGISTRATION_ENABLED` | `true` | Hides the registration link when `false`. The backend's `ALLOW_REGISTRATION` remains authoritative (R10). |

## Checklist for production

1. `NODE_ENV=production`, `PUBLIC_BASE_URL`, `WEB_ORIGIN` set to the public HTTPS origins.
2. Four distinct secrets from `openssl rand -base64 32`; keep `DATA_ENCRYPTION_KEY` and
   `IP_HASH_SECRET` in a backup — they cannot be recovered from the database.
3. `DATABASE_URL` with the runtime role (`scpsl_app` in [DATABASE.md](./DATABASE.md)); run migrations
   as the schema owner (`pnpm migrate` or `AUTO_MIGRATE=true` with an owner connection).
4. `REDIS_URL` (required), `TRUST_PROXY` matching your reverse proxy, `COOKIE_SECURE=true` (default).
5. `MAIL_TRANSPORT=smtp` with `SMTP_URL` and `MAIL_FROM`.
6. `STORAGE_DRIVER=s3` with a dedicated bucket, or a `local` directory on persistent, backed-up storage.
7. `OPENAPI_UI` stays off unless you need it; `LOG_PRETTY=false`.
