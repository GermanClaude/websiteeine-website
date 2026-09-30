# End-to-end verification (plugin ⇄ backend ⇄ web)

`e2e/run.sh` drives the whole system with **real processes**: the backend (`tsx src/index.ts`) against a real
PostgreSQL database and Redis, the **real DevClient binary** (`plugin/tools/ScpslTrust.DevClient`, the same
`ScpslTrust.Core` signing/key-store/API code the LabAPI plugin uses) for every signed plugin request, and plain
HTTP (cookie + CSRF, exactly like the browser) for the web API. Optionally it builds the web app and checks the
Vite dev-server proxy.

## Prerequisites

| Requirement | Default / how to override |
|---|---|
| Node 22 + pnpm 10, workspace installed (`pnpm install`) | — |
| PostgreSQL 16, a role allowed to create databases | `E2E_PG_ADMIN_URL` (default `postgres://scpsl:scpsl@localhost:5432/postgres`) |
| Redis 7 | `E2E_REDIS_URL` (default `redis://localhost:6379/14`; a per-run `REDIS_KEY_PREFIX` isolates runs) |
| .NET 8 SDK | `DOTNET_ROOT` (default `/opt/dotnet`) |
| SCP:SL managed assemblies (plugin build) | `SCPSL_MANAGED_DIR` (default `/opt/scpsl/SCPSL_Data/Managed`) |
| Free TCP port for the backend | `E2E_PORT` (default `3200`); database name `E2E_DB_NAME` (default `scpsl_trust_e2e`) |

Docker is not needed.

## Running

```bash
e2e/run.sh                 # full run (~45 s): builds plugin solution + DevClient, runs all steps, builds web
e2e/run.sh --skip-build    # reuse an existing Release build of the DevClient
e2e/run.sh --skip-web      # skip step k (web build + Vite proxy)
e2e/run.sh --keep-db       # keep the scpsl_trust_e2e database for inspection
```

The script prints `PASS`/`FAIL` per step and a summary, and exits non-zero on the first failure. On exit it
stops the backend (and the Vite server), and drops the database unless `--keep-db` is given. Logs and run data
stay in `e2e/.data/` (git-ignored): `backend.log`, `migrate.log`, `create-admin.log`, `dotnet-build.log`,
`evidence/` (local object storage), `identities/` (DevClient identity files), `mail/` (file mail transport).

### What `run.sh` sets up
1. Drops/creates the database, runs `pnpm migrate`, creates a verified super admin with `cli:create-admin`.
2. Builds `plugin/ScpslTrust.sln` in Release (unless `--skip-build`).
3. Starts the backend with `NODE_ENV=development`, `COOKIE_SECURE=false`, `EMAIL_VERIFICATION_REQUIRED=false`,
   `MAIL_TRANSPORT=file`, `STORAGE_DRIVER=local` (under `e2e/.data/evidence`), `JOBS_ENABLED=true`,
   `OPENAPI_UI=true`, `KEY_ROTATION_GRACE_SECONDS=2` and freshly generated secrets, then waits for `GET /api/v1/time`.
4. Runs `e2e/e2e.mjs` (Node, `fetch` only; TOTP codes are computed with `otpauth` from the backend's dependencies).

## Coverage

| Step | What is exercised (all assertions are on JSON fields / status codes) |
|---|---|
| a | Super-admin login (cookie + CSRF); staff route blocked with `MFA_ENROLLMENT_REQUIRED` until TOTP enrolment (`/auth/2fa/setup` + `/enable`); `POST /servers` → `sreg_…` token, status `pending` |
| a2 | Wrong `X-CSRF-Token` → `403 CSRF_TOKEN_INVALID` |
| b | DevClient `init` + `register` (proof of possession) → `active`, fingerprint matches; a used token is refused (`REGISTRATION_TOKEN_INVALID`); signed heartbeat; default policy v1 (four `admin_notify` rules, `backend_unavailable_action=allow`) |
| c | `/player/check` for an unknown player → `global_status: none`, **no `action` field** (R1); web report (by a separate reporter account) creates a case → `reported`, `reports: 1`, `case_id` |
| d | Multipart evidence upload (PNG) → `sha256` equals the local hash; a text file posing as mp4 → `415 UNSUPPORTED_MEDIA_TYPE`; ticket download (no session) re-hashes identically; verdict without verified evidence → `422 INSUFFICIENT_EVIDENCE`; review start (`under_review` visible to the plugin), 3-part evidence review, verdict `confirmed` → check shows `confirmed` + `case_id`; public case lookup |
| e | Second owner (`server_admin`) creates + registers server 2 with a second DevClient identity; confirming for a foreign server → `403`; confirming before server 2 saw the player → `403`; after a signed `/player/check` from server 2, confirmation for server 2 → check from server 1 shows `confirmed_servers ≥ 1`, `independent_confirmed_servers ≥ 1` |
| f | `POST /me/player-link` → DevClient `link` (signed `/player/link`) → `/me.linked_player`; link code single-use; VPN whitelist request for server 1; other owner cannot decide it; owner approves → `/player/bypass/check` `bypass: true` on server 1, `false` on server 2 |
| g | DevClient `overwatch` (real session, codes printed from the returned secret): anonymous `GET /evidence/proof` with the printed code → `valid: true` + `session_id`, no `code` in the response; wrong code → `valid: false`; reviewer without code → expected `code` equals the printed one; session `ended`; web overwatch view never exposes the secret |
| i | DevClient `--tamper-signature` → `INVALID_SIGNATURE`; `--replay` (same nonce/request id twice) → `REPLAYED_NONCE`; unsigned request → `MISSING_AUTH_HEADERS` |
| h | DevClient `rotate` → new key works immediately; after the 2 s grace a copy of the old identity is refused (`NO_ACTIVE_KEY`); web key list shows new key `active`, old key `retiring`/`retired`; web key revocation → DevClient gets `KEY_REVOKED` |
| j | `GET /admin/audit/verify` → `valid: true`; reviewer #2 blocked until 2FA enrolment; linked player appeals the confirmed case; the verdict setter's decision → `409 CONFLICT_OF_INTEREST`; reviewer #2 decides `reverse` → case verdict `rejected`, plugin sees `global_status: rejected`; audit chain still valid |
| k | `pnpm build` of the web app; Vite dev server on a free port proxies `/api/v1/time` to the backend and serves `index.html` |

Step i runs before h so that the key revocation at the end of h does not interfere.

## DevClient negative-test flags

Added for this suite (development only, never part of the plugin):

* `--tamper-signature` — flips one character of `X-Signature` on signed requests (expect `INVALID_SIGNATURE`).
* `--replay` — sends each signed request twice with identical headers and body and reports the second response
  (expect `REPLAYED_NONCE`).

## Notes for writing further steps

* Proof timestamps must not lie in the backend's future: an active session covers `[started_at, now]`.
* Reviewers cannot review evidence they uploaded, and a reporter cannot set the verdict — the suite therefore uses
  separate accounts (`reporter`, `owner2`, `suspect`, `reviewer2`, all registered through `POST /auth/register`
  and promoted with `PATCH /admin/users/{id}` where needed).
* TOTP step reuse is rejected; `e2e.mjs` waits for a fresh 30 s step when a secret was already used in the current one.

## Web smoke test (real browser)

`e2e/web-smoke.mjs` drives the **real web UI** in headless Chromium (Playwright) against a running backend and
Vite dev server, and uses the Debug DevClient for the plugin side. It asserts visible results (headings, badges,
table cells, toasts) and fails on horizontal overflow at 1280 px / 390 px and on browser console errors
(except the expected 401 of the logged-out session probe).

Flow: admin login → forced 2FA enrolment on the security page (secret read from the page, codes via `otpauth`) →
dashboard counts → create server (token shown once) → DevClient `register` + `heartbeat` → server shows Active/Online →
keys tab → policy editor: add "account age < 7 days → kick", save (version +1), preview shows Kick, backend preview
agrees → second user registers through the UI → reports a Steam id → uploads a PNG from the report page (the reporter
only sees the public case view) → admin opens all case tabs, starts the review, records the three assessments,
sets verdict *confirmed* → logged-out public case page shows only the public summary → player links the in-game
account (profile code + DevClient `link`) → requests a VPN whitelist → owner approves (DevClient `bypass` → true) →
admin users, audit log, "Verify hash chain" → proof page validates a code from a DevClient `overwatch` session →
mobile navigation. Screenshots (1280/390 px, light/dark) go to `e2e/.data/websmoke/screenshots/`.

The admin must be freshly created (2FA not yet enrolled) and `smoke_player` must not exist, so start from an empty
database each run:

```bash
# once: Playwright client (not a workspace dependency) + Debug DevClient
mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y >/dev/null && npm i playwright-core@1.56.1)   # matches chromium-1194
(cd plugin && dotnet build tools/ScpslTrust.DevClient -c Debug)

# backend on :3310 (database scpsl_trust_websmoke, Redis prefix websmoke:) — env as in e2e/run.sh, plus
#   PORT=3310 WEB_ORIGIN=http://localhost:5190 PUBLIC_BASE_URL=http://localhost:5190 STORAGE_LOCAL_DIR=e2e/.data/websmoke/evidence
(cd backend && pnpm migrate && pnpm cli:create-admin --email admin@websmoke.test --username smoke_admin)   # ADMIN_PASSWORD in env
(cd backend && pnpm exec tsx src/index.ts) &
(cd web && VITE_API_PROXY_TARGET=http://localhost:3310 pnpm exec vite --port 5190 --strictPort) &

PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright-core/index.mjs \
  ADMIN_EMAIL=admin@websmoke.test ADMIN_PASSWORD=... node e2e/web-smoke.mjs
```

Other variables: `SMOKE_WEB` (default `http://localhost:5190`), `SMOKE_API` (`http://127.0.0.1:3310`, used by the
DevClient), `SMOKE_DATA`, `DEVCLIENT`, `DOTNET_ROOT` (`/opt/dotnet`), `SMOKE_HEADFUL=1`. On failure the script saves
`FAIL-<step>.png` and prints the page's ARIA snapshot. Exit code is non-zero on any failed step.
