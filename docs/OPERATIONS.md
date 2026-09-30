# Operations: failure modes, health and monitoring

What happens when a dependency of the SCP:SL Trust Network is down, and what an operator should do
about it. Everything below was **measured** on a live stack (backend on `:3340`, database
`scpsl_trust_ops`, Redis prefix `ops:`, the real `ScpslTrust.DevClient` binary for the signed plugin
side) by stopping the dependency and recording the actual status codes, responses and log lines. The
few statements that come from code and unit tests instead of a live drill are marked *(not drilled)*.

Related docs: [ARCHITECTURE.md](ARCHITECTURE.md) (binding design), [CONFIGURATION.md](CONFIGURATION.md)
(every variable), [DEPLOYMENT.md](DEPLOYMENT.md) (topology, backups, logs),
[DATABASE.md](DATABASE.md) (schema, restore), [SECURITY.md](SECURITY.md) (threat model),
[E2E.md](E2E.md) (how the stack is exercised end to end).

---

## 1. The short answer: fail-open or fail-closed?

**The backend fails closed; the game server fails open by default — and that default is the server
owner's choice, not ours (R1).**

When a plugin cannot reach the backend (network error, timeout, HTTP error, auth failure, not
registered), it does not guess. It applies the server's own policy field
`backend_unavailable_action`, whose built-in default (§7.4) is `allow`:

| `backend_unavailable_action` | Player experience while the backend is down |
|---|---|
| `allow` (**default**) | The player joins normally. Nothing is said to the player; the failure is a `warn` in the server log. |
| `admin_notify` | The player joins, and online staff get *"Trust check unavailable; the player was admitted without a check."* |
| `kick` | The player is kicked with *"This server could not verify your account with the trust network. Please try again in a few minutes."*, and staff are notified. |

Anything else (an unknown or disallowed value) falls back to `allow`. This is deliberate: the trust
network is an information source, never an authority over who may play. Only the server owner decides
whether an outage means "let everyone in" or "let no one in", and they change it in the web panel's
policy editor at any time.

### What was observed

A `PolicyManager` + `PlayerCheckService` (the exact classes the LabAPI plugin uses) pointed at a dead
port, with a real registered identity:

```
identity: server_id=srv_… registered=True
[info ] Using cached policy version 1 until the backend is reached.
policy after Initialize: cache policy v1 origin=Cache backend_unavailable_action=allow
[warn ] Policy refresh failed (CLIENT_NETWORK_ERROR (request …)); keeping cache policy v1.
[warn ] Trust check for 76561198000000001@steam failed: CLIENT_NETWORK_ERROR (request …); applying backend_unavailable_action.
backendAvailable=False  action=Allow  notifyAdmins=False  message=<null>  policy=cache policy v1
```

The same drill after the owner set `backend_unavailable_action: kick` in the panel (policy v2, fetched
and cached once while the backend was up, then the backend killed):

```
[info ] Using cached policy version 2 until the backend is reached.
policy after Initialize: cache policy v2 origin=Cache backend_unavailable_action=kick
backendAvailable=False  action=Kick  notifyAdmins=True
message=This server could not verify your account with the trust network. Please try again in a few minutes.
```

Three properties confirmed by those runs:

* **A failed refresh never replaces a working policy.** `PolicyManager.RefreshAsync` keeps the current
  policy and only records `LastError`; the origin stays `cache`/`remote`.
* **The cache survives a plugin restart.** `policy-cache.json` next to `identity.json` is loaded on
  start-up (`Using cached policy version N until the backend is reached`), so a server that restarts
  while the backend is down still enforces the owner's real policy, not the built-in default.
* **A fresh install that has never reached the backend** has no cache and uses the §7.4 default policy
  — four `admin_notify` rules and `backend_unavailable_action: allow`.

The DevClient reports the same failure verbatim, with no fallback of its own (it is a diagnostic tool,
not an enforcement point):

```
$ trust-devclient check --api http://127.0.0.1:3399 --player 76561198000000001@steam
{"error":{"code":"CLIENT_NETWORK_ERROR","message":"Cannot reach the trust backend: Connection refused (127.0.0.1:3399)","request_id":"…"}}
```

Registration, heartbeat and `policy` fail the same way. Heartbeats simply resume when the backend is
back — **no re-registration is needed**: after a full backend restart, the same `identity.json` kept
working (`heartbeat → {"status":"active","policy_version":2,…}`, signed `/player/check` → 200) with no
new registration token. The server identity lives in PostgreSQL and in the server's key file; nothing
about it is kept in Redis or in memory.

---

## 2. Failure-mode matrix

| Dependency down | Symptom | Still works | Degrades / stops | Operator action |
|---|---|---|---|---|
| **Backend** (from a game server) | Plugin logs `CLIENT_NETWORK_ERROR … applying backend_unavailable_action` | Everything else on the game server; the cached policy stays in effect | No new trust information; new joins take the policy's `backend_unavailable_action` (default `allow`) | Fix the backend. Owners who cannot accept unchecked joins set `kick` beforehand |
| **Redis** | `/readyz` → `503` with `{"database":"ok","redis":"error"}`; log `Redis connection error`, `job lock unavailable` | `/healthz`, `/api/v1/time`, read routes, existing web sessions (measured 200, but ~5 s per request while the limiter store times out) | Signed plugin routes → **`503 SERVICE_UNAVAILABLE`** (replay protection cannot be guaranteed → fail closed); **new logins → `500`** (the MFA token store is unavailable); rate limits are not enforced; VPN result cache empty; scheduled jobs skip their run | Restart Redis. Recovery is automatic — no backend restart needed (`/readyz` back to `ready`, rate limiting and `REPLAYED_NONCE` confirmed working again) |
| **PostgreSQL** | `/readyz` → `503` with `{"database":"error","redis":"ok"}` | `/healthz` → `200`, `/api/v1/time` → `200` | Signed plugin routes → `503 SERVICE_UNAVAILABLE`; web routes that touch data → `500 INTERNAL_ERROR` (generic body, **no internals leaked** — no host, query, driver or stack in the response, only `request_id`) | Restart/fail over PostgreSQL. Recovery is automatic (the pool reconnects; a session that was valid before the outage worked again immediately) |
| **Evidence storage** (local dir unusable, S3/MinIO refusing) | Upload → **`502 STORAGE_ERROR`** ("Evidence storage is unavailable"); downloading an object whose store is gone → `502` | Case, report, verdict, appeal, audit and policy data — all metadata reads (`GET /cases/{n}` → `200`); ticket issuance still succeeds (it is signed, not stored) | No new evidence uploads; no file downloads | Fix the mount/bucket. `/readyz` does **not** cover storage (see §5) |
| **VPN provider** (proxycheck.io, IPHub) | Log `vpn provider failed` with `provider`; player check still `200` | The whole player check | `vpn: {"checked": false, "error": "provider_unavailable"}` — no VPN signal for that player | None if brief. The circuit breaker opens after 3 consecutive failures and skips the provider for 60 s |
| **Steam Web API** | Log `steam account age lookup failed` (`warn`); player check still `200` | The whole player check | `account_age: {"source": "unknown"}` — an `account_age` policy rule has no data to fire on | Check `STEAM_WEB_API_KEY` and the Steam status page |
| **SMTP** | `POST /auth/password/forgot` → `202` as always; log `password reset mail could not be sent` | Login, the whole API | No verification, reset or notification mail arrives | Fix SMTP; users request a new mail afterwards |
| **Backend restart** | Brief connection refused | — | In-flight requests fail | None. Sessions, identities and policies survive; no re-registration |
| **Plugin / game-server restart** | — | — | — | None. `identity.json` + `policy-cache.json` are read back on start-up |

### Measured details worth knowing

**Redis.** The nonce/request-id store is what makes replay protection work, so `server-auth` refuses
signed requests when it cannot reach Redis — `503 SERVICE_UNAVAILABLE`, logged as
`event: "server_auth_unavailable"`. That is the right call: the plugin then applies
`backend_unavailable_action`, which is exactly the owner-controlled path of §1. Everything else is a
best-effort store, so it degrades. One rough edge remains: **`POST /auth/login` returns
`500 INTERNAL_ERROR` for an account with 2FA** because the short-lived MFA token cannot be written.
The password is verified first and no session is issued, so this is fail-closed and safe, but the
status code says "bug" where it should say "dependency down". Existing sessions keep working
(`GET /auth/session` → `200`).

Redis is optional in development (in-memory stores, single process) and **required in production** —
the config loader refuses to start:

```
REFUSED:
  - REDIS_URL is required in production (nonces, rate limits, locks)
```

**PostgreSQL.** There is no read-only or degraded mode: PostgreSQL is the system of record (including
the audit hash chain), so an outage is a full outage for anything that reads or writes data. The
important verified property is that nothing leaks — the 500 body is
`{"error":{"code":"INTERNAL_ERROR","message":"Internal server error","request_id":"…"}}` and the
connection error, driver name and stack appear only in the server log.

**Evidence storage.** Uploads and downloads fail; everything *about* the evidence keeps working,
because metadata, hashes and the audit trail live in PostgreSQL. Objects are write-once and
content-addressed by SHA-256, so an interrupted upload leaves no half-object behind.

**VPN / account age.** Measured against a dead provider (`VPN_PROVIDERS=iphub` with an invalid key,
`VPN_PROVIDER_TIMEOUT_MS=800`, an invalid `STEAM_WEB_API_KEY`): the signed `/player/check` answered
`200` in ~1.3 s with `vpn.checked: false`, `vpn.error: "provider_unavailable"` and
`account_age.source: "unknown"`. A slow or broken enrichment provider can never fail a player check or
block a join. The per-provider timeout, the 3-failure circuit breaker and the 60 s cooldown are also
covered by unit tests in `backend/tests/modules/vpn/providers.test.ts`. Reserved and private addresses
(including `203.0.113.0/24`) are never sent to a provider at all and come back as `checked: false`
without an error — do not mistake that for an outage.

---

## 3. Health endpoints

| Endpoint | Meaning | Codes |
|---|---|---|
| `GET /healthz` | **Liveness.** The process is up and serving. Checks nothing else — it answered `200` with both Redis and PostgreSQL down. Use it to decide whether to restart the container. | `200 {"status":"ok"}` |
| `GET /readyz` | **Readiness.** PostgreSQL `SELECT 1` and a Redis `PING`, each with a 2 s timeout. Use it to decide whether to send traffic. | `200 {"status":"ready","checks":{…}}`, or `503 SERVICE_UNAVAILABLE` with `details.checks` naming the failing dependency |
| `GET /api/v1/time` | Backend clock, unsigned, for plugin clock-skew diagnostics. Not a health probe, but a cheap end-to-end reachability check for a game server. | `200` |

Both probes are exempt from rate limiting and from request logging. `redis` reads `disabled` (not
`error`) when `REDIS_URL` is unset — that is the in-memory development mode, and `/readyz` still
reports `ready`.

---

## 4. External dependencies

| Service | What it is for | Behaviour when unavailable | Configured with | Cost |
|---|---|---|---|---|
| **Steam Web API** (`ISteamUser/GetPlayerSummaries`) | Account creation dates for the `account_age` signal | `account_age.source: "unknown"`; the check succeeds | `STEAM_WEB_API_KEY` ([CONFIGURATION.md § Account age](CONFIGURATION.md)) | Free key, per-key rate limits. Results are cached for `ACCOUNT_AGE_CACHE_DAYS` (7); unknown results are retried after a day |
| **proxycheck.io** | VPN/proxy detection | `vpn.checked: false`, `error: provider_unavailable`; the check succeeds | `VPN_PROVIDERS=proxycheck`, `PROXYCHECK_API_KEY` | Works keyless at a lower daily quota; paid tiers above it |
| **IPHub** | VPN/proxy detection | as above | `VPN_PROVIDERS=iphub`, `IPHUB_API_KEY` (required) | Free tier with a daily quota; paid plans above it |
| **CIDR lists** (`cidr-list`) | Offline VPN/hosting ranges | Cannot fail at runtime — files are read locally | `VPN_PROVIDERS=cidr-list`, `VPN_CIDR_LIST_PATHS`, `VPN_CIDR_CONFIDENCE` | Free |
| **SMTP** | Verification, password reset, notifications | Mail is not delivered; `/auth/password/forgot` still answers `202`; the error is logged | `MAIL_TRANSPORT=smtp`, `SMTP_URL`, `MAIL_FROM` | Depends on the provider |
| **S3 / MinIO** | Evidence objects (`STORAGE_DRIVER=s3`) | `502 STORAGE_ERROR` on upload and download; metadata unaffected | `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`, `STORAGE_FORCE_PATH_STYLE` | Storage + egress of your provider; MinIO self-hosted is free |

None of these is required to run the network: with `VPN_PROVIDERS=noop`, no `STEAM_WEB_API_KEY` and
`STORAGE_DRIVER=local`, the backend has no third-party dependency at all. Every enrichment provider is
optional by design, because a paid API that is down must never decide whether someone may play.

Shared behaviour of the VPN providers: a per-provider `AbortSignal` timeout
(`VPN_PROVIDER_TIMEOUT_MS`, default 1500 ms), a circuit breaker that opens after 3 consecutive
failures and skips the provider for 60 s, and a result cache in Redis (`VPN_CACHE_TTL_SECONDS`,
default 6 h) that is only written for *successful* lookups, so an outage is retried rather than cached.
With several providers configured, the highest-confidence answer wins and a single failing provider is
simply ignored.

---

## 5. Monitoring: what to alert on

Page someone:

* **`GET /readyz` ≠ 200** for more than a minute — the details say which dependency.
* **`msg: "Redis connection error"`** or a burst of **`event: "server_auth_unavailable"`** — every game
  server is now running on its `backend_unavailable_action`.
* **`error_code: "INTERNAL_ERROR"` rate** above baseline — with a healthy `/readyz` this is a real bug.
* **`status_code: 502` with `STORAGE_ERROR`** — evidence storage is unreachable; reviewers are blocked.
* **A failing scheduled `verify-audit`** (exit code 2 = hash chain broken) — see
  [DEPLOYMENT.md § 8](DEPLOYMENT.md).

Look at it in the morning:

* `msg: "job lock unavailable"` or missing job runs (`server-keys-retire`, `whitelist-requests-expire`,
  `bypasses-expire`, `overwatch-expire-sessions`) — retention and expiry are falling behind.
* `msg: "vpn provider failed"` / `msg: "steam account age lookup failed"` — policy rules on `vpn` or
  `account_age` are silently not firing. A steady trickle usually means an expired key or an exhausted
  quota.
* `msg: "password reset mail could not be sent"` — SMTP is broken; users cannot recover accounts.
* Sustained `RATE_LIMITED`, `INVALID_SIGNATURE`, `REPLAYED_NONCE`, `ACCOUNT_LOCKED` bursts — see
  [SECURITY.md](SECURITY.md).
* Request latency: a `latency_ms` around 5000 on routes that are normally instant is the signature of a
  Redis command timing out.

**Known monitoring gaps** (honest list):

* `/readyz` does **not** check evidence storage. A full disk or a read-only mount is only visible when
  an upload fails with `502`. If you run a storage probe, do it externally (write + read a canary
  object) or watch the `502 STORAGE_ERROR` rate.
* `/readyz` does not check SMTP or the enrichment providers. That is intentional — none of them should
  ever take the node out of the load balancer.
* There is no built-in metrics endpoint (no Prometheus `/metrics`); alerting is log-based, as described
  in [DEPLOYMENT.md § 8](DEPLOYMENT.md).
* Disk usage of the evidence store is not monitored by the application. *(not drilled: full-disk
  behaviour was not tested; an unusable storage root was.)*

---

## 6. Backup and restore

Not duplicated here — see [DEPLOYMENT.md § 7 (Backups)](DEPLOYMENT.md) for what to back up (PostgreSQL
dump or WAL archiving, the evidence store, the secrets, each server's `identity.json`) and the
post-restore checks (`verify-audit`, a `GET /api/v1/evidence/{id}?verify=true` download), and
[DATABASE.md](DATABASE.md) for the schema, the protection triggers and migrations.

Two operational notes that belong here:

* **Redis needs no backup.** It holds only nonces, rate-limit counters, caches, job locks and
  short-lived tokens. AOF is enabled in `docker-compose.prod.yml` so a restart keeps the replay
  window; losing it entirely costs at most a re-login and a brief widening of that window.
* **Restoring the database without the evidence store** leaves rows whose `storage_key` points at
  nothing: metadata and the audit chain verify fine, downloads answer `502`/`404`. Restore both, and
  verify with a `?verify=true` download.

---

## 7. Reproducing these drills

All of it runs game-free on one machine; no SCP:SL server is required.

```bash
# a backend for drills (own database and Redis prefix so nothing else is disturbed)
export DATABASE_URL=postgres://scpsl:scpsl@localhost:5432/scpsl_trust_ops
export REDIS_URL=redis://localhost:6379/13 REDIS_KEY_PREFIX=ops: PORT=3340
# … plus the variables from e2e/run.sh; then: pnpm migrate && pnpm cli:create-admin && pnpm exec tsx src/index.ts

(cd plugin && dotnet build tools/ScpslTrust.DevClient -c Debug)   # DOTNET_ROOT=/opt/dotnet

# 1. backend unreachable — point the DevClient at a dead port
trust-devclient check --identity <dir> --api http://127.0.0.1:3399 --player 76561198000000001@steam
# 2. Redis down
service redis-server stop   # probe /healthz /readyz, a signed check, a login; then start it again
# 3. PostgreSQL down
service postgresql stop     # same probes; /readyz must report database: error
# 4. evidence storage unusable
STORAGE_LOCAL_DIR=<a path whose parent is a regular file> …          # upload → 502 STORAGE_ERROR
# 5. enrichment providers dead
VPN_PROVIDERS=iphub IPHUB_API_KEY=invalid STEAM_WEB_API_KEY=invalid VPN_PROVIDER_TIMEOUT_MS=800 …
```

The regression tests that keep these behaviours honest:

* `backend/tests/core/rate-limit-degradation.test.ts` — a Redis outage must not fail unrelated requests.
* `backend/tests/core/storage.test.ts` — an unusable storage root is `STORAGE_ERROR` (502), not a 500.
* `backend/tests/modules/auth/auth.test.ts` — `/auth/password/forgot` answers `202` even when SMTP is dead.
* `backend/tests/modules/vpn/providers.test.ts` — timeout, breaker and `provider_unavailable`.
* `plugin/tests/ScpslTrust.Core.Tests/Policy/` — `backend_unavailable_action` and the policy cache.
