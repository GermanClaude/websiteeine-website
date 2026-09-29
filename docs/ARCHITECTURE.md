# SCP:SL Trust Network — Architecture

> **Status: binding design contract.** Every component (plugin, backend, web, shared) MUST follow this
> document. If an implementation needs to deviate, update this document in the same change.
> Original brief: [REQUIREMENTS.md](./REQUIREMENTS.md).

Guiding principle: **Centralized Transparency, Decentralized Enforcement.**
The backend stores and serves *information* (cases, reports, evidence, signals, confirmations).
Every SCP:SL server evaluates that information against *its own* policy and decides locally
whether to allow, warn, notify, kick or ban. The backend never returns an enforcement action and
never pushes bans.

---

## 0. Architectural rules (non-negotiable)

| # | Rule | Where it is enforced |
|---|------|----------------------|
| R1 | Backend provides information; the SCP:SL server decides enforcement. | `/player/check` response has **no action field**; policy engine runs in the plugin. |
| R2 | Identity, evidence authenticity and cheating verdict are separate concepts. | Evidence has 3 independent assessments; verdict lives on the case. |
| R3 | A VPN is not cheating. | VPN only feeds the `vpn` policy signal; never touches verdicts. |
| R4 | A young account is not cheating. | Account age only feeds the `account_age` signal. |
| R5 | Shared IP ≠ same person. | Alt detection returns `possible` + `confidence`, IP-only evidence capped at `medium`. |
| R6 | Verified Overwatch session proves recording identity, not guilt. | Proof API only answers "does this code belong to this session/window". |
| R7 | No silent deletion/modification of case history. | DB triggers block DELETE on history tables; evidence immutable; replacement = new object. |
| R8 | Every important admin action is auditable. | Append-only, hash-chained `audit_events`, written in the same transaction. |
| R9 | Private keys never leave the SCP:SL server. | Only public keys are ever transmitted; registration/rotation use proof-of-possession. |
| R10 | Frontend permissions are never trusted. | Backend RBAC on every route; web only hides UI. |

---

## 1. Repository structure

```
/
├── package.json               pnpm workspace root (scripts: build, test, lint, typecheck, dev)
├── pnpm-workspace.yaml        packages: shared, backend, web
├── tsconfig.base.json
├── .env.example               every backend/web env variable, documented
├── docker-compose.yml         postgres, redis, backend, web (+ optional minio profile)
├── README.md
├── docs/
│   ├── ARCHITECTURE.md        (this file)
│   ├── REQUIREMENTS.md        original brief
│   ├── API.md                 every public endpoint
│   ├── SETUP.md               local development + database setup
│   ├── CONFIGURATION.md       environment variables
│   ├── PLUGIN.md              plugin installation + configuration
│   ├── SERVER_REGISTRATION.md registration, rotation, revocation
│   ├── DEPLOYMENT.md          Docker and non-Docker production deployment
│   ├── SECURITY.md            threat model and security controls
│   └── PRIVACY.md             data minimization and retention
├── shared/                    @scpsl-trust/shared  (TypeScript, built with tsup → dist, ESM+CJS+d.ts)
│   ├── src/
│   │   ├── index.ts
│   │   ├── enums.ts           all enums (as const objects + union types + zod enums)
│   │   ├── errors.ts          ErrorCode catalogue + HTTP status mapping
│   │   ├── permissions.ts     Permission catalogue + role→permission map + helpers
│   │   ├── signing.ts         canonical request string builder (pure, no crypto)
│   │   ├── policy/engine.ts   reference policy evaluator (pure) — mirrored in C#
│   │   └── schemas/           zod schemas, ONE FILE PER MODULE:
│   │       common.ts auth.ts users.ts servers.ts policy.ts player.ts players.ts
│   │       cases.ts reports.ts evidence.ts overwatch.ts appeals.ts whitelist.ts
│   │       bypasses.ts audit.ts dashboard.ts
│   ├── test-vectors/          cross-language fixtures (JSON) consumed by TS and C# tests
│   │   ├── signing.json  proof-codes.json  policy.json  audit-chain.json
│   └── tests/
├── backend/                   @scpsl-trust/backend (Fastify 5, TypeScript, ESM)
│   ├── migrations/            0001_*.sql … plain SQL, applied in order by src/db/migrator.ts
│   ├── src/
│   │   ├── index.ts           process entry (HTTP server + optional job scheduler)
│   │   ├── app.ts             buildApp(deps) — used by index.ts and tests
│   │   ├── config.ts          env parsing/validation (zod) → typed Config
│   │   ├── container.ts       dependency wiring (db, redis, storage, providers, services)
│   │   ├── cli/               migrate.ts, create-admin.ts, verify-audit.ts, generate-keypair.ts
│   │   ├── lib/               errors.ts, crypto.ts, ids.ts, time.ts, canonical-json.ts, pagination.ts, ip.ts
│   │   ├── db/                kysely.ts, types.ts (Database interface), migrator.ts, tx.ts
│   │   ├── redis/             client.ts, keys.ts
│   │   ├── http/              error-handler.ts, raw-body.ts, security.ts, rate-limit.ts, request-context.ts, openapi.ts
│   │   ├── auth/              user-session.ts, csrf.ts, rbac.ts, server-auth.ts, nonce-store.ts
│   │   ├── modules/<module>/  routes.ts (web) | plugin-routes.ts (signed) | service.ts | repository.ts
│   │   │   auth users servers policies players vpn account-age alt cases reports evidence
│   │   │   overwatch appeals whitelist bypasses audit dashboard
│   │   ├── storage/           ObjectStorage interface + local + s3 drivers
│   │   ├── mail/              Mailer interface + smtp + file + noop transports
│   │   └── jobs/              scheduler.ts + one file per job
│   └── tests/                 vitest; integration tests hit a real PostgreSQL + Redis (or fakes)
├── web/                       @scpsl-trust/web (React 19, Vite, TypeScript, React Router, TanStack Query)
│   ├── src/
│   │   ├── main.tsx  App.tsx  routes.tsx
│   │   ├── api/               client.ts (fetch wrapper, CSRF, errors) + one file per module
│   │   ├── auth/              AuthProvider, RequirePermission, useAuth
│   │   ├── components/        Layout, Nav, Card, Table, Badge, Button, Form fields, Pagination, …
│   │   ├── pages/             one folder per area
│   │   └── styles/            tokens.css, base.css, components.css
│   ├── nginx.conf  Dockerfile
│   └── tests/
└── plugin/                    C# (.NET) — LabAPI plugin, NO Exiled
    ├── ScpslTrust.sln
    ├── Directory.Build.props
    ├── src/ScpslTrust.Core/        netstandard2.0 — game-independent logic (crypto, API client, policy, proof codes)
    ├── src/ScpslTrust.Plugin/      net48 — LabAPI entry point, events, commands, hints
    ├── tests/ScpslTrust.Core.Tests/ net8.0 xUnit — consumes shared/test-vectors
    ├── tools/ScpslTrust.DevClient/  net8.0 console — simulated server for end-to-end tests
    └── lib/                        game reference assemblies (git-ignored, see PLUGIN.md)
```

### 1.1 Technology decisions

| Concern | Choice | Reason |
|---|---|---|
| Package manager | pnpm workspaces | fast, strict |
| Language | TypeScript `~5.9` (strict) | shared types across backend/web |
| Backend framework | Fastify 5 + `fastify-type-provider-zod` + zod 4 | schema-first validation + OpenAPI |
| DB | PostgreSQL 16, `pg` + Kysely (typed query builder) | typed repositories, raw SQL migrations |
| Migrations | plain SQL files, own migrator (`schema_migrations` table, one transaction per file, checksum) | transparent, reviewable |
| Cache/rate limit/nonces | Redis 7 via `ioredis` | TTL primitives |
| Passwords | Argon2id (`argon2` package; m=19456 KiB, t=2, p=1) | OWASP recommendation |
| 2FA | TOTP RFC 6238 (`otpauth`), recovery codes | standard authenticator apps |
| Server auth | Ed25519 via Node `crypto` (no third party) | built-in, constant-time |
| Object storage | `ObjectStorage` interface: `local` (filesystem) + `s3` (any S3-compatible) | no infra lock-in |
| Mail | `Mailer` interface: `smtp` (nodemailer), `file` (dev), `noop` (tests) | |
| Logging | pino (Fastify built-in), JSON, with redaction | structured logging |
| Web | React 19 + Vite + React Router + TanStack Query + plain CSS design tokens | component based, no heavy UI kit |
| Plugin | C# LabAPI (`Northwood.LabAPI` 1.1.x), .NET Framework 4.8 plugin + netstandard2.0 core | official loader |
| Plugin crypto/JSON | `BouncyCastle.Cryptography` 2.x (Ed25519) + `System.Text.Json` — both already shipped in `SCPSL_Data/Managed`, referenced with `Private=false` | no extra DLLs to deploy |
| Tests | vitest (TS), xUnit (C#), shared JSON test vectors | cross-language consistency |

Build details: `shared` is built by tsup (ESM + CJS + d.ts). `backend` is built by tsup to `dist/`
(ESM, `moduleResolution: "Bundler"`, so imports **do not** use `.js` extensions) and run in dev
with `tsx watch`. Backend/web vitest configs alias `@scpsl-trust/shared` to `shared/src/index.ts`
so tests never need a prior build.

---

## 2. Conventions

### 2.1 Wire format
* JSON everywhere, **snake_case** keys.
* **Enum values on the wire and in the DB are lowercase snake_case** (e.g. `under_review`,
  `not_detected`, `admin_notify`, `super_admin`). Docs may name them in upper case (`UNDER_REVIEW`);
  the serialized value is always lowercase. The single exception is `AuditAction`: audit events are
  named by their upper-case event name (`REPORT_CREATED`), in the database, on the wire and in the hash chain.
* Timestamps: ISO‑8601 UTC strings with milliseconds (`2026-09-29T15:42:20.000Z`).
* IDs: UUID v4 (`id`) unless a human-readable number exists (`case_number`, `server_id`).
* Lists: `{ "items": [...], "page": 1, "page_size": 25, "total": 123 }`; query `?page=&page_size=` (max 100).
  Small bounded collections (a server's keys, members, a user's sessions) are returned as `{ "items": [...] }` only.
* Errors (always this shape, never stack traces):
  ```json
  { "error": { "code": "INVALID_SIGNATURE", "message": "Request signature is invalid", "details": {}, "request_id": "…" } }
  ```
  `details` is optional (validation issues: `[{ "path": "player.id", "message": "…" }]`).
* Every response carries `X-Request-Id`. Plugin requests supply their own request id (see §5); web
  requests get a server-generated UUID unless a valid `X-Request-Id` UUID was supplied.

### 2.2 Player identity
A player is identified by `{ "type": "steam" | "discord" | "northwood", "id": "<raw id>" }`.
The canonical string form (SCP:SL `UserId` format) is `<id>@<type>`, e.g. `76561198000000001@steam`.
Validation: steam = 17 digits; discord = 17–20 digits; northwood = `[a-z0-9_.-]{1,64}`.
URL form uses the canonical string (URL-encoded `@` is accepted).

### 2.3 Identifier formats
| Identifier | Format | Example |
|---|---|---|
| server_id | `srv_` + 16 chars Crockford base32 lowercase | `srv_7k4x92m8pq174kf9` |
| case_number | `CASE-<yyyy>-<6 digit per-year counter>` | `CASE-2026-001337` |
| registration token | `sreg_` + 43 chars base64url (32 random bytes) | shown once |
| key fingerprint | `SHA256:` + lowercase hex of SHA-256 over the 32 raw public-key bytes | `SHA256:3f…` |
| public key encoding | base64 (standard, padded) of the 32 raw Ed25519 public-key bytes | |
| reviewer pseudonym | `Reviewer #<reviewer_number>` | `Reviewer #184` |

---

## 3. Enumerations (shared/src/enums.ts)

All defined as `export const X = { UPPER: 'lower' } as const` + `export type X = …` + `zX = z.enum([...])`.

| Enum | Values |
|---|---|
| `UserRole` | `player`, `server_admin`, `reviewer`, `moderator`, `admin`, `super_admin` |
| `UserStatus` | `active`, `disabled` (temporary lockout is `locked_until`, not a status) |
| `ServerStatus` | `pending` (created, not yet registered), `active`, `suspended`, `revoked` |
| `ServerKeyStatus` | `active`, `retiring` (old key during rotation grace), `retired`, `revoked` |
| `ServerMemberRole` | `owner`, `admin`, `moderator` |
| `PlayerIdType` | `steam`, `discord`, `northwood` |
| `GlobalStatus` | `none`, `rejected`, `inconclusive`, `reported`, `under_review`, `confirmed` (ascending priority) |
| `CaseVerdict` | `unknown`, `inconclusive`, `confirmed`, `rejected` |
| `CaseStatus` | `open`, `under_review`, `closed` |
| `ReportStatus` | `open`, `under_review`, `resolved`, `rejected` |
| `ReporterType` | `user`, `server` |
| `EvidenceType` | `video`, `image`, `log`, `demo`, `text`, `link`, `other` |
| `EvidenceStatus` | `unverified`, `verified`, `rejected`, `inconclusive` (also used for each assessment) |
| `AppealStatus` | `open`, `under_review`, `decided`, `withdrawn` |
| `AppealDecision` | `confirm`, `reverse`, `inconclusive` |
| `WhitelistRequestStatus` | `pending`, `approved`, `rejected`, `expired`, `revoked` |
| `WhitelistRequestType` | `vpn_whitelist`, `account_age_whitelist` |
| `BypassType` | `vpn_whitelist`, `account_age_whitelist`, `alt_account_whitelist`, `verdict_override` |
| `BypassScope` | `server`, `global` |
| `VpnConfidence` | `not_detected`, `possible`, `likely`, `confirmed` (ascending) |
| `VpnType` | `vpn`, `proxy`, `tor`, `hosting`, `relay`, `unknown` |
| `AltConfidence` | `none`, `low`, `medium`, `high` (ascending) |
| `AltSignal` | `same_network_identifier`, `same_network_prefix`, `linked_account_confirmed_case`, `linked_account_recently_seen`, `shared_network_many_accounts`, `network_is_vpn` |
| `AccountAgeSource` | `steam`, `server_reported`, `unknown` |
| `PolicySignal` | `global_verdict`, `account_age`, `vpn`, `alt_account`, `open_reports` |
| `PolicyAction` | `allow`, `admin_notify`, `warn`, `require_review`, `require_whitelist`, `kick`, `ban` (ascending severity 0–6) |
| `ActorType` | `user`, `server`, `system`, `player` |
| `OverwatchSessionStatus` | `active`, `ended`, `expired` |
| `AuditAction` | see §9.2 (values are the upper-case event names) |
| `BackendUnavailableAction` | `allow`, `admin_notify`, `kick` |
| `UserTokenType` | `email_verification`, `password_reset` |
| `ReviewKind` | `review_started`, `verdict_set`, `note`, `appeal_decision`, `reopened` |
| `WhitelistDecision` | `approve`, `reject` |
| `OverwatchEndReason` | `target_changed`, `overwatch_disabled`, `spectator_left`, `target_left`, `round_ended`, `manual`, `heartbeat_timeout` (backend only) |
| `PlayerSignalType` | `vpn_detected`, `possible_alt_account`, `young_account` |
| `VpnCheckError` | `provider_unavailable` |

Further enums (`SessionRevokeReason`, `PolicyReasonCode`, `AuditTargetType`, `AuditVerifyFailure`) are defined in
`shared/src/enums.ts`, which is the authoritative list.

---

## 4. Database schema (PostgreSQL 16)

General rules:
* `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` unless noted.
* `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` (+ trigger).
* Enum columns are `text` with `CHECK (col IN (...))` (easy to evolve).
* Foreign keys `ON DELETE RESTRICT` unless stated. Indexes on every FK and every filter column.
* History tables are protected by the trigger function `forbid_delete()` (raises exception).
* **Raw IP addresses are never stored.** Only HMAC-SHA256 network hashes (see §8.3).
* Secrets (TOTP secret, overwatch session secret) are stored AES-256-GCM encrypted
  (`DATA_ENCRYPTION_KEY`), format `v1:<iv b64>:<ciphertext b64>:<tag b64>`.
* The migrations enforce more than this section lists (documented in `docs/DATABASE.md`, binding for the
  application code): every protection trigger raises SQLSTATE `TN403` and also blocks `TRUNCATE`; a policy
  version and its rules are immutable once inserted (saving = new version); a confirmation may only be revoked
  once and is then frozen; evidence follows an allow-list (only the four status columns, `updated_at` and the
  one-time `superseded_by_evidence_id` may change; the superseding row must belong to the same case); usernames
  are unique case-insensitively and e-mails are stored lowercase; `password_hash` must be an argon2id string;
  `audit_events.prev_hash` is unique (the chain cannot fork) and `created_at` has millisecond precision;
  format checks exist for ids, hashes, keys and fingerprints. Audit writers call `pg_advisory_xact_lock(7274001)`,
  take `nextval('audit_events_seq')` and insert in the same transaction.

### 4.1 Identity & access

**users**
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | citext UNIQUE NOT NULL | normalized lower-case |
| username | text UNIQUE NOT NULL | 3–32 `[A-Za-z0-9_.-]` |
| password_hash | text NOT NULL | argon2id encoded string |
| role | text NOT NULL DEFAULT 'player' | UserRole |
| status | text NOT NULL DEFAULT 'active' | UserStatus |
| email_verified_at | timestamptz NULL | |
| failed_login_count | int NOT NULL DEFAULT 0 | reset on success |
| locked_until | timestamptz NULL | throttling lockout |
| totp_secret_enc | text NULL | encrypted |
| totp_enabled_at | timestamptz NULL | 2FA active iff not null |
| totp_last_used_step | bigint NULL | TOTP replay protection |
| reviewer_number | int UNIQUE NULL | assigned when first granted reviewer+ role (sequence) |
| player_id | uuid NULL UNIQUE FK→players | linked in-game identity (§6.6) |
| last_login_at | timestamptz NULL | |
| created_at / updated_at | | |

**user_recovery_codes**: id, user_id FK (CASCADE), code_hash text (sha256 hex), used_at NULL, created_at.

**user_tokens** (email verification / password reset): id, user_id FK, type text CHECK in
(`email_verification`,`password_reset`), token_hash text UNIQUE (sha256 hex), expires_at, used_at NULL,
created_at. Index (user_id, type).

**sessions**: id uuid PK, user_id FK, token_hash text UNIQUE (sha256 hex of cookie token),
mfa_verified boolean NOT NULL, created_at, last_seen_at, expires_at (absolute), idle_expires_at,
revoked_at NULL, revoked_reason NULL, user_agent text NULL (truncated 256), ip_hash text NULL.
Index (user_id), (expires_at).

### 4.2 Servers

**servers**: id uuid PK, server_id text UNIQUE NOT NULL (`srv_…`), name text NOT NULL (3–64),
description text NULL, owner_user_id uuid FK→users NOT NULL, status text (ServerStatus) DEFAULT 'pending',
is_trusted boolean NOT NULL DEFAULT false (set by admins; shown next to confirmations),
accepts_whitelist_requests boolean NOT NULL DEFAULT true, plugin_version text NULL,
game_version text NULL, last_seen_at timestamptz NULL, key_rotation_requested_at timestamptz NULL,
registered_at timestamptz NULL, created_at, updated_at. Index (owner_user_id), (status).

**server_members**: server_id uuid FK (servers.id) , user_id uuid FK, role text (ServerMemberRole),
created_at, created_by uuid FK→users. PK (server_id, user_id). The owner is always a member with role `owner`.

**server_registration_tokens**: id, server_id uuid FK, token_hash text UNIQUE, created_by uuid FK→users,
expires_at, used_at NULL, revoked_at NULL, created_at. Only one unused, unrevoked token per server
(creating a new one revokes the old one).

**server_keys**: id uuid PK, server_id uuid FK, public_key text NOT NULL (base64 32 bytes),
fingerprint text UNIQUE NOT NULL, status text (ServerKeyStatus), created_at, activated_at,
retiring_until timestamptz NULL (grace end for `retiring`), retired_at NULL, revoked_at NULL,
revoked_by uuid NULL FK→users, revoke_reason text NULL. Partial unique index: at most one `active`
key per server. Index (server_id, status).

### 4.3 Server policies (structured, versioned — never a JSON blob)

**server_policies**: id uuid PK, server_id uuid FK, version int NOT NULL, is_active boolean NOT NULL,
backend_unavailable_action text (PolicyAction, only `allow`|`admin_notify`|`kick`) DEFAULT 'allow',
notify_on_enforcement boolean NOT NULL DEFAULT true, honor_global_bypasses boolean NOT NULL DEFAULT false,
whitelist_url text NULL, created_by uuid NULL FK→users, created_at. UNIQUE (server_id, version);
partial unique index one active policy per server.

**server_policy_rules**: id uuid PK, policy_id uuid FK (CASCADE on policy row — policy rows themselves are never deleted),
sort_order int NOT NULL, enabled boolean NOT NULL DEFAULT true, signal text (PolicySignal), action text (PolicyAction),
statuses text[] NULL (global_verdict: GlobalStatus values), min_confirmed_servers int NULL,
max_account_age_days int NULL (account_age: match if days < value), match_unknown_age boolean NULL,
min_vpn_confidence text NULL (VpnConfidence), min_alt_confidence text NULL (AltConfidence),
require_linked_confirmed_case boolean NULL, min_open_reports int NULL, message text NULL (≤ 256),
ban_duration_minutes int NULL (BAN only; 0 = permanent). CHECK constraints ensure the right condition
columns per signal.

Saving a policy = insert new version with its rules, deactivate previous (audit `POLICY_UPDATED`).
A server without any policy row gets the **default policy** (§7.4), materialized as version 1 on registration.

### 4.4 Players & signals

**players**: id uuid PK, id_type text (PlayerIdType), external_id text, display_name text NULL (last nickname, ≤ 64),
first_seen_at timestamptz NULL (first seen by any server), last_seen_at NULL,
account_created_at timestamptz NULL, account_age_source text (AccountAgeSource) DEFAULT 'unknown',
account_age_checked_at timestamptz NULL, created_at, updated_at. UNIQUE (id_type, external_id).

**player_network_observations** (alt correlation; retention-limited): id uuid PK, player_id FK,
network_hash text NOT NULL (HMAC of full address / IPv6 /64), prefix_hash text NOT NULL (HMAC of IPv4 /24 / IPv6 /48),
server_id uuid FK→servers, first_seen_at, last_seen_at, seen_count int. UNIQUE (player_id, network_hash, server_id).
Index (network_hash, last_seen_at), (prefix_hash, last_seen_at).

**player_server_sightings**: player_id FK, server_id FK, first_seen_at, last_seen_at, join_count int. PK (player_id, server_id).

**player_signals** (derived signals history; retention-limited): id uuid PK, player_id FK, server_id uuid NULL FK,
signal text CHECK in (`vpn_detected`,`possible_alt_account`,`young_account`), confidence text NULL,
source text NOT NULL (provider or module name), detail_codes text[] NOT NULL DEFAULT '{}' (e.g. AltSignal values —
never raw IPs), created_at, expires_at NULL. Index (player_id, created_at DESC).

**player_links** (alt links visible to reviewers): id, player_id FK, linked_player_id FK, signal text (AltSignal),
first_detected_at, last_detected_at, occurrences int. UNIQUE(player_id, linked_player_id, signal). CHECK(player_id <> linked_player_id).

### 4.5 Cases, reports, reviews, confirmations

**case_counters**: year int PK, last_value int NOT NULL. (`INSERT … ON CONFLICT DO UPDATE SET last_value = case_counters.last_value + 1 RETURNING last_value`.)

**cases**: id uuid PK, case_number text UNIQUE NOT NULL, player_id uuid FK NOT NULL,
current_verdict text (CaseVerdict) DEFAULT 'unknown', status text (CaseStatus) DEFAULT 'open',
reason text NOT NULL (internal summary, ≤ 2000), public_summary text NULL (≤ 500, shown on public pages),
created_by_user_id uuid NULL, created_by_server_id uuid NULL, verdict_set_by uuid NULL FK→users,
verdict_set_at timestamptz NULL, closed_at NULL, created_at, updated_at. Index (player_id), (status), (current_verdict).
DELETE forbidden.

**reports**: id uuid PK, case_id uuid FK NOT NULL, player_id uuid FK NOT NULL,
server_id uuid NULL FK (server where it happened / server that submitted), reporter_type text (ReporterType),
reporter_user_id uuid NULL FK, reporter_player_id uuid NULL FK (in-game reporter), reason text NOT NULL (≤ 200),
description text NULL (≤ 5000), status text (ReportStatus) DEFAULT 'open', resolution_note text NULL,
resolved_by uuid NULL FK→users, resolved_at NULL, created_at, updated_at. Index (case_id), (player_id), (status), (server_id).
DELETE forbidden.

**reviews** (case review history): id uuid PK, case_id FK, reviewer_user_id FK, kind text CHECK in
(`review_started`,`verdict_set`,`note`,`appeal_decision`,`reopened`), previous_verdict text NULL, new_verdict text NULL,
comment text NOT NULL (≤ 5000), appeal_id uuid NULL FK, created_at. Index (case_id, created_at). DELETE forbidden, UPDATE forbidden.

**case_server_confirmations**: id uuid PK, case_id FK, server_id uuid FK, confirmed_by_user_id FK,
note text NULL (≤ 1000), created_at, revoked_at NULL, revoked_by uuid NULL, revoke_reason text NULL.
Partial UNIQUE (case_id, server_id) WHERE revoked_at IS NULL. DELETE forbidden.

### 4.6 Evidence

**evidence**: id uuid PK, case_id uuid FK NOT NULL, report_id uuid NULL FK, type text (EvidenceType),
title text NOT NULL (≤ 200), description text NULL (≤ 5000),
status text (EvidenceStatus) DEFAULT 'unverified'            -- overall review status
identity_status text (EvidenceStatus) DEFAULT 'unverified'   -- Q1: is the identity correct?
authenticity_status text (EvidenceStatus) DEFAULT 'unverified' -- Q2: is the evidence authentic?
cheating_status text (EvidenceStatus) DEFAULT 'unverified'   -- Q3: does it demonstrate cheating?
sha256 char(64) NULL (NULL only for `link`), size_bytes bigint NULL, mime_type text NULL, original_filename text NULL (sanitized),
storage_key text NULL UNIQUE, external_url text NULL (only `link`), uploaded_at timestamptz NOT NULL,
uploader_user_id uuid NULL FK, uploader_server_id uuid NULL FK, overwatch_session_id uuid NULL FK,
supersedes_evidence_id uuid NULL UNIQUE FK→evidence, superseded_by_evidence_id uuid NULL FK→evidence,
created_at, updated_at. Index (case_id), (status), (sha256).
Trigger: DELETE forbidden; UPDATE of sha256/size_bytes/mime_type/storage_key/external_url/uploaded_at/uploader_*/case_id/type
forbidden; `superseded_by_evidence_id` may only change from NULL once.

**evidence_reviews**: id, evidence_id FK, reviewer_user_id FK, status, identity_status, authenticity_status,
cheating_status (all EvidenceStatus), comment text NOT NULL, created_at. DELETE/UPDATE forbidden.
Latest review determines the current values on `evidence`.

### 4.7 Overwatch

**overwatch_sessions**: id uuid PK (= session_id), server_id uuid FK, target_player_id FK, spectator_player_id FK,
secret_enc text NULL (encrypted 32-byte secret; wiped after retention → verification then impossible, documented),
interval_seconds int NOT NULL DEFAULT 10 CHECK 5–60, status text (OverwatchSessionStatus),
started_at timestamptz NOT NULL, ended_at NULL, last_heartbeat_at timestamptz NOT NULL, end_reason text NULL,
created_at. Index (server_id, target_player_id, spectator_player_id, started_at).

### 4.8 Appeals, whitelist, bypasses

**appeals**: id uuid PK, case_id FK, player_id FK, submitted_by_user_id FK, statement text NOT NULL (20–5000),
status text (AppealStatus) DEFAULT 'open', assigned_reviewer_id uuid NULL FK, decision text NULL (AppealDecision),
decision_reason text NULL, decided_by uuid NULL FK, decided_at NULL, conflict_override boolean NOT NULL DEFAULT false,
created_at, updated_at. Partial UNIQUE (case_id) WHERE status IN ('open','under_review'). DELETE forbidden.

**whitelist_requests**: id uuid PK, player_id FK, requester_user_id FK, server_id uuid FK, type text (WhitelistRequestType),
reason text NOT NULL (10–2000), requested_days int NULL (1–365), status text (WhitelistRequestStatus) DEFAULT 'pending',
decided_by uuid NULL FK, decided_at NULL, decision_note text NULL, bypass_id uuid NULL FK→bypasses,
expires_at timestamptz NOT NULL (pending auto-expiry), created_at, updated_at.
Partial UNIQUE (player_id, server_id, type) WHERE status = 'pending'. DELETE forbidden.

**bypasses**: id uuid PK, player_id FK, scope text (BypassScope), server_id uuid NULL FK (NOT NULL iff scope='server'),
type text (BypassType), reason text NOT NULL, granted_by_user_id FK, whitelist_request_id uuid NULL FK,
created_at, expires_at timestamptz NULL (NULL = no expiry), revoked_at NULL, revoked_by NULL, revoke_reason NULL,
expired_processed_at NULL (set by expiry job after auditing). Index (player_id, server_id, type). DELETE forbidden.
A bypass is **active** iff `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.

### 4.9 Audit

**audit_events**: seq bigint PK (from sequence `audit_events_seq`), event_id uuid UNIQUE NOT NULL,
created_at timestamptz NOT NULL (set by app, ms precision), actor_type text (ActorType), actor_id text NULL,
action text NOT NULL (AuditAction), target_type text NOT NULL, target_id text NULL, metadata jsonb NOT NULL DEFAULT '{}',
request_id text NULL, prev_hash char(64) NOT NULL, hash char(64) NOT NULL UNIQUE.
Indexes (target_type, target_id, seq), (actor_type, actor_id, seq), (action, seq), (created_at).
Triggers: UPDATE and DELETE forbidden (also `TRUNCATE` revoked from app role in DEPLOYMENT.md).
Additional denormalized index column for scoping: `server_id uuid NULL` (server the event relates to) and
`case_id uuid NULL` — both part of the hashed data.

### 4.10 Operational

**schema_migrations**: version text PK, checksum text, applied_at.
**job_runs** (optional): job text, started_at, finished_at, result text, details jsonb (small counters only).

---

## 5. Server authentication (Ed25519)

### 5.1 Identity
Each SCP:SL server has `server_id` (assigned by backend at pre-registration), and an Ed25519 key pair generated
**on the SCP:SL server** by the plugin (`BouncyCastle Ed25519KeyPairGenerator`). The 32-byte private seed is stored in
`<LabAPI configs>/ScpslTrust/identity.json` (file mode 0600 where supported), never logged, never transmitted.

### 5.2 Registration (proof of possession)
1. A web user with permission `server:create` creates a server in the web panel → backend creates `servers` row
   (`status=pending`), the owner membership, and a **registration token** (`sreg_…`, 24 h, shown once, stored hashed).
2. On the SCP:SL server console: `trust register <token>` (or `registration_token` in plugin config for first start).
   The plugin generates (or reuses) its key pair and calls:

```
POST /api/v1/servers/register           (not signed with a registered key; token + PoP instead)
{
  "registration_token": "sreg_…",
  "public_key": "<base64 32 bytes>",
  "plugin_version": "1.0.0",
  "game_version": "14.1.3",           // optional
  "timestamp": 1790000000000,          // unix ms
  "pop_signature": "<base64 sig>"
}
pop message = "SCPSL-TRUST-REGISTER-V1\n" + registration_token + "\n" + public_key + "\n" + timestamp
```
Backend: token valid/unexpired/unused, |now − timestamp| ≤ 300 s, PoP verifies, fingerprint unused →
key `active`, server `active`, `registered_at`, token `used_at`, default policy v1, audit `SERVER_REGISTERED`.
Response `201 { "server_id": "srv_…", "key_fingerprint": "SHA256:…", "status": "active", "server_time": "…" }`.

### 5.3 Signed request format (all plugin endpoints except `register` and `GET /time`)

Headers:
| Header | Content |
|---|---|
| `X-Server-Id` | `srv_…` |
| `X-Timestamp` | unix epoch **milliseconds**, decimal |
| `X-Nonce` | 16–64 chars base64url (plugin: 18 random bytes → 24 chars) |
| `X-Request-Id` | UUID v4 |
| `X-Key-Fingerprint` | fingerprint of signing key (optional; selects key during rotation grace) |
| `X-Plugin-Version` | semver, e.g. `1.0.0` |
| `X-Signature` | base64 Ed25519 signature over the canonical string |

Canonical string (UTF-8, `\n` separators, no trailing newline):
```
SCPSL-TRUST-V1
<METHOD upper-case>
<path including query string exactly as sent, e.g. /api/v1/servers/policy?x=1>
<server_id>
<timestamp>
<nonce>
<request_id>
<lowercase hex SHA-256 of the raw request body bytes (empty body → hash of empty string)>
```
Implemented once in `shared/src/signing.ts` (`buildCanonicalRequest(parts)`) and once in C#
(`ScpslTrust.Core.Security.RequestCanonicalizer`), both verified against `shared/test-vectors/signing.json`
(fixed seed key; Ed25519 signatures are deterministic, so vectors include expected signatures).

### 5.4 Verification order (backend `server-auth.ts`, preHandler)
1. All headers present & well-formed → else `401 MISSING_AUTH_HEADERS` / `400 INVALID_AUTH_HEADERS`.
2. `|now − X-Timestamp| ≤ SIGNATURE_MAX_SKEW_SECONDS` (default 60) → else `401 TIMESTAMP_OUT_OF_RANGE`.
3. Server exists → else `401 UNKNOWN_SERVER`; status `active` → else `403 SERVER_SUSPENDED`/`SERVER_REVOKED`.
4. Candidate keys: `active` + `retiring` with `retiring_until > now` (filtered by `X-Key-Fingerprint` if sent).
   If the only matching key is `revoked` → `401 KEY_REVOKED`. No key → `401 NO_ACTIVE_KEY`.
5. Ed25519 verify over canonical string computed from the **raw body** (captured by `raw-body.ts`) → else `401 INVALID_SIGNATURE`.
6. Nonce: Redis `SET nonce:{server_id}:{nonce} 1 NX PX (2*skew+30s)` → if exists `401 REPLAYED_NONCE`.
7. Request id: Redis `SET reqid:{server_id}:{request_id} 1 NX PX 600000` → if exists `409 DUPLICATE_REQUEST_ID`.
8. `request.authServer = { id, server_id, key_id, fingerprint, plugin_version, name, owner_user_id }` (named
   `authServer` because Fastify reserves `request.server` for the instance); update `last_seen_at`/`plugin_version`
   (throttled to once per 60 s via Redis). A `pending` (never registered) server answers `401 NO_ACTIVE_KEY`.
   Repeated failures are counted per claimed server and per client and answered `429 RATE_LIMITED`
   (`RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE`) before any database work.
9. If body contains `server_id` it must equal the header → else `400 SERVER_ID_MISMATCH`.

Steps 6–7 run only after a valid signature (prevents nonce-store pollution). A `NonceStore` interface has a Redis
implementation and an in-memory implementation for tests. Every failure is logged (no secrets) and counted; repeated
invalid signatures per server trigger a rate limit.

### 5.5 Key rotation
Plugin-initiated (`trust rotatekey`, or automatically when heartbeat returns `key_rotation_requested: true`):
```
POST /api/v1/servers/keys/rotate   (signed with CURRENT key)
{ "new_public_key": "<b64>", "timestamp": <ms>, "pop_signature": "<sig by NEW key>" }
pop message = "SCPSL-TRUST-ROTATE-V1\n" + server_id + "\n" + new_public_key + "\n" + timestamp
```
Backend: new key `active`; old key `retiring` with `retiring_until = now + KEY_ROTATION_GRACE_SECONDS` (default 600);
clears `key_rotation_requested_at`; audit `SERVER_KEY_ROTATED`. Plugin writes new identity file atomically
(write temp + rename) only after a 200 response, keeping the previous key in `identity.previous.json` until the
first successful request with the new key. Job moves expired `retiring` keys to `retired`.

### 5.6 Revocation
Web (`server:manage` on that server or `server:manage_any`): `POST /api/v1/servers/{id}/keys/{keyId}/revoke {reason}` →
key `revoked` immediately (audit `SERVER_KEY_REVOKED`). If no active key remains the server must re-register with a
new registration token (`POST /api/v1/servers/{id}/registration-token`). Admins can also suspend/revoke whole servers.

---

## 6. Plugin ⇄ backend API (signed)

All paths under `/api/v1`. All bodies/response per shared schemas (`shared/src/schemas/*`).

| Method & path | Purpose |
|---|---|
| `GET /time` (unsigned) | `{ "server_time": "…", "epoch_ms": n }` for clock-skew diagnostics |
| `POST /servers/register` (token+PoP) | §5.2 |
| `POST /servers/heartbeat` | `{ plugin_version, game_version?, player_count? }` → `{ status, policy_version, key_rotation_requested, server_time }` |
| `POST /servers/keys/rotate` | §5.5 |
| `GET /servers/policy` | active policy of this server (`ServerPolicy`, §7) |
| `POST /player/check` | §6.1 |
| `POST /player/bypass/check` | §6.2 |
| `POST /player/link` | complete web-account linking with in-game code (§6.6) |
| `POST /server/reports` | in-game report forwarded by the plugin (§6.5) |
| `POST /overwatch/sessions` | start Overwatch proof session (§10) |
| `POST /overwatch/sessions/{id}/heartbeat` | keep session alive |
| `POST /overwatch/sessions/{id}/end` | end session `{ reason }` |

### 6.1 `POST /api/v1/player/check`
Request:
```json
{
  "server_id": "srv_…",                     // optional, must match header
  "player": { "type": "steam", "id": "76561198000000001" },
  "nickname": "Foo",                        // optional, ≤ 64
  "ip": "203.0.113.4",                      // optional; used transiently, NEVER stored raw
  "account_created_at": "2020-01-01T00:00:00Z" // optional untrusted hint
}
```
Processing: upsert player (first/last seen, nickname), sighting, network observation (hash only), VPN lookup
(cached), account age resolution, alt analysis, case aggregation, bypass lookup (server-scoped + global only if
`honor_global_bypasses`). Everything is information; **no action is computed**.

Response `200`:
```json
{
  "player": { "type": "steam", "id": "76561198000000001", "user_id": "76561198000000001@steam", "first_seen_at": "…" },
  "global_status": "confirmed",
  "case_id": "CASE-2026-001337",
  "cases": [ { "case_id": "CASE-2026-001337", "verdict": "confirmed", "status": "closed", "confirmed_servers": 3 } ],
  "reports": 4,
  "open_reports": 1,
  "confirmed_servers": 3,
  "independent_confirmed_servers": 2,
  "account_age": { "days": 3, "created_at": "…", "source": "steam" },
  "vpn": { "detected": true, "confidence": "likely", "type": "vpn" },
  "bypass": { "active": false, "types": [], "bypasses": [] },
  "alt_account": { "possible": true, "confidence": "medium", "signals": ["same_network_identifier"], "linked_confirmed_cases": ["CASE-2026-000999"] },
  "policy_version": 3,
  "checked_at": "…"
}
```
`global_status` = highest-priority status over the player's cases: any `confirmed` verdict → `confirmed`;
else any case `under_review` → `under_review`; else any case `open` with ≥1 non-rejected report → `reported`;
else any `inconclusive` → `inconclusive`; else any `rejected` → `rejected`; else `none`.
`case_id` = the case that produced the status (most recent on ties). `reports` counts non-rejected reports.
`confirmed_servers` counts distinct active confirmations on the `case_id` case; `independent_confirmed_servers`
counts distinct server **owners** among them. `account_age.days` is `null` when unknown. If `ip` omitted, `vpn`
is `{ "detected": false, "confidence": "not_detected", "type": null, "checked": false }`.

### 6.2 `POST /api/v1/player/bypass/check`
Request `{ "server_id"?, "player": {…}, "ip"?: "…", "types"?: BypassType[] }`.
Response `{ "vpn": bool, "bypass": bool, "bypass_type": BypassType|null, "expires_at": iso|null, "bypasses": [ { "id", "type", "scope", "expires_at" } ] }`.
`vpn` = current VPN detection for supplied ip (false if none). `bypass_type`/`expires_at` = the active bypass that
matches `types` (or any) with the latest expiry. Server-scoped only, unless the server policy has `honor_global_bypasses`.

### 6.3 Account age
`AccountAgeProvider` interface (`backend/src/modules/account-age`): `resolve(player, hint) → { created_at, source }`.
Implementations: `SteamWebApiAccountAgeProvider` (`STEAM_WEB_API_KEY`, `ISteamUser/GetPlayerSummaries/v2` `timecreated`,
only for steam ids; private profiles → unknown), `NoopAccountAgeProvider`. Result cached on `players`
(`account_age_checked_at`, refresh after `ACCOUNT_AGE_CACHE_DAYS`, default 7; unknown retried after 1 day).
If provider yields nothing and a hint was sent, source `server_reported`. **Account age is never a verdict (R4).**

### 6.4 VPN detection
```ts
interface VpnDetectionProvider { readonly name: string; check(ip: string, signal: AbortSignal): Promise<VpnCheckResult> }
interface VpnCheckResult { detected: boolean; confidence: VpnConfidence; type: VpnType | null; provider: string }
```
Implementations: `noop`, `cidr-list` (CIDR files from `VPN_CIDR_LIST_PATHS`; confidence `VPN_CIDR_CONFIDENCE`, default `likely`,
type `hosting`), `proxycheck` (proxycheck.io v2, `PROXYCHECK_API_KEY`), `iphub` (`IPHUB_API_KEY`).
`CompositeVpnProvider` runs configured providers (`VPN_PROVIDERS=cidr-list,proxycheck`) with per-provider timeout
(`VPN_PROVIDER_TIMEOUT_MS`, default 1500) and circuit breaker; result = highest confidence. Cached in Redis under the
network hash (`VPN_CACHE_TTL_SECONDS`, default 21600). Provider failures → `confidence: not_detected`,
`checked: false`, `error: "provider_unavailable"` (the plugin's policy decides). Private/reserved IPs → not detected.
**A VPN is never cheating (R3).**

### 6.5 In-game reports
`POST /api/v1/server/reports` `{ "player": {…}, "reporter": {…}|null, "reason": "…", "description"?: "…", "log_excerpt"?: "≤64 KiB text" }`
→ creates/attaches case (§11.1), report with `reporter_type=server`, optional `log` evidence (hashed text). Response
`201 { "report_id", "case_id" }`.

### 6.6 Linking a web account to an in-game identity
Web: `POST /api/v1/me/player-link` → `{ "code": "LNK-7K4X92", "expires_at" }` (Redis, 10 min, one active per user).
In game the player types the client console command `.trustlink LNK-7K4X92`; plugin calls
`POST /api/v1/player/link { "player": {…}, "code": "…" }` → backend links `users.player_id` (fails if that player is
already linked to another user), audit `PLAYER_LINKED`. Needed for appeals and whitelist requests.

---

## 7. Policy engine (local enforcement)

### 7.1 Model (`shared/src/schemas/policy.ts`, C# `ScpslTrust.Core.Policy`)
```json
{
  "version": 3,
  "backend_unavailable_action": "allow",
  "notify_on_enforcement": true,
  "honor_global_bypasses": false,
  "whitelist_url": "https://trust.example.org/whitelist",
  "rules": [
    { "id": "…", "enabled": true, "signal": "global_verdict", "action": "admin_notify", "statuses": ["confirmed"], "min_confirmed_servers": null, "message": null },
    { "id": "…", "enabled": true, "signal": "account_age", "action": "kick", "max_account_age_days": 7, "match_unknown_age": false, "message": "Your account must be at least 7 days old." },
    { "id": "…", "enabled": true, "signal": "account_age", "action": "admin_notify", "max_account_age_days": 14 },
    { "id": "…", "enabled": true, "signal": "vpn", "action": "require_whitelist", "min_vpn_confidence": "likely" },
    { "id": "…", "enabled": true, "signal": "alt_account", "action": "admin_notify", "min_alt_confidence": "medium", "require_linked_confirmed_case": false }
  ]
}
```

### 7.2 Evaluation (identical in TS and C#; verified by `shared/test-vectors/policy.json`)
Input: `PlayerCheckResponse` + policy. Output:
```json
{ "action": "kick", "applied": [ { "rule_id", "signal", "action", "reason_code" } ], "bypassed": [ … ],
  "notify_admins": true, "message": "…", "ban_duration_minutes": null }
```
1. For each enabled rule, in `sort_order`, test its condition:
   * `global_verdict`: `global_status ∈ statuses` and (`min_confirmed_servers` null or `confirmed_servers ≥ min`).
   * `account_age`: `days != null && days < max_account_age_days`, or `days == null && match_unknown_age`.
   * `vpn`: `vpn.confidence ≥ min_vpn_confidence` (ordinal).
   * `alt_account`: `alt_account.possible && confidence ≥ min_alt_confidence` and
     (`!require_linked_confirmed_case || linked_confirmed_cases.length > 0`).
   * `open_reports`: `open_reports ≥ min_open_reports`.
   * unknown signal → ignored (forward compatibility).
2. A matching rule is **bypassed** if an active bypass of its exempt type exists:
   `vpn→vpn_whitelist`, `account_age→account_age_whitelist`, `alt_account→alt_account_whitelist`,
   `global_verdict→verdict_override`, `open_reports→verdict_override`.
3. `action` = highest severity among applied rules (`allow` if none).
   Severity: allow 0 < admin_notify 1 < warn 2 < require_review 3 < require_whitelist 4 < kick 5 < ban 6.
4. `message` = message of the first applied rule with the winning action, else default text per action
   (`require_whitelist` default: "A VPN/proxy was detected. Request a whitelist at {whitelist_url}").
   Placeholders: `{case_id}`, `{days}`, `{whitelist_url}`, `{server_name}`.
5. `notify_admins` = any applied `admin_notify`/`require_review`, or (`notify_on_enforcement` and action ≥ warn).
6. `ban_duration_minutes` from the winning `ban` rule (first); a `ban` rule without a duration reports `0`
   (permanent). The field is `null` when the winning action is not `ban`.

Clarifications (fixed by `shared/test-vectors/policy.json`, binding for the C# port):
* Rules whose `action` is unknown are ignored like rules with an unknown `signal`.
* The array order of `rules` is the evaluation order; the wire model has no `sort_order` field.
* A rule may only carry the condition fields of its own signal (others absent or `null`); `min_vpn_confidence`
  must be `possible|likely|confirmed` and `min_alt_confidence` must be `low|medium|high` (the excluded values would
  match every player); `ban_duration_minutes` is only allowed on `ban` rules. A missing `enabled` means `true`.
* The message comes from the first applied rule with the winning action; if that rule has no message the default
  text for the action is used. Placeholder substitution is a single pass; unknown placeholders stay as they are.

### 7.3 Enforcement semantics (plugin)
| Action | Plugin behavior |
|---|---|
| allow | nothing |
| admin_notify | RA-console/hint message to online staff (`RemoteAdminAccess`), plugin log |
| warn | broadcast/hint to the player with `message` + admin notify if configured |
| require_review | player allowed; persistent staff notification (re-sent to staff joining later this round), logged |
| require_whitelist | kick with whitelist message (only reached when no bypass) |
| kick | `Player.Kick(message)` |
| ban | `Player.Ban(message, duration_seconds)` local ban (0 = permanent → configurable max) |
Backend unreachable/timeout → `backend_unavailable_action` (allow/admin_notify/kick). Cached last known policy is
used when policy fetch fails. Plugin config `policy_source: remote | local` (`local` uses `local_policy` from plugin
config, same schema). **The backend never dictates the action (R1).**

### 7.4 Default policy (materialized on registration)
`global_verdict [confirmed] → admin_notify`; `account_age < 3 days → admin_notify`; `vpn ≥ likely → admin_notify`;
`alt_account ≥ medium → admin_notify`; `backend_unavailable_action = allow`. Conservative: nothing is kicked by default.

---

## 8. Privacy-preserving signals

### 8.1 Network hashes
`network_hash = hex(HMAC-SHA256(IP_HASH_SECRET, "net:v1:" + normalized))` where normalized = IPv4 dotted quad, or IPv6
/64 prefix (`xxxx:xxxx:xxxx:xxxx::/64`). `prefix_hash` uses IPv4 /24 and IPv6 /48 with `"pfx:v1:"`. IPv4-mapped IPv6 →
IPv4. Raw IP is dropped after the request. `IP_HASH_SECRET` rotation invalidates correlation (documented).

### 8.2 Alt-account analysis (signal only, R5)
Within `ALT_LOOKBACK_DAYS` (default 30) find other players with the same `network_hash` (strong) or `prefix_hash` (weak).
Confidence:
* no other players → `possible:false, confidence:none`.
* only prefix matches → `low` (`same_network_prefix`).
* exact match → `medium` if ≤ `ALT_MAX_SHARED_ACCOUNTS` (default 4) distinct accounts share the network, else `low`
  + `shared_network_many_accounts`.
* network detected as VPN/hosting → at most `low` (+ `network_is_vpn`).
* `high` only if exact match AND linked account has a confirmed case AND linked account seen within 24 h AND this
  account is < 7 days old (or unknown age) — still only a signal.
`linked_confirmed_cases` lists case numbers of confirmed cases of linked accounts (public info). Linked player
identities are only visible to staff in the web panel (`player_links`), never to servers, never with IPs.

### 8.3 Retention (configurable, job `retention`)
| Data | Env | Default |
|---|---|---|
| network observations | `RETENTION_NETWORK_OBSERVATIONS_DAYS` | 30 |
| player signals | `RETENTION_PLAYER_SIGNALS_DAYS` | 90 |
| expired sessions / used tokens | `RETENTION_SESSIONS_DAYS` | 30 |
| overwatch secrets (wiped, row kept) | `RETENTION_OVERWATCH_SECRETS_DAYS` | 365 |
| VPN cache (Redis TTL) | `VPN_CACHE_TTL_SECONDS` | 21600 |
Case history, evidence metadata and audit events are **not** deleted (R7); evidence files may only be removed by a
documented legal-hold-aware admin procedure that is itself audited (out of scope for automatic retention).

---

## 9. Audit log

### 9.1 Writing
`AuditService.record(tx, { actor, action, target_type, target_id, server_id?, case_id?, metadata, request_id })`
must be called **inside the same DB transaction** as the change. It takes `pg_advisory_xact_lock(7274001)`, reads the
last `hash` (ORDER BY seq DESC LIMIT 1), obtains `nextval('audit_events_seq')`, computes

```
hash = sha256_hex( canonical_json(event_without_hashes) + prev_hash )
event_without_hashes = { seq, event_id, created_at, actor_type, actor_id, action, target_type, target_id,
                         server_id, case_id, metadata, request_id }
```
Genesis `prev_hash` = 64 × `0`. `canonical_json` = JSON with object keys sorted recursively, no whitespace, `seq` as
number, timestamps as ISO strings with ms, `null` for absent optional fields. Vectors: `shared/test-vectors/audit-chain.json`.
`GET /api/v1/admin/audit/verify` and CLI `verify-audit` recompute the chain and report the first broken `seq`.
Metadata must never contain passwords, tokens, keys, raw IPs or evidence content.

### 9.2 Actions
`USER_REGISTERED, USER_EMAIL_VERIFIED, USER_LOGIN_SUCCEEDED, USER_LOGIN_FAILED, USER_LOCKED, USER_LOGOUT,
USER_PASSWORD_CHANGED, USER_PASSWORD_RESET_REQUESTED, USER_PASSWORD_RESET, USER_2FA_ENABLED, USER_2FA_DISABLED,
USER_RECOVERY_CODE_USED, USER_ROLE_CHANGED, USER_STATUS_CHANGED, SESSION_REVOKED, PLAYER_LINKED, PLAYER_UNLINKED,
SERVER_CREATED, SERVER_REGISTRATION_TOKEN_CREATED, SERVER_REGISTERED, SERVER_UPDATED, SERVER_STATUS_CHANGED,
SERVER_TRUST_CHANGED, SERVER_MEMBER_ADDED, SERVER_MEMBER_REMOVED, SERVER_KEY_ROTATED, SERVER_KEY_REVOKED,
SERVER_KEY_ROTATION_REQUESTED, POLICY_UPDATED, CASE_CREATED, CASE_UPDATED, REVIEW_STARTED, CASE_NOTE_ADDED,
VERDICT_CHANGED, CASE_REOPENED, CASE_CONFIRMED_BY_SERVER, CASE_CONFIRMATION_REVOKED, REPORT_CREATED,
REPORT_STATUS_CHANGED, EVIDENCE_UPLOADED, EVIDENCE_REVIEWED, EVIDENCE_VERIFIED, EVIDENCE_REJECTED,
EVIDENCE_SUPERSEDED, EVIDENCE_ACCESSED, APPEAL_CREATED, APPEAL_ASSIGNED, APPEAL_RESOLVED, APPEAL_WITHDRAWN,
BYPASS_REQUESTED, BYPASS_APPROVED, BYPASS_REJECTED, BYPASS_REVOKED, BYPASS_EXPIRED, BYPASS_CREATED,
WHITELIST_REQUEST_EXPIRED, OVERWATCH_SESSION_STARTED, OVERWATCH_SESSION_ENDED, PROOF_VERIFIED,
AUDIT_CHAIN_VERIFIED, RETENTION_RUN`

(`BYPASS_REQUESTED/APPROVED/REJECTED` are used for whitelist requests; `BYPASS_CREATED` for direct server-admin grants.)
`USER_LOGIN_FAILED` for unknown emails is recorded with `actor_id=null` and metadata `{ reason }` only (no email).

---

## 10. Overwatch proof system

### 10.1 Session lifecycle
When a staff member (plugin config `overwatch_proof.required_permission`, default: `RemoteAdminAccess`) in Overwatch
mode spectates a target (`PlayerEvents.ChangedSpectator`; also RA command `trust proof start <player>`):
```
POST /api/v1/overwatch/sessions
{ "target_player": {…}, "spectator": {…}, "started_at": "iso" }
→ 201 { "session_id": "uuid", "secret": "<base64 32 bytes>", "interval_seconds": 10,
        "started_at": "iso", "heartbeat_interval_seconds": 30, "server_time": "iso" }
```
The secret is returned **only in this response** (to the authenticated server, over TLS), stored encrypted.
`started_at` from the plugin must be within ±60 s of backend time, else backend time is used.
Plugin sends heartbeat every 30 s; ends on target change / overwatch off / disconnect / round end:
`POST /overwatch/sessions/{id}/end { "reason": "target_changed" | "overwatch_disabled" | "spectator_left" | "target_left" | "round_ended" | "manual" }`.
Job expires sessions without heartbeat for > `OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS` (default 90): status `expired`,
effective end = `last_heartbeat_at + interval`.

### 10.2 Code derivation (identical TS/C#, vectors `shared/test-vectors/proof-codes.json`)
```
w       = floor(unix_seconds / interval_seconds)
message = "SCPSL-TRUST-PROOF-V1|" + session_id + "|" + server_id + "|" + target_user_id + "|" + spectator_user_id + "|" + w
mac     = HMAC-SHA256(key = secret(32 bytes), message UTF-8)
v       = big-endian uint32(mac[0..3]) >>> 2          // 30 bits
chars   = 6 × 5 bits from most significant, alphabet "0123456789ABCDEFGHJKMNPQRSTVWXYZ" (Crockford, no I L O U)
code    = chars[0..2] + "-" + chars[3..5]              // e.g. "7K4-X92"
```
`*_user_id` are canonical `<id>@<type>` strings. The plugin shows the code to the spectator as a hint, refreshed every
second: `PROOF 7K4-X92 · 15:42:20 UTC · srv_7k4x… · #<first 8 of session_id>`.

### 10.3 Proof API — `GET /api/v1/evidence/proof`
Query: `server_id`, `player_id` (canonical user id), `spectator_id`, `timestamp` (ISO or unix ms), `code?`, `session_id?`.
* Finds session(s) of that server/target/spectator whose effective interval `[started_at, effective_end]` covers the
  timestamp. Effective end = `ended_at` | `last_heartbeat_at + interval` (expired) | now (active).
* Caller **without** `proof:view_code` (anonymous, players, server admins): `code` is **required**; the response
  never contains the expected code: `{ "valid": bool, "server_id", "player_id", "spectator_id", "session_id"?, "timestamp_window": { "start", "end" }, "window_offset"? }`
  Accepts windows w−1, w, w+1 (clock drift) and reports which offset matched. `session_id` only when valid.
* Caller **with** `proof:view_code` (reviewer+): response additionally contains `"code"` (expected code for window w)
  even without a supplied code. Access is audited (`PROOF_VERIFIED`, metadata: session_id, valid).
* Invalid/unknown → `200 { "valid": false, … }` (no oracle about which field was wrong). Strict rate limit
  (`PROOF_RATE_LIMIT_PER_MINUTE`, default 20 per IP/user). Codes carry 30 bits; with 3 accepted windows brute force is
  infeasible under the rate limit.
* **A valid proof establishes session identity only; it never changes a verdict (R6).**
Evidence can reference `overwatch_session_id`; reviewers record the identity assessment separately.

---

## 11. Cases, reports, evidence, appeals, confirmations — business rules

### 11.1 Reports → cases
Creating a report (web `POST /reports` with `report:create`, or plugin `POST /server/reports`) attaches it to the
player's most recent case with status `open`/`under_review`; if none, a new case is created (`CASE_CREATED`, verdict
`unknown`). Audit `REPORT_CREATED`. Reports are never deleted; status changes (`report:review`) require a note and
are audited (`REPORT_STATUS_CHANGED`). Rate limit: 10 reports/hour/user, 1 open report per reporter per player.
**3 reports ≠ guilty**: report counts never change verdicts.

### 11.2 Verdicts
`POST /cases/{id}/verdict { verdict, comment, public_summary? }` (`case:set_verdict`, 2FA session):
* `confirmed` requires ≥ 1 non-superseded evidence with `cheating_status = verified` **and** `authenticity_status = verified`
  (else `422 INSUFFICIENT_EVIDENCE`).
* Reviewer must not be a reporter on the case (`409 CONFLICT_OF_INTEREST`).
* Writes `reviews(kind=verdict_set)`, sets `verdict_set_by/at`, status `closed` (for confirmed/rejected/inconclusive),
  open/under_review reports → `resolved` (or `rejected` if verdict rejected). Audit `VERDICT_CHANGED`.
* `POST /cases/{id}/reviews/start` → status `under_review`, `REVIEW_STARTED`. `POST /cases/{id}/notes` → `CASE_NOTE_ADDED`.
* `POST /cases/{id}/reopen` (`case:reopen`) → `under_review`, `CASE_REOPENED`.

### 11.3 Evidence
* Upload `POST /cases/{id}/evidence` multipart (`evidence:upload`: reviewers, server members of a server that reported
  on the case, the reporting user). Streaming to storage while computing SHA-256; `EVIDENCE_MAX_BYTES` (default 524288000);
  MIME sniffed from magic bytes (`file-type`) and checked against allow-list (`video/mp4, video/webm, video/x-matroska,
  image/png, image/jpeg, image/webp, image/gif, text/plain, application/json, application/zip, application/gzip`);
  mismatch → `415 UNSUPPORTED_MEDIA_TYPE`. `link` evidence: `POST /cases/{id}/evidence/link { url, title, … }` (https only).
* Evidence rows immutable (trigger). Replacement: `POST /evidence/{id}/supersede` (multipart) → new row with
  `supersedes_evidence_id`, old row gets `superseded_by_evidence_id`; audit `EVIDENCE_SUPERSEDED`. History preserved.
* Review: `POST /evidence/{id}/reviews { status, identity_status, authenticity_status, cheating_status, comment }`
  (`evidence:review`) → `evidence_reviews` row + current values; audit `EVIDENCE_REVIEWED` plus `EVIDENCE_VERIFIED` /
  `EVIDENCE_REJECTED` when overall status becomes verified/rejected. **Never changes the case verdict (R2).**
* Access: metadata → `evidence:view` (reviewer+), the uploader, members of the uploader server. Content download
  `GET /evidence/{id}/content` same rule, audited `EVIDENCE_ACCESSED`, served with `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`, `Cache-Control: private, no-store`.
  Integrity check: `GET /evidence/{id}` returns sha256; optional `?verify=true` re-hashes stored object (reviewer+).

### 11.4 Server confirmations
`POST /cases/{id}/confirmations { server_id, note }` — caller must be `owner`/`admin` member of that **active** server
(`case:confirm_for_server`), case verdict must be `confirmed` or case under review; one active confirmation per
server; `DELETE /cases/{id}/confirmations/{confirmationId}` = revoke (soft; `revoked_at`), audited. Counts are shown
to reviewers and servers but **never change a verdict automatically**.

### 11.5 Appeals
* `POST /appeals { case_id, statement }` by a user whose linked `player_id` equals the case player (`appeal:create`),
  only for verdict `confirmed` or `inconclusive`, one open appeal per case. Audit `APPEAL_CREATED`.
* `POST /appeals/{id}/assign { reviewer_user_id }` (`appeal:assign`); `POST /appeals/{id}/decision { decision, reason, override_conflict? }` (`appeal:decide`).
* Independence: decider ≠ `cases.verdict_set_by`, ≠ any reporter; else `409 CONFLICT_OF_INTEREST` unless caller has
  `appeal:override_conflict` (super_admin) and `override_conflict: true` (recorded, audited).
* Effects: `confirm` → verdict unchanged; `reverse` → verdict `rejected`; `inconclusive` → verdict `inconclusive`.
  Each writes a `reviews(kind=appeal_decision)` row, `APPEAL_RESOLVED`, and `VERDICT_CHANGED` if changed.
* `POST /appeals/{id}/withdraw` by submitter → `APPEAL_WITHDRAWN`.

### 11.6 VPN whitelist / bypass flow
* Player user with linked identity: `POST /whitelist-requests { server_id, type, reason, requested_days? }`
  → `pending`, `expires_at = now + WHITELIST_REQUEST_TTL_DAYS` (default 14), audit `BYPASS_REQUESTED`.
  Server must be `active` and `accepts_whitelist_requests`.
* Server member (`owner|admin|moderator`) of that server or `whitelist:decide_any`:
  `POST /whitelist-requests/{id}/decision { decision: "approve"|"reject", note, days? }` →
  approve creates `bypasses` row (scope `server`, type = request type, `expires_at = now + days` or null if days
  omitted and server allows permanent) → `BYPASS_APPROVED`; reject → `BYPASS_REJECTED`.
* `POST /whitelist-requests/{id}/revoke { reason }` → revokes bypass → status `revoked`, `BYPASS_REVOKED`.
* Direct grants: `POST /servers/{id}/bypasses { player, type, reason, expires_at? }` (`bypass:manage` for server) →
  `BYPASS_CREATED`; `POST /bypasses/{id}/revoke`. Global bypasses (`scope=global`) only with `bypass:manage_global` (admin+).
* Jobs: pending requests past `expires_at` → `expired` (`WHITELIST_REQUEST_EXPIRED`); bypasses past `expires_at` →
  `expired_processed_at` + `BYPASS_EXPIRED`; approved requests whose bypass expired → `expired`.
* The SCP:SL server has no local whitelist DB; it asks `/player/check` / `/player/bypass/check`.

---

## 12. Web authentication & RBAC

### 12.1 Sessions
* Cookie `stn_session` = 32 random bytes base64url; `HttpOnly; SameSite=Lax; Path=/; Secure` (`COOKIE_SECURE`, default
  true), signed via `@fastify/cookie` with `SESSION_SECRET`. DB stores sha256(token) only.
* Absolute lifetime `SESSION_TTL_HOURS` (168), idle `SESSION_IDLE_TIMEOUT_MINUTES` (720), `last_seen_at` refresh throttled.
  New session on every login (fixation protection). Password change/reset & 2FA changes revoke other sessions.
* CSRF: token = base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:" + session.id)); returned by login and
  `GET /auth/session`; required in `X-CSRF-Token` for every non-GET/HEAD/OPTIONS cookie-authenticated request
  (`403 CSRF_TOKEN_INVALID`). `Origin`/`Referer` must match `WEB_ORIGIN` when present.
* `JWT_SECRET` signs short-lived (60 s) evidence download tickets used by `<video>`/`<a>` elements
  (`GET /evidence/{id}/content?ticket=…`), obtained via `POST /evidence/{id}/ticket` (same permission check, audited).

### 12.2 Login, lockout, 2FA
* `POST /auth/login { email, password }` — per-IP (10/min) and per-account throttling; after
  `LOGIN_MAX_FAILURES` (5) → `locked_until = now + 15 min × 2^(n−5)` (max 24 h), `USER_LOCKED`. Unknown email and wrong
  password return the same `401 INVALID_CREDENTIALS` with equal timing (dummy hash verify).
* If email not verified and `EMAIL_VERIFICATION_REQUIRED=true` → `403 EMAIL_NOT_VERIFIED`.
* If 2FA enabled → `200 { "mfa_required": true, "mfa_token": "…" }` (Redis, 5 min, single use); then
  `POST /auth/login/2fa { mfa_token, code }` (TOTP or recovery code). TOTP step reuse rejected.
* Roles in `REQUIRE_2FA_ROLES` (default `reviewer,moderator,admin,super_admin`) without 2FA get a session flagged
  `mfa_enrollment_required`: every permission-protected route except `/auth/*` and `/me` returns `403 MFA_ENROLLMENT_REQUIRED`.
* Endpoints: `POST /auth/register`, `POST /auth/verify-email {token}`, `POST /auth/resend-verification`,
  `POST /auth/password/forgot {email}` (always 202), `POST /auth/password/reset {token, password}`,
  `POST /auth/password/change`, `GET /auth/session`, `POST /auth/logout`, `GET /auth/sessions`,
  `POST /auth/sessions/{id}/revoke`, `POST /auth/2fa/setup` (→ `{ secret, otpauth_uri }`, pending until enabled),
  `POST /auth/2fa/enable {code}` (→ 10 recovery codes shown once), `POST /auth/2fa/disable {password, code}`,
  `POST /auth/2fa/recovery-codes {password, code}` (regenerate).
* Password rules: 10–128 chars, not equal to email/username, argon2id. Tokens (verify/reset) 32 random bytes,
  stored sha256, 24 h / 1 h expiry, single use.
* Bootstrap: CLI `pnpm --filter @scpsl-trust/backend cli:create-admin --email … --username …` (password from prompt or
  `ADMIN_PASSWORD` env) creates a verified `super_admin`.

### 12.3 Permissions (`shared/src/permissions.ts`)
| Permission | player | server_admin | reviewer | moderator | admin | super_admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `case:view_public`, `report:create`, `appeal:create`, `whitelist:request`, `player:link` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `server:create`, `server:manage` (own membership), `policy:manage` (own), `bypass:manage` (own), `whitelist:decide` (own), `case:confirm_for_server` (own), `case:view_staff`(limited: cases their servers reported/confirmed) | | ✓ | | | ✓ | ✓ |
| `case:view_staff`, `case:review`, `case:set_verdict`, `evidence:view`, `evidence:download`, `evidence:review`, `evidence:upload`, `report:review`, `appeal:decide`, `player:view_staff`, `overwatch:view`, `proof:view_code`, `dashboard:staff` | | | ✓ | ✓ | ✓ | ✓ |
| `case:create`, `case:reopen`, `report:manage`, `appeal:assign`, `whitelist:decide_any`, `user:view` | | | | ✓ | ✓ | ✓ |
| `user:manage` (roles ≤ moderator), `server:manage_any`, `server:trust`, `audit:view`, `audit:verify`, `bypass:manage_global` | | | | | ✓ | ✓ |
| `user:manage_admins`, `appeal:override_conflict` | | | | | | ✓ |

**Server-scoped ("own") actions are authorized by server-team membership, not by the global role.** A user who is a
member of a server in `server_members` with an adequate member role may act on that server whatever their global role
is (`owner|admin` for manage/policy/confirm/bypass; `owner|admin|moderator` for whitelist decisions), so a server owner
can add moderators who only hold the `player` role. The global role matters only for `server:create`, for the override
permissions (`server:manage_any`, `whitelist:decide_any`) and for the web navigation hints. Case staff scope
`own_servers` (cases the user's servers reported or confirmed) applies to `server_admin` and to any user with at least
one membership (`caseStaffScope(role, hasServerMembership)`). `rbac.ts` offers `requirePermission(p)` and
`requireServerRole(serverIdParam, roles)` preHandlers; server-scoped routes use `requireAuth` + membership checks
(`assertServerRole` with the override permission), never `requirePermission('server:manage')`.

---

## 13. Web API (session cookie) — endpoint index

All under `/api/v1`. `P:` = required permission. Full request/response documentation lives in `docs/API.md`
(generated OpenAPI at `/api/docs/openapi.json`, Swagger UI at `/api/docs` when `OPENAPI_UI=true`).

**Auth / me**: see §12.2; `GET /me` (profile + permissions + linked player), `POST /me/player-link`,
`DELETE /me/player-link` (P: player:link).

**Dashboard**: `GET /dashboard` — counts (open cases, pending reports, pending appeals, evidence awaiting review,
pending whitelist requests, server status list, recent audit events) scoped by permissions/memberships.

**Cases**: `GET /cases` (P: case:view_staff; filters `status, verdict, player, q, server_id, page`),
`POST /cases` (case:create), `GET /cases/{caseNumber}` (staff view: reports, evidence, reviews, appeals,
confirmations, audit history), `POST /cases/{caseNumber}/reviews/start`, `/notes`, `/verdict`, `/reopen`,
`POST /cases/{caseNumber}/confirmations`, `DELETE /cases/{caseNumber}/confirmations/{id}`,
`GET /public/cases/{caseNumber}` (no auth; limited public view, `PUBLIC_CASE_LOOKUP=true`).

**Reports**: `GET /reports` (report:review, or own reports), `POST /reports` (report:create),
`GET /reports/{id}`, `POST /reports/{id}/status { status, note }` (report:review).

**Evidence**: `POST /cases/{caseNumber}/evidence` (multipart), `POST /cases/{caseNumber}/evidence/link`,
`GET /evidence?status=` (evidence:view — review queue), `GET /evidence/{id}`, `POST /evidence/{id}/ticket`,
`GET /evidence/{id}/content`, `POST /evidence/{id}/reviews`, `POST /evidence/{id}/supersede`,
`GET /evidence/proof` (§10.3, optional auth).

**Players**: `GET /players?q=` (player:view_staff), `GET /players/{userId}` (public view for everyone; staff view
adds signals, links, sightings, bypasses — never raw IPs).

**Servers**: `GET /servers` (own memberships; all with server:manage_any), `POST /servers` (server:create →
returns registration token once), `GET /servers/{id}`, `PATCH /servers/{id}`, `POST /servers/{id}/registration-token`,
`GET /servers/{id}/keys`, `POST /servers/{id}/keys/{keyId}/revoke`, `POST /servers/{id}/keys/rotation-request`,
`GET /servers/{id}/policy`, `PUT /servers/{id}/policy`, `POST /servers/{id}/policy/preview` (evaluate policy against a
sample check response using the shared engine), `GET/POST /servers/{id}/members`, `DELETE /servers/{id}/members/{userId}`,
`GET /servers/{id}/bypasses`, `POST /servers/{id}/bypasses`, `POST /bypasses/{id}/revoke`,
`POST /servers/{id}/status { status }` (server:manage_any), `POST /servers/{id}/trust { is_trusted }` (server:trust).
`{id}` is the public `server_id` (`srv_…`).

**Appeals**: `GET /appeals` (appeal:decide → all; else own), `POST /appeals`, `GET /appeals/{id}`,
`POST /appeals/{id}/assign`, `POST /appeals/{id}/decision`, `POST /appeals/{id}/withdraw`.

**Whitelist**: `GET /whitelist-requests` (own; server members see their servers; whitelist:decide_any all),
`POST /whitelist-requests`, `GET /whitelist-requests/{id}`, `POST /whitelist-requests/{id}/decision`,
`POST /whitelist-requests/{id}/revoke`.

**Overwatch**: `GET /overwatch/sessions` (overwatch:view), `GET /overwatch/sessions/{id}` (no secret, ever).

**Admin**: `GET /admin/users` (user:view), `PATCH /admin/users/{id} { role?, status? }` (user:manage /
user:manage_admins), `GET /admin/audit` (audit:view; filters actor, action, target, server, case, from, to),
`GET /admin/audit/verify` (audit:verify), `GET /admin/bypasses`, `POST /admin/bypasses` (global; bypass:manage_global).

---

## 14. API security controls
* Validation: every route has zod schemas for params, query, body and response (unknown keys stripped;
  response schemas prevent accidental leakage of internal fields).
* Size limits: JSON `bodyLimit` 1 MiB (plugin `/server/reports` 128 KiB); multipart per §11.3.
* Rate limiting (`@fastify/rate-limit`, Redis store): global 300/min per IP (web), 600/min per server (plugin),
  auth 10/min per IP, proof 20/min, report creation 10/h per user.
* Headers: `@fastify/helmet` (strict CSP for API responses, HSTS when `COOKIE_SECURE`), `Cache-Control: no-store` on
  authenticated responses, CORS only for `WEB_ORIGIN` with credentials.
* Replay protection: timestamp + nonce + request-id (§5.4); mfa tokens and reset tokens single-use.
* Trust: nothing from plugin or frontend is trusted without verification (signatures, schema, permissions, ownership).
* Error handler maps `AppError(code)` → status via `shared/errors.ts`; unknown errors → `500 INTERNAL_ERROR`
  with generic message; details never include stack traces or SQL.

### 14.1 Error codes (subset; the full list of 59 codes with statuses is `shared/src/errors.ts`)
`VALIDATION_FAILED 400, INVALID_AUTH_HEADERS 400, SERVER_ID_MISMATCH 400, UNAUTHENTICATED 401,
INVALID_CREDENTIALS 401, MISSING_AUTH_HEADERS 401, INVALID_SIGNATURE 401, TIMESTAMP_OUT_OF_RANGE 401,
REPLAYED_NONCE 401, UNKNOWN_SERVER 401, KEY_REVOKED 401, NO_ACTIVE_KEY 401, INVALID_MFA_CODE 401, MFA_TOKEN_INVALID 401,
FORBIDDEN 403, CSRF_TOKEN_INVALID 403, EMAIL_NOT_VERIFIED 403, ACCOUNT_LOCKED 423, ACCOUNT_DISABLED 403,
MFA_ENROLLMENT_REQUIRED 403, SERVER_SUSPENDED 403, SERVER_REVOKED 403, NOT_FOUND 404, CONFLICT 409,
DUPLICATE_REQUEST_ID 409, CONFLICT_OF_INTEREST 409, ALREADY_EXISTS 409, INVALID_STATE 409,
REGISTRATION_TOKEN_INVALID 400, PROOF_OF_POSSESSION_INVALID 400, PAYLOAD_TOO_LARGE 413,
UNSUPPORTED_MEDIA_TYPE 415, INSUFFICIENT_EVIDENCE 422, RATE_LIMITED 429, INTERNAL_ERROR 500,
SERVICE_UNAVAILABLE 503`.

---

## 15. Logging
pino JSON: `time, level, request_id, server_id?, user_id?, method, route (templated), status_code, latency_ms, result`.
Redacted paths: `req.headers.authorization, req.headers.cookie, req.headers["x-signature"], req.headers["x-csrf-token"],
*.password, *.token, *.secret, *.private_key, *.mfa_token, *.code, *.ip`. Client IP not logged unless `LOG_CLIENT_IP=true`
(then only the network hash). Bodies are never logged.

---

## 16. Environment variables (documented in `.env.example` and `docs/CONFIGURATION.md`)
`NODE_ENV, PORT (3000), HOST (0.0.0.0), PUBLIC_BASE_URL, WEB_ORIGIN, TRUST_PROXY, DATABASE_URL, DATABASE_POOL_MAX,
REDIS_URL, JWT_SECRET, SESSION_SECRET, DATA_ENCRYPTION_KEY (32 bytes base64), IP_HASH_SECRET, COOKIE_SECURE,
SESSION_TTL_HOURS, SESSION_IDLE_TIMEOUT_MINUTES, EMAIL_VERIFICATION_REQUIRED, ALLOW_REGISTRATION, REQUIRE_2FA_ROLES,
LOGIN_MAX_FAILURES, MAIL_TRANSPORT (smtp|file|noop), MAIL_FROM, SMTP_URL, MAIL_FILE_DIR, STORAGE_DRIVER (local|s3),
STORAGE_LOCAL_DIR, STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY,
STORAGE_FORCE_PATH_STYLE, EVIDENCE_MAX_BYTES, SIGNATURE_MAX_SKEW_SECONDS, KEY_ROTATION_GRACE_SECONDS,
REGISTRATION_TOKEN_TTL_HOURS, VPN_PROVIDERS, VPN_CIDR_LIST_PATHS, VPN_CIDR_CONFIDENCE, PROXYCHECK_API_KEY, IPHUB_API_KEY,
VPN_PROVIDER_TIMEOUT_MS, VPN_CACHE_TTL_SECONDS, STEAM_WEB_API_KEY, ACCOUNT_AGE_CACHE_DAYS, ALT_LOOKBACK_DAYS,
ALT_MAX_SHARED_ACCOUNTS, OVERWATCH_INTERVAL_SECONDS, OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS, PROOF_RATE_LIMIT_PER_MINUTE,
WHITELIST_REQUEST_TTL_DAYS, RETENTION_*, JOBS_ENABLED, PUBLIC_CASE_LOOKUP, OPENAPI_UI, LOG_LEVEL, LOG_CLIENT_IP,
RATE_LIMIT_*, SHUTDOWN_TIMEOUT_MS, DATABASE_STATEMENT_TIMEOUT_MS, AUTO_MIGRATE, MIGRATIONS_DIR, REDIS_KEY_PREFIX,
LOG_PRETTY, RATE_LIMIT_ENABLED, RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE`. Missing/weak secrets → startup failure
in production (`NODE_ENV=production`), generated ephemeral values only allowed in development with a loud warning.
The defaults of `MAIL_TRANSPORT` (smtp/file/noop) and `OPENAPI_UI` depend on `NODE_ENV`; `docs/CONFIGURATION.md`
is the authoritative variable reference.

---

## 17. Plugin architecture (C#)

### 17.1 ScpslTrust.Core (netstandard2.0, no game references)
* `Security/Ed25519Signer` (BouncyCastle), `Security/KeyStore` (identity.json load/save, atomic writes, chmod 600 via
  libc P/Invoke with try/catch), `Security/RequestCanonicalizer`, `Security/RequestSigner` (produces headers).
* `Api/TrustApiClient` (HttpClient, timeouts, JSON snake_case via `System.Text.Json` +
  `JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)`), DTOs in `Api/Models`, error model, retries only for
  idempotent GET/heartbeat.
* `Policy/PolicyEngine` (mirror of §7.2), `Policy/PolicyModels`, `Policy/PolicyCache` (last remote policy on disk).
* `Proof/ProofCodeGenerator` (§10.2), `Proof/OverwatchSessionManager` (per-spectator state, heartbeat scheduling hooks).
* `Config/TrustConfig` POCOs (YAML-friendly for LabAPI).
* `Abstractions/ILogger`, `IClock`, `IMainThreadDispatcher` — so Core stays testable.

### 17.2 ScpslTrust.Plugin (net48, references LabApi + Assembly-CSharp etc. from `plugin/lib` / `SCPSL_MANAGED_DIR`)
* `TrustPlugin : Plugin<TrustConfig>` — Enable/Disable, registers events, starts coroutine-based main-thread
  dispatcher (MEC `Timing`) and heartbeat.
* Events: `PlayerEvents.Joined` (async check → policy → enforcement on main thread), `PlayerEvents.Left`,
  `PlayerEvents.ChangedSpectator` + overwatch state (`Player.IsOverwatchEnabled`) for proof sessions,
  `PlayerEvents.ReportedCheater`/`ReportedPlayer` (forward if `forward_ingame_reports`), `ServerEvents.RoundEnded`.
* Commands (CommandSystem): RA/console parent `trust` with `register <token>`, `status`, `rotatekey`,
  `check <player>`, `proof start <player> | stop`, `policy reload`; client command `.trustlink <code>`.
* Hints: proof code overlay to the spectator (refresh 1 s), staff notifications via RA console + hint.
* Never logs private key, signatures, or full IPs.

### 17.3 Plugin config (LabAPI YAML `config.yml`)
`api_base_url, request_timeout_seconds (5), registration_token (optional, consumed once), policy_source (remote|local),
policy_refresh_seconds (300), check_on_join (true), send_ip_for_vpn_check (true), send_account_age_hint (false),
forward_ingame_reports (true), heartbeat_seconds (60), staff_notifications { enabled, use_hints, use_console },
overwatch_proof { enabled, auto_start_on_spectate, only_in_overwatch, required_permission, hint_vertical_offset },
local_policy { … §7.1 … }, max_ban_duration_minutes (0 = unlimited), debug (false)`.

---

## 18. Testing strategy
* shared: schema round-trips, signing canonicalization vectors, policy engine vectors, permissions matrix.
* backend (vitest + real PostgreSQL `scpsl_trust_test` + Redis db 15, or in-memory fakes where noted):
  Ed25519 verification (valid, invalid signature, tampered body/path/query, wrong key, expired/future timestamp,
  replayed nonce, duplicate request id, revoked key, retiring-key grace, suspended server), registration PoP, rotation,
  auth (login, lockout, 2FA, recovery codes, CSRF, session revocation, email verification, reset), authorization matrix
  (every protected route rejects unauthorized roles), case creation & numbering, verdict rules, evidence hashing/
  immutability triggers/permissions/supersede, appeals independence, bypass expiration, whitelist flow, VPN providers
  (composite, timeout, caching), account age, alt heuristics, policy engine, audit chain (tamper detection), proof codes
  (vectors, window drift, outside session, wrong target, no-code-leak for non-reviewers).
* plugin: xUnit for canonicalizer/signer/proof/policy against shared vectors, key store, API client (fake handler).
* e2e: DevClient (C#) against a running backend: register → heartbeat → check → overwatch → proof verification.
* web: vitest + Testing Library for API client (CSRF/error handling), permission-guarded navigation, policy editor.
