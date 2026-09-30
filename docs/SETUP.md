# Local development setup

This guide runs every component directly on your machine. For a one-command stack see the
[README quick start](../README.md#quick-start-docker); for production see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | ≥ 22 | shared, backend, web |
| pnpm | 10 (the repo pins `pnpm@10.33.0` in `package.json`) | workspace (`corepack enable` or `npm install -g pnpm@10.33.0`) |
| PostgreSQL | 16 (≥ 13 works: `pgcrypto`/`citext` must be trusted extensions) | backend |
| Redis | 7 | backend (optional in development, required in production and for some tests) |
| .NET SDK | 8 | plugin, DevClient, C# tests |
| SCP:SL dedicated server files | current | only for building the LabAPI plugin project |
| Docker + Compose v2.24+ | optional | `scripts/dev-up.sh` (PostgreSQL + Redis in containers) |

## 2. Install the workspace

```bash
pnpm install                 # installs shared, backend and web (argon2 and esbuild ship prebuilt binaries)
```

`shared` is consumed from source by backend and web during development and tests (vitest and the
TypeScript configs alias `@scpsl-trust/shared` to `shared/src/index.ts`); `pnpm build` is only
needed for production artefacts.

## 3. Database and Redis

Either start both in containers:

```bash
scripts/dev-up.sh            # postgres:16 + redis:7 on localhost:5432 / :6379 (user scpsl/scpsl, db scpsl_trust)
scripts/dev-up.sh storage    # additionally MinIO on :9000 with the bucket scpsl-trust-evidence
scripts/dev-up.sh down       # stop them (data volumes are kept)
```

or use a local PostgreSQL as a superuser ([DATABASE.md §1.1](./DATABASE.md#11-roles-and-database)):

```sql
CREATE ROLE scpsl LOGIN PASSWORD 'scpsl' CREATEDB;
CREATE DATABASE scpsl_trust OWNER scpsl;
CREATE DATABASE scpsl_trust_test OWNER scpsl;
```

The backend test suite creates its own throw-away databases through `TEST_DATABASE_ADMIN_URL`
(default `postgres://scpsl:scpsl@localhost:5432/postgres`). That role needs `CREATEDB`, and
`reset()` in some tests needs superuser — for a local test cluster, `ALTER ROLE scpsl SUPERUSER;`.

## 4. Environment

```bash
cp .env.example .env
```

`.env.example` contains working development defaults (every variable is documented in
[CONFIGURATION.md](./CONFIGURATION.md)). The backend scripts read `../.env` through
`tsx --env-file-if-exists`. Notes:

* The four secrets (`JWT_SECRET`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `IP_HASH_SECRET`) may stay
  empty in development: ephemeral random values are generated with a warning, so sessions, stored
  2FA secrets and network-hash correlation are lost on restart. To keep them, fill them with
  `scripts/generate-secrets.sh` (four `openssl rand -base64 32` values).
* `COOKIE_SECURE=false` and `WEB_ORIGIN=http://localhost:5173` match the Vite dev server.
* `MAIL_TRANSPORT=file` writes verification and reset mails to `backend/.data/mail/`
  (relative paths resolve against `backend/`); evidence goes to `backend/.data/evidence/`.
* Without `REDIS_URL` the backend uses in-memory stores (single process only).

## 5. Migrate and create the first administrator

```bash
pnpm migrate                                   # applies backend/migrations/*.sql to DATABASE_URL
pnpm migrate -- --status                       # list applied / pending migrations
pnpm --filter @scpsl-trust/backend cli:create-admin --email admin@example.org --username admin
```

`create-admin` creates a verified `super_admin`; the password comes from `ADMIN_PASSWORD` or a hidden
prompt (asked twice; weak passwords are refused). On first login the panel asks you to enroll TOTP 2FA
— staff roles (`REQUIRE_2FA_ROLES`) cannot use any other route before that.

Other CLIs:

```bash
pnpm --filter @scpsl-trust/backend cli:verify-audit [--from-seq N] [--limit N] [--record] [--json]
cd backend && pnpm exec tsx src/cli/generate-keypair.ts [--server-id srv_…]   # TEST identities only
```

## 6. Run backend and web

```bash
pnpm dev:backend      # tsx watch, http://localhost:3000 (Swagger UI at /api/docs, OpenAPI JSON at /api/docs/openapi.json)
pnpm dev:web          # Vite, http://localhost:5173, proxies /api to VITE_API_PROXY_TARGET (http://localhost:3000)
```

Health endpoints: `GET /healthz` (liveness), `GET /readyz` (PostgreSQL + Redis), `GET /api/v1/time`.

## 7. Tests and checks

| Component | Commands (from the repository root) |
|---|---|
| shared | `pnpm --filter @scpsl-trust/shared typecheck` · `… test` · `… build` · `… vectors:check` (test vectors up to date) |
| backend | `pnpm --filter @scpsl-trust/backend typecheck` · `… test` (needs PostgreSQL; Redis at `REDIS_TEST_URL`, default `redis://localhost:6379/15`) · `… build` |
| backend API docs | `cd backend && pnpm exec tsx scripts/generate-api-docs.ts --check` (regenerate without `--check`) |
| web | `pnpm --filter @scpsl-trust/web typecheck` · `… test` · `… build` |
| everything (TS) | `pnpm typecheck` · `pnpm test` · `pnpm build` |
| plugin | see §8 |

The same checks run in CI (`.github/workflows/ci.yml`), plus `node scripts/check-doc-links.mjs` (relative links in the docs resolve) and a build of both Docker images.

## 8. Plugin

```bash
cd plugin
# Core + tests + DevClient (no game files needed — the Plugin project is built only in Release)
dotnet build ScpslTrust.sln -c Debug
dotnet test ScpslTrust.sln -c Debug

# Full build including the LabAPI plugin (needs the game's managed assemblies)
dotnet build ScpslTrust.sln -c Release -p:SCPSL_MANAGED_DIR=/path/to/server/SCPSL_Data/Managed
```

The Release build stages the deployable files in `plugin/dist/` (`plugins/ScpslTrust.Plugin.dll`,
`dependencies/ScpslTrust.Core.dll`). Alternatives to `SCPSL_MANAGED_DIR` are described in
[plugin/lib/README.md](../plugin/lib/README.md); installation and configuration in [PLUGIN.md](./PLUGIN.md).

### End-to-end without a game server

The DevClient drives the real Core code against your local backend ([PLUGIN.md §10](./PLUGIN.md#10-devclient-end-to-end-testing)):

1. In the web panel create a server (`/servers/new`, **Create server and get token**) and copy the registration token.
2. ```bash
   cd plugin && dotnet build tools/ScpslTrust.DevClient -c Release
   alias devclient='dotnet tools/ScpslTrust.DevClient/bin/Release/net8.0/trust-devclient.dll'
   devclient init
   devclient register --api http://localhost:3000 --token sreg_…
   devclient check --api http://localhost:3000 --player 76561198000000001@steam --ip 203.0.113.4
   ```

Plain `http://` is accepted for loopback addresses only.

A scripted version of this flow (backend, DevClient and web API against a real database) is
`e2e/run.sh`, described in [E2E.md](./E2E.md).
