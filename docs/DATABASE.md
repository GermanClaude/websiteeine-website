# Database

PostgreSQL 16 is the system of record of the SCP:SL Trust Network. The schema is defined by
plain SQL migrations in [`backend/migrations`](../backend/migrations) and accessed through Kysely
with the typed `Database` interface in [`backend/src/db/types.ts`](../backend/src/db/types.ts).
The binding design is [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-database-schema-postgresql-16);
this document explains how to run it and why it is built the way it is.

Conventions (ARCHITECTURE §4):

* `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `created_at` / `updated_at timestamptz` (the
  `set_updated_at()` trigger maintains `updated_at`).
* Enum-like columns are `text` + `CHECK (col IN (...))` with lowercase snake_case values
  (constraint name `<table>_<column>_check`). The one exception is `audit_events.action`, which
  stores the upper-case event names of ARCHITECTURE §9.2 (`REPORT_CREATED`, …), exactly as
  `shared/src/enums.ts` defines them and the audit-chain test vectors hash them. The same value lists live in
  [`backend/src/db/enums.ts`](../backend/src/db/enums.ts) (`DB_ENUMS`); a test compares them with
  the live constraints.
* Foreign keys are `ON DELETE RESTRICT` (only `user_recovery_codes` and `server_policy_rules`
  cascade), and every foreign key has an index (enforced by a test).
* **Raw IP addresses are never stored.** Network columns only accept 64-hex HMAC hashes, and
  signal codes only a restricted alphabet, so an IP literal cannot be written by mistake.
* Secrets (`users.totp_secret_enc`, `overwatch_sessions.secret_enc`) must be in the encrypted
  `v1:<iv>:<ciphertext>:<tag>` format (CHECK), password hashes must be argon2id strings.

---

## 1. Setup

### 1.1 Roles and database

Development (the defaults used by `.env.example` and the tests):

```sql
-- as a PostgreSQL superuser
CREATE ROLE scpsl LOGIN PASSWORD 'scpsl' CREATEDB;
CREATE DATABASE scpsl_trust OWNER scpsl;
CREATE DATABASE scpsl_trust_test OWNER scpsl;
```

Production: separate the **schema owner** (runs migrations) from the **runtime role** used by the
backend. The owner of a table can disable its triggers, so the protection triggers are only a hard
guarantee against the runtime credential if that role does not own the tables.

```sql
-- as a superuser
CREATE ROLE scpsl_owner LOGIN PASSWORD '<strong secret>';
CREATE ROLE scpsl_app   LOGIN PASSWORD '<strong secret>';
CREATE DATABASE scpsl_trust OWNER scpsl_owner;
\c scpsl_trust
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO scpsl_app;

-- as scpsl_owner, once (applies to tables created by later migrations too)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scpsl_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scpsl_app;

-- as scpsl_owner, after running the migrations
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scpsl_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scpsl_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM scpsl_app;   -- defense in depth (R8)
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM scpsl_app;
```

Migrations run as `scpsl_owner`; the backend runs with `DATABASE_URL` pointing at `scpsl_app`.
The extensions `pgcrypto` and `citext` are *trusted* extensions (PostgreSQL ≥ 13), so the
database owner can create them without superuser rights.

### 1.2 Running migrations

```bash
# from the repository root (reads ../.env if present)
DATABASE_URL=postgres://scpsl:scpsl@localhost:5432/scpsl_trust pnpm migrate
pnpm migrate -- --status      # list applied / pending / modified migrations, change nothing
```

* `DATABASE_URL` (required) — connection string; never printed (the CLI only logs `host:port/db`
  and redacts credentials from error messages).
* `MIGRATIONS_DIR` (optional) — defaults to `<backend package root>/migrations`, found from
  both `src/` (tsx) and the tsup bundle in `dist/`. Container images must ship the `migrations/`
  directory next to `dist/` (or set `MIGRATIONS_DIR`).
* Built artefact: `node dist/cli/migrate.js` behaves identically.
* Exit code `0` on success, `1` on any failure.

What the migrator (`backend/src/db/migrator.ts`) guarantees:

| Guarantee | How |
|---|---|
| Order | files `NNNN_snake_case_name.sql`, applied in filename order; duplicate numbers and bad names are rejected |
| Atomicity | each file runs in its own transaction together with its `schema_migrations` row |
| No double application | `schema_migrations(version text PK, checksum text, applied_at)` |
| Concurrency | session-level `pg_advisory_lock(7274000)`; replicas starting together wait (default 120 s) |
| Integrity | sha256 of every applied file is re-checked on each run (CRLF/BOM-normalized); an edited (`MIGRATION_CHECKSUM_MISMATCH`) or deleted (`MIGRATION_FILE_MISSING`) applied migration aborts the run before anything is applied |
| Diagnostics | failures name the migration, SQLSTATE and — for syntax errors — the line |

Advisory lock keys in use: `7274000` migrator, `7274001` audit writer (`pg_advisory_xact_lock`),
`7274099` test template builder.

### 1.3 Test databases

`backend/tests/helpers/test-db.ts` provides disposable databases for integration tests:

```ts
import { createTestDatabase, useTestDatabase } from '../helpers/test-db';

const getDb = useTestDatabase();            // beforeAll: create, afterAll: drop
it('…', async () => { await getDb().db.selectFrom('users').selectAll().execute(); });

const testDb = await createTestDatabase(); // { name, url, db, pool, reset(), destroy() }
```

* Connects with `TEST_DATABASE_ADMIN_URL` (default `postgres://scpsl:scpsl@localhost:5432/postgres`,
  role needs `CREATEDB`).
* All migrations are applied once into a template `scpsl_trust_tpl_<fingerprint of the migration
  files>`; each test database is a fast `CREATE DATABASE … TEMPLATE` copy named
  `scpsl_trust_test_<time>_<random>`, so test files can run in parallel. Changing a migration
  produces a new template automatically; stale templates and test databases older than 12 h are
  dropped when a new template is built.
* `createTestDatabase({ migrate: false })` yields an empty database (used by the migrator tests).
* `reset()` truncates every table except `schema_migrations` (temporarily bypassing the
  protection triggers via `session_replication_role`, which requires superuser) and restarts the
  sequences.

---

## 2. Schema overview

28 tables (+ `schema_migrations`), grouped by domain. Migration file in brackets.

| Domain | Tables |
|---|---|
| Identity & access [0002] | `users`, `user_recovery_codes`, `user_tokens`, `sessions` |
| Servers [0003] | `servers`, `server_members`, `server_registration_tokens`, `server_keys` |
| Server policies [0004] | `server_policies`, `server_policy_rules` |
| Players & signals [0005] | `players`, `player_network_observations`, `player_server_sightings`, `player_signals`, `player_links` |
| Cases [0006] | `case_counters`, `cases`, `reports`, `appeals`, `reviews`, `case_server_confirmations` |
| Overwatch & evidence [0007] | `overwatch_sessions`, `evidence`, `evidence_reviews` |
| Whitelist & bypasses [0008] | `whitelist_requests`, `bypasses` |
| Audit [0009] | `audit_events` (+ sequence `audit_events_seq`) |
| Operational [0010] | `job_runs` (`schema_migrations` is created by the migrator) |

Sequences: `users_reviewer_number_seq` (reviewer pseudonyms, `nextReviewerNumber()`),
`audit_events_seq` (`nextAuditSeq()`); both are `OWNED BY` their column.

### 2.1 Relationships

```
users ─1:n─ sessions, user_tokens, user_recovery_codes (CASCADE)
users ─0..1:1─ players                      users.player_id (UNIQUE): linked in-game identity
users ─1:n─ servers                         servers.owner_user_id
users ─n:m─ servers                         via server_members (PK server_id+user_id; one 'owner')
servers ─1:n─ server_registration_tokens    at most one unused & unrevoked per server
servers ─1:n─ server_keys                   at most one 'active' per server
servers ─1:n─ server_policies ─1:n─ server_policy_rules   one active version per server
players ─1:n─ player_network_observations ─n:1─ servers   UNIQUE (player, network_hash, server)
players ─n:m─ servers                       via player_server_sightings (PK player+server)
players ─1:n─ player_signals (─n:1─ servers, optional)
players ─n:m─ players                       via player_links (player_id ≠ linked_player_id)
players ─1:n─ cases                         cases.player_id; case_number CASE-yyyy-nnnnnn
cases ─1:n─ reports                         reports.player_id / server_id / reporter_user_id / reporter_player_id
cases ─1:n─ appeals                         at most one open|under_review per case
cases ─1:n─ reviews (─n:1─ appeals, optional)
cases ─1:n─ case_server_confirmations ─n:1─ servers   one non-revoked per (case, server)
cases ─1:n─ evidence ─n:1─ reports, overwatch_sessions (optional)
evidence ─0..1:0..1─ evidence               supersedes_evidence_id / superseded_by_evidence_id
evidence ─1:n─ evidence_reviews
overwatch_sessions ─n:1─ servers, players (target), players (spectator)
whitelist_requests ─n:1─ players, users (requester), servers;  ─0..1:0..1─ bypasses
bypasses ─n:1─ players, users (granted_by), servers (iff scope = 'server')
audit_events ─n:1─ servers, cases           optional denormalized scope, part of the hash
```

### 2.2 Notable constraints

* `server_policy_rules`: the condition columns must match `signal` — e.g. `global_verdict` needs a
  non-empty `statuses ⊆ GlobalStatus`, `account_age` needs `max_account_age_days` or
  `match_unknown_age = true`, `vpn` needs `min_vpn_confidence`, `alt_account` needs
  `min_alt_confidence`, `open_reports` needs `min_open_reports`; condition columns of other signals
  must be NULL. `ban_duration_minutes` only for `action = 'ban'` (0 = permanent). Bounds:
  `min_confirmed_servers` 0–1000, `max_account_age_days` 1–36500, `min_open_reports` 1–1000,
  `message` ≤ 256, unique `sort_order` per policy.
* `evidence`: `link` ⇔ `external_url` (https only) and no `sha256`/`storage_key`/`size_bytes`;
  every other type needs `sha256`, `size_bytes`, `mime_type`, `storage_key`. At least one uploader.
* `bypasses`: `(scope = 'server') = (server_id IS NOT NULL)`.
* State consistency: closed cases have `closed_at`; `appeals.status = 'decided'` ⇔ `decision`;
  approved whitelist requests reference their bypass; key status `retiring`/`retired`/`revoked`
  carries its timestamp; web reports name `reporter_user_id`, server reports `server_id`.
* `case_counters`: allocate with the upsert below (`nextCaseCounterValue()` /
  `allocateCaseNumber()` in `src/db/sequences.ts`); `last_value` ≤ 999999 keeps the 6-digit format.

```sql
INSERT INTO case_counters (year, last_value) VALUES ($1, 1)
ON CONFLICT (year) DO UPDATE SET last_value = case_counters.last_value + 1
RETURNING last_value;
```

* `audit_events`: `UNIQUE (prev_hash)` makes a forked chain impossible; `created_at` must have
  millisecond precision (it is hashed as an ISO string); `metadata` must be a JSON object;
  `action` must be one of the upper-case AuditAction event names (§9.2). `seq` is strictly increasing
  but may have gaps (rolled back transactions); chain order is `ORDER BY seq`.

---

## 3. Protection triggers (R7, R8)

ARCHITECTURE R7 ("no silent deletion or modification of case history") and R8 ("every important
admin action is auditable") are enforced **in the database**, so that neither an application bug
nor a crafted request can rewrite history. All protection triggers raise **SQLSTATE `TN403`**
with the table (and column) in the error fields; `isForbiddenOperation(err, table?)` in
`src/db/errors.ts` detects them.

| Table | DELETE | TRUNCATE | UPDATE |
|---|---|---|---|
| `cases`, `reports`, `appeals`, `whitelist_requests`, `bypasses` | forbidden | forbidden | allowed (workflow state) |
| `reviews`, `evidence_reviews`, `audit_events` | forbidden | forbidden | forbidden (append-only) |
| `server_policy_rules` | forbidden | forbidden | forbidden (belongs to an immutable policy version) |
| `server_policies` | forbidden | forbidden | only `is_active` |
| `case_server_confirmations` | forbidden | forbidden | only `revoked_at`/`revoked_by`/`revoke_reason`, and only while not yet revoked |
| `evidence` | forbidden | forbidden | only `status`, `identity_status`, `authenticity_status`, `cheating_status`, `updated_at`; `superseded_by_evidence_id` once (see below) |

Trigger functions (migration 0001 unless noted): `set_updated_at()`, `forbid_delete()`,
`forbid_update()`, `forbid_truncate()` (statement-level: TRUNCATE bypasses row triggers, and
`TRUNCATE … CASCADE` from a parent table fires it too), `forbid_update_except(<mutable columns>)`
(generic whitelist guard), `evidence_guard_insert()` / `evidence_guard_update()` [0007],
`case_server_confirmation_guard_update()` [0006].

Evidence rules (§4.6, §11.3): content columns (`sha256`, `size_bytes`, `mime_type`,
`storage_key`, `external_url`, `uploaded_at`, `uploader_*`, `case_id`, `type`, title, description,
…) never change. A replacement is a **new** row with `supersedes_evidence_id` (same case, target not
yet superseded, at most one successor); afterwards the old row's `superseded_by_evidence_id` may be
set exactly once, and only to that successor. `superseded_by_evidence_id` cannot be set on insert.

The TypeScript types mirror these rules: the update type of protected columns is `never`, so
`db.updateTable('audit_events').set(...)` or `set({ sha256 })` on evidence do not compile, and the
append-only tables export no `*Update` alias.

Hardening: triggers stop the application role; a table **owner** or superuser could still
`ALTER TABLE … DISABLE TRIGGER`. Use the separate runtime role from §1.1, revoke `TRUNCATE` (and
`UPDATE`/`DELETE` on `audit_events`) from it, and verify the audit chain regularly
(`pnpm --filter @scpsl-trust/backend cli:verify-audit`).

---

## 4. Retention

Configured via `RETENTION_*` (ARCHITECTURE §8.3) and executed by the `retention` job. The job may
DELETE only from tables without protection triggers:

| Data | Table(s) | Action |
|---|---|---|
| network observations | `player_network_observations` (`last_seen_at` index) | delete after `RETENTION_NETWORK_OBSERVATIONS_DAYS` (30) |
| player signals | `player_signals` (`created_at` index) | delete after `RETENTION_PLAYER_SIGNALS_DAYS` (90) |
| expired/revoked sessions, used/expired tokens | `sessions`, `user_tokens` (`expires_at` indexes) | delete once expired (absolute or idle), revoked or used more than `RETENTION_SESSIONS_DAYS` (30) ago — job `auth-sessions-retention` |
| overwatch secrets | `overwatch_sessions.secret_enc` | set to NULL after `RETENTION_OVERWATCH_SECRETS_DAYS` (365); the row stays, proofs become unverifiable |
| job history | `job_runs` | may be pruned freely |

Case history (`cases`, `reports`, `reviews`, `appeals`, `case_server_confirmations`), evidence
metadata, whitelist requests, bypasses, policy versions and `audit_events` are **never deleted**
(R7). Evidence *files* may only be removed by the documented, audited legal-hold procedure
(outside automatic retention); the metadata row remains. Rotating `IP_HASH_SECRET` makes old
network hashes uncorrelatable, which is equivalent to purging them.

---

## 5. Using the database from TypeScript

```ts
import { createDatabase, withTransaction, isUniqueViolation, allocateCaseNumber } from './db';

const { db, destroy } = createDatabase({ connectionString: config.DATABASE_URL, poolMax: 10, statementTimeoutMs: 15_000 });

await withTransaction(db, async (trx) => {
  const caseNumber = await allocateCaseNumber(trx);          // CASE-2026-000042
  await trx.insertInto('cases').values({ case_number: caseNumber, player_id, reason }).execute();
  // audit event in the same transaction (ARCHITECTURE §9.1)
}, { isolation: 'read committed' });
```

* Type parsing is configured per pool: `bigint` → `number` (throws beyond 2^53 instead of losing
  precision), `numeric` → string, `timestamptz` → `Date`, `text[]` → `string[]`, `jsonb` → objects.
  Sessions run with `TimeZone=UTC`.
* `withTransaction(db, fn, { isolation?, readOnly?, retries? })` joins an outer transaction when
  `db` already is one (throwing if a stricter isolation level is requested than the outer one has).
  `retries` re-runs the callback on serialization failures / deadlocks.
* Error helpers: `isUniqueViolation(err, constraint?)`, `isForeignKeyViolation`,
  `isCheckViolation`, `isNotNullViolation(err, column?)`, `isForbiddenOperation(err, table?)`,
  `isRetryableTransactionError`, `getPgError`. Constraint names are stable (explicitly named in the
  migrations), e.g. `users_email_key`, `users_username_key` (case-insensitive),
  `appeals_one_open_per_case_key`, `whitelist_requests_one_pending_key`.

---

## 6. Adding a migration

1. Create `backend/migrations/NNNN_short_description.sql` with the next number. **Never edit or
   delete a migration that has been applied anywhere** — the checksum check will stop every
   deployment. Fix mistakes with a new migration.
2. Write plain SQL without `BEGIN`/`COMMIT` (the migrator wraps the file in a transaction). If a
   statement cannot run in a transaction (e.g. `CREATE INDEX CONCURRENTLY`), make the first line
   `-- migrate:no-transaction` and keep the file idempotent (`IF NOT EXISTS`), since a failure can
   leave it partially applied.
3. Name every constraint explicitly (`<table>_<column>_check`, `<table>_<cols>_key`, …); add an
   index for every new foreign key and filter column; add `COMMENT ON TABLE` for new tables; add
   `set_updated_at` / protection triggers where applicable.
4. Update `backend/src/db/types.ts` (and `enums.ts` for enum values), then update
   `backend/tests/db/schema-manifest.ts`. `pnpm --filter @scpsl-trust/backend typecheck` fails
   until the manifest matches the types, and the schema test fails until it matches the SQL.
5. New enum value: drop and re-add the CHECK constraint in the new migration, e.g.

   ```sql
   ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
   ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (..., 'NEW_ACTION'));
   ```

   (`ALTER TABLE` does not fire the row-level UPDATE triggers, so this also works on protected
   tables.) Update `DB_ENUMS` and the shared enum in the same change.
6. Run `pnpm --filter @scpsl-trust/backend exec vitest run tests/db` and the typecheck.
