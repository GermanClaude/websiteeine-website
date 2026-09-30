# SCP:SL Trust Network

A global anti-cheat, reporting, evidence and trust platform for **SCP: Secret Laboratory** servers:
a LabAPI server plugin (C#), a TypeScript backend (Fastify, PostgreSQL, Redis) and a React web
panel for players, server teams, reviewers and administrators.

## Principle: Centralized Transparency, Decentralized Enforcement

The backend collects and publishes **information**: cases, reports, evidence and their review
status, server confirmations, VPN / account-age / alt-account signals. Every SCP:SL server
evaluates that information against **its own policy** inside the plugin and decides locally whether
to allow, notify staff, warn, kick or ban. The backend never returns an enforcement action and
never pushes bans.

The ten architectural rules ([ARCHITECTURE.md §0](docs/ARCHITECTURE.md#0-architectural-rules-non-negotiable)):

| # | Rule |
|---|---|
| R1 | The backend provides information; the SCP:SL server decides enforcement (`/player/check` has no action field). |
| R2 | Identity, evidence authenticity and the cheating verdict are separate assessments. |
| R3 | A VPN is not cheating — it only feeds the `vpn` policy signal. |
| R4 | A young account is not cheating — it only feeds the `account_age` signal. |
| R5 | A shared IP is not the same person — alt detection is a `possible` signal with a confidence. |
| R6 | A verified Overwatch proof session proves who was recorded, not guilt. |
| R7 | No silent deletion or modification of case history (database triggers, immutable evidence). |
| R8 | Every important admin action is recorded in an append-only, hash-chained audit log. |
| R9 | Private keys never leave the SCP:SL server (only public keys, proof-of-possession). |
| R10 | Frontend permissions are never trusted — the backend checks RBAC on every route. |

## Components

```
   SCP:SL dedicated server                              Browser
 ┌───────────────────────────┐                ┌──────────────────────────┐
 │ LabAPI plugin (C#, net48) │                │ Web panel (React + Vite) │
 │  ScpslTrust.Core (ns2.0): │                │  served by nginx (web/)  │
 │  Ed25519 keys + signing,  │                └────────────┬─────────────┘
 │  policy engine, proofs    │                             │ HTTPS, session cookie
 └─────────────┬─────────────┘                             │ + CSRF token + 2FA
               │ HTTPS, Ed25519-signed requests            │
               │ (timestamp, nonce, request id)            │
               ▼                                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │ Backend API (Fastify 5, TypeScript) — /api/v1             │
        │ server auth · RBAC · cases/reports/evidence · appeals ·   │
        │ whitelist/bypasses · VPN/account-age/alt signals ·        │
        │ Overwatch proof API · audit chain · background jobs       │
        └───────┬───────────────────┬────────────────────┬──────────┘
                │                   │                    │
        ┌───────▼───────┐   ┌───────▼───────┐   ┌────────▼─────────┐
        │ PostgreSQL 16 │   │   Redis 7     │   │ Evidence storage │
        │ system of     │   │ nonces, rate  │   │ local disk or    │
        │ record        │   │ limits, cache │   │ S3-compatible    │
        └───────────────┘   └───────────────┘   └──────────────────┘
```

`shared/` (TypeScript) holds the enums, zod schemas, permission matrix, request canonicalization
and the reference policy engine, plus JSON test vectors that the C# plugin is verified against.

## Features

- [x] Server registration (one-time token + proof of possession)
- [x] Ed25519 request authentication with replay protection, key rotation and revocation
- [x] Player checks on join (information only, evaluated by the server's policy)
- [x] Global cases with case numbers, verdicts and review history
- [x] Reports (web and in-game)
- [x] Evidence upload with SHA-256 hashing, immutability and supersede history
- [x] Evidence verification (identity, authenticity and cheating assessed separately)
- [x] Overwatch proof codes and a public proof API
- [x] Appeals with reviewer independence checks
- [x] Hash-chained audit log with verification (API + CLI)
- [x] Global server confirmations
- [x] Account-age checks (Steam Web API, server hint)
- [x] VPN detection (CIDR lists, proxycheck.io, IPHub)
- [x] VPN bypasses via whitelist requests
- [x] Alt-account signals (network hashes, never raw IPs)
- [x] Server-specific, versioned policies (web editor + preview)
- [x] Server-specific whitelists / bypasses
- [x] Login with lockout, e-mail verification and password reset
- [x] Roles and permissions (player … super_admin, server-team roles)
- [x] 2FA (TOTP + recovery codes, mandatory for staff roles)
- [x] Server management (keys, members, policy, status, trust)
- [x] Case management
- [x] Player management (staff player view, signals, links, bypasses)
- [x] Admin panel (users, audit log, global bypasses)
- [x] API documentation (OpenAPI + [docs/API.md](docs/API.md))
- [x] Database migrations (plain SQL, checksummed)
- [x] Docker development environment
- [x] Automated tests (vitest, xUnit, shared cross-language vectors, CI)

## Quick start (Docker)

Requires Docker with Compose v2.24+.

```bash
cp .env.example .env              # optional: the stack also starts without it
docker compose up -d --build      # postgres, redis, backend (migrates on start), web
docker compose exec backend backend-entrypoint create-admin --email admin@example.org --username admin
# log in, then enroll 2FA (mandatory for staff roles)
```

Open <http://localhost:8080> (the panel proxies `/api` to the backend; the API is also on
<http://localhost:3000> for the plugin DevClient). Mails are written to files inside the backend's
`/data/mail` volume in development. Optional S3 storage via MinIO:
`STORAGE_DRIVER=s3 docker compose --profile storage up -d --build`.

Local development without Docker, running the tests and building the plugin: [docs/SETUP.md](docs/SETUP.md).
Production: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Binding design contract: rules, schema, protocols, business rules |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | The original brief |
| [docs/SETUP.md](docs/SETUP.md) | Local development, database setup, tests |
| [docs/CONFIGURATION.md](docs/CONFIGURATION.md) | Every environment variable |
| [docs/DATABASE.md](docs/DATABASE.md) | Roles, migrations, schema, protection triggers, retention |
| [docs/API.md](docs/API.md) | Every public endpoint (generated from OpenAPI) + examples |
| [docs/PLUGIN.md](docs/PLUGIN.md) | Plugin build, installation, configuration, commands |
| [docs/SERVER_REGISTRATION.md](docs/SERVER_REGISTRATION.md) | Registration, key rotation, revocation, troubleshooting |
| [docs/E2E.md](docs/E2E.md) | End-to-end verification (`e2e/run.sh`: backend + DevClient + web API) |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production with and without Docker, backups, upgrades |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model and security controls |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Data minimization, retention, deletion |
| [web/README.md](web/README.md) | Web panel structure |
| [plugin/lib/README.md](plugin/lib/README.md) | Game reference assemblies for the plugin build |

## Repository layout

```
.
├── shared/             @scpsl-trust/shared — enums, zod schemas, permissions, signing, policy engine, test vectors
├── backend/            @scpsl-trust/backend — Fastify API, migrations/, CLIs (migrate, create-admin, verify-audit)
│   └── Dockerfile
├── web/                @scpsl-trust/web — React panel; Dockerfile + nginx.conf
├── plugin/             ScpslTrust.sln — Core (netstandard2.0), Plugin (net48, LabAPI), Core.Tests, DevClient
├── scripts/            dev-up.sh, generate-secrets.sh, check-doc-links.mjs, docker/ entrypoint, db/ role setup
├── e2e/                end-to-end suite (run.sh, e2e.mjs; see docs/E2E.md)
├── docs/               documentation (above)
├── docker-compose.yml       development stack (+ `storage` profile with MinIO)
├── docker-compose.prod.yml  production stack
├── .env.example        every backend/web variable with development defaults
└── .github/workflows/ci.yml
```

## License

MIT (declared in the root `package.json`).
