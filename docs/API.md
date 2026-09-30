# SCP:SL Trust Network — API Reference

All endpoints live under `/api/v1` (exceptions: `/healthz`, `/readyz`, and the OpenAPI
document at `/api/docs/openapi.json`, Swagger UI at `/api/docs` when `OPENAPI_UI=true`).
Every request and response is JSON (UTF-8) validated by the zod schemas in
`shared/src/schemas/*`; unknown keys are stripped and response schemas prevent leakage of
internal fields. Machine-readable, always-current details (exact request/response shapes)
come from the OpenAPI document; this file is the human overview plus the endpoint tables
generated from it by `backend/scripts/generate-api-docs.ts`.

## 1. Authentication types

| Auth column value | Meaning |
|---|---|
| Public | No credentials. Public POSTs (auth flows, `/servers/register`) work without a session and without CSRF. |
| Session | `stn_session` cookie (signed, HttpOnly). GET only; anonymous → `401 UNAUTHENTICATED`. |
| Session + CSRF | Session cookie **plus** `X-CSRF-Token` header on every non-GET request (`403 CSRF_TOKEN_INVALID` otherwise). The token comes from `GET /auth/session` (`csrf_token`). A present `Origin`/`Referer` must match `WEB_ORIGIN` or the API origin. |
| Signed | Ed25519-signed plugin request (ARCHITECTURE §5.3/§5.4): headers `X-Server-Id`, `X-Timestamp` (ms, ±60 s), `X-Nonce`, `X-Request-Id`, `X-Plugin-Version`, optional `X-Key-Fingerprint`, `X-Signature` over the canonical string `SCPSL-TRUST-V1` + method + path?query + server id + timestamp + nonce + request id + SHA-256 of the raw body. Nonces and request ids are single-use (replay protection). |
| Registration token + PoP | `POST /servers/register` only: a single-use `sreg_…` token plus a proof-of-possession signature by the new key over `SCPSL-TRUST-REG-V1\n{token}\n{public_key}\n{timestamp}` (±300 s). |
| Session or ?ticket= | `GET /evidence/{id}/content`: a session **or** a 60-second single-purpose HMAC ticket from `POST /evidence/{id}/ticket` (media elements send no cookie/CSRF). |

Sessions of staff roles (`REQUIRE_2FA_ROLES`, default reviewer/moderator/admin/super_admin)
that have not enrolled 2FA are limited to `/auth/*` and `GET /me` and receive
`403 MFA_ENROLLMENT_REQUIRED` everywhere else. `POST /cases/{caseNumber}/verdict`
additionally requires the session itself to be MFA-verified.

**Membership vs. global role**: "member owner/admin" in the tables means authorization by
*server-team membership* (`server_members`), whatever the user's global role is — a
`player` who owns a server manages that server. Only `server:create` and the override
permissions (`server:manage_any`, `whitelist:decide_any`, `bypass:manage_global`,
`server:trust`) depend on the global role.

## 2. Conventions

* **Pagination**: unbounded lists take `page` (1-based) and `page_size` (default 25,
  max 100) and return `{ items, page, page_size, total }`. Bounded collections
  (a server's keys/members, own sessions) return `{ items }` only.
* **Timestamps**: ISO-8601 UTC strings (`2026-09-30T11:56:01.262Z`).
* **Player identity**: `{ "type": "steam"|"discord"|"northwood", "id": "…" }`;
  the canonical string form is `id@type` (e.g. `76561198012345678@steam`).
* **Server ids**: public ids look like `srv_0123456789abcdef` and are what web routes take
  as `{id}`; internal UUIDs never leave the backend.
* **Errors** (every non-2xx response):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "request_id": "9d54c4a5-8a2e-4b6e-9c5e-7f1a2b3c4d5e",
    "details": [{ "path": "player.id", "message": "Invalid input" }]
  }
}
```

  The full list of codes with HTTP statuses is `shared/src/errors.ts` (ARCHITECTURE
  §14.1). Frequent ones: `UNAUTHENTICATED` 401, `FORBIDDEN` 403,
  `MFA_ENROLLMENT_REQUIRED` 403, `CSRF_TOKEN_INVALID` 403, `NOT_FOUND` 404,
  `VALIDATION_FAILED` 400, `CONFLICT`/`ALREADY_EXISTS`/`INVALID_STATE` 409,
  `RATE_LIMITED` 429 (with `Retry-After`), `PAYLOAD_TOO_LARGE` 413,
  `UNSUPPORTED_MEDIA_TYPE` 415.
* **Rate limits**: global 300/min per IP (web), 600/min per server (plugin routes),
  auth 10/min per IP, proof 20/min, report creation 10/h per user, server registration
  per IP. Exceeding them returns `429 RATE_LIMITED` with `Retry-After`.

## 3. Endpoint reference

<!-- BEGIN GENERATED ENDPOINT TABLES (backend/scripts/generate-api-docs.ts) -->

### Plugin ⇄ backend (signed)

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| POST | `/api/v1/overwatch/sessions` | Signed | — | Start an Overwatch proof session (signed; secret returned once) |
| POST | `/api/v1/overwatch/sessions/{id}/end` | Signed | own session only | End an Overwatch session (signed) |
| POST | `/api/v1/overwatch/sessions/{id}/heartbeat` | Signed | own session only | Keep an Overwatch session alive (signed) |
| POST | `/api/v1/player/bypass/check` | Signed | — | Check active bypasses for a player (signed) |
| POST | `/api/v1/player/check` | Signed | — | Check a joining player (signed) |
| POST | `/api/v1/player/link` | Signed | — | Link an in-game identity to a web account via a link code |
| POST | `/api/v1/server/reports` | Signed | body ≤ 128 KiB | Submit an in-game report (signed) |
| POST | `/api/v1/servers/heartbeat` | Signed | — | Server heartbeat |
| POST | `/api/v1/servers/keys/rotate` | Signed (active key) + PoP by the new key | — | Rotate the server signing key |
| GET | `/api/v1/servers/policy` | Signed | — | Active policy of the calling server |
| POST | `/api/v1/servers/register` | Registration token + PoP | per-IP registration rate limit | Register a server key (registration token + proof of possession) |
| GET | `/api/v1/time` | Public | — | Server time for clock-skew diagnostics (unsigned) |

### Auth

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| POST | `/api/v1/auth/2fa/disable` | Session + CSRF | forbidden for REQUIRE_2FA_ROLES | Disable TOTP |
| POST | `/api/v1/auth/2fa/enable` | Session + CSRF | revokes other sessions | Enable TOTP (returns recovery codes, shown once) |
| POST | `/api/v1/auth/2fa/recovery-codes` | Session + CSRF | password + current code | Regenerate recovery codes (shown once) |
| POST | `/api/v1/auth/2fa/setup` | Session + CSRF | — | Start TOTP enrollment |
| POST | `/api/v1/auth/login` | Public | auth rate limit; account lockout | Log in with email and password |
| POST | `/api/v1/auth/login/2fa` | Public | single-successful-use mfa_token (5 min) | Complete a login with a TOTP or recovery code |
| POST | `/api/v1/auth/logout` | Session + CSRF | — | Log out |
| POST | `/api/v1/auth/password/change` | Session + CSRF | revokes other sessions | Change the password |
| POST | `/api/v1/auth/password/forgot` | Public | always 202; 1 h single-use token | Request a password reset (always 202) |
| POST | `/api/v1/auth/password/reset` | Public | revokes all sessions | Reset the password with a token |
| POST | `/api/v1/auth/register` | Public | auth rate limit; ALLOW_REGISTRATION | Create an account |
| POST | `/api/v1/auth/resend-verification` | Public | always 202 | Resend the verification mail (always 202) |
| GET | `/api/v1/auth/session` | Session | 401 when anonymous | Current session |
| GET | `/api/v1/auth/sessions` | Session | own sessions | List own sessions |
| POST | `/api/v1/auth/sessions/{id}/revoke` | Session + CSRF | own sessions (foreign → 404) | Revoke one of your sessions |
| POST | `/api/v1/auth/verify-email` | Public | single-use 24 h token | Verify an email address |

### Me

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/me` | Session | usable while 2FA enrollment is pending | Current user profile |
| DELETE | `/api/v1/me/player-link` | Session + CSRF | player:link | Unlink the in-game identity |
| POST | `/api/v1/me/player-link` | Session + CSRF | player:link | Issue an in-game link code |

### Dashboard

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/dashboard` | Session | content scoped by permissions/memberships; null counts elsewhere | Scoped dashboard counts, server status and recent audit events |

### Cases

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/cases` | Session | case staff scope (reviewer+: all; server team: own servers) | List cases (staff; server teams see only their servers) |
| POST | `/api/v1/cases` | Session + CSRF | case:create | Create a case |
| GET | `/api/v1/cases/{caseNumber}` | Session | case staff scope; 403 outside (UI falls back to public view) | Staff case view |
| POST | `/api/v1/cases/{caseNumber}/confirmations` | Session + CSRF | member owner/admin of an active server | Confirm the case for one of your servers |
| DELETE | `/api/v1/cases/{caseNumber}/confirmations/{id}` | Session + CSRF | member owner/admin of the confirming server | Revoke a server confirmation (soft) |
| POST | `/api/v1/cases/{caseNumber}/notes` | Session + CSRF | case:review | Add an internal note |
| POST | `/api/v1/cases/{caseNumber}/reopen` | Session + CSRF | case:reopen | Reopen a closed case |
| POST | `/api/v1/cases/{caseNumber}/reviews/start` | Session + CSRF | case:review | Move an open case to under_review |
| POST | `/api/v1/cases/{caseNumber}/verdict` | Session + CSRF | case:set_verdict + MFA-verified session | Set the case verdict (2FA session required) |
| GET | `/api/v1/public/cases/{caseNumber}` | Public | PUBLIC_CASE_LOOKUP=true | Limited public case view |

### Reports

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/reports` | Session | report:review → all; others own reports | List reports (report:review sees all; others only their own) |
| POST | `/api/v1/reports` | Session + CSRF | report:create + verified email; 10/h per user | Report a player (verified email; 10/h rate limit) |
| GET | `/api/v1/reports/{id}` | Session | report:review or the reporter | Report detail (reviewer or the reporter) |
| POST | `/api/v1/reports/{id}/status` | Session + CSRF | report:review | Change a report status (report:review; note mandatory) |

### Evidence

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| POST | `/api/v1/cases/{caseNumber}/evidence` | Session + CSRF | reviewer+, the reporter, or member of a reporting server | Upload evidence to a case (multipart; streamed, hashed, MIME-sniffed) |
| POST | `/api/v1/cases/{caseNumber}/evidence/link` | Session + CSRF | same upload rule; https URLs only | Attach link evidence to a case (https only; nothing is stored) |
| GET | `/api/v1/evidence` | Session | evidence:view | Evidence review queue (evidence:view; filters status/type/case) |
| GET | `/api/v1/evidence/{id}` | Session | §11.3 access rule; ?verify=true reviewer+ | Evidence metadata, review history and supersede chain (§11.3 access rule) |
| GET | `/api/v1/evidence/{id}/content` | Session or ?ticket= | audited; hardened headers; no CSRF for tickets | Download evidence content (session or ?ticket=; audited; hardened headers) |
| POST | `/api/v1/evidence/{id}/reviews` | Session + CSRF | evidence:review; no self-review | Review evidence: three independent assessments + overall (never the verdict, R2) |
| POST | `/api/v1/evidence/{id}/supersede` | Session + CSRF | upload rule; once per object | Replace evidence with a new object (multipart; the old row is kept and linked) |
| POST | `/api/v1/evidence/{id}/ticket` | Session + CSRF | §11.3 access rule; audited | 60 s download ticket for media elements (same access rule; audited) |

### Players

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/players` | Session | player:view_staff | Search players |
| GET | `/api/v1/players/{userId}` | Public | staff view with player:view_staff session | Public or staff player view |

### Servers

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/servers` | Session | own memberships; all with server:manage_any | List servers (own memberships; all with server:manage_any) |
| POST | `/api/v1/servers` | Session + CSRF | server:create | Create a server (returns the registration token once) |
| GET | `/api/v1/servers/{id}` | Session | member (any role) or server:manage_any | Server detail (§22 view) |
| PATCH | `/api/v1/servers/{id}` | Session + CSRF | member owner/admin or server:manage_any | Update server settings |
| GET | `/api/v1/servers/{id}/keys` | Session | member (any role) or server:manage_any | List server keys (public keys only, never secrets) |
| POST | `/api/v1/servers/{id}/keys/{keyId}/revoke` | Session + CSRF | member owner/admin or server:manage_any | Revoke a server key immediately |
| POST | `/api/v1/servers/{id}/keys/rotation-request` | Session + CSRF | member owner/admin or server:manage_any | Ask the plugin to rotate its key on the next heartbeat |
| GET | `/api/v1/servers/{id}/members` | Session | member (any role) or server:manage_any | List server team members |
| POST | `/api/v1/servers/{id}/members` | Session + CSRF | member owner/admin or server:manage_any | Add a member (existing user by username) |
| DELETE | `/api/v1/servers/{id}/members/{userId}` | Session + CSRF | member owner/admin or server:manage_any; owner not removable | Remove a member (never the owner) |
| POST | `/api/v1/servers/{id}/registration-token` | Session + CSRF | member owner/admin or server:manage_any | Issue a new registration token (revokes the previous unused one) |
| POST | `/api/v1/servers/{id}/status` | Session + CSRF | server:manage_any | Change server status (admin) |
| POST | `/api/v1/servers/{id}/trust` | Session + CSRF | server:trust | Mark a server as trusted / untrusted (admin) |

### Policies

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/servers/{id}/policy` | Session | member (any role) or server:manage_any | Active policy of a server |
| PUT | `/api/v1/servers/{id}/policy` | Session + CSRF | member owner/admin or server:manage_any; base_version → 409 | Save a new policy version |
| GET | `/api/v1/servers/{id}/policy/history` | Session | member (any role) or server:manage_any | Policy version history (newest first) |
| POST | `/api/v1/servers/{id}/policy/preview` | Session + CSRF | member (any role) or server:manage_any; pure | Evaluate a sample player check against a policy (no side effects) |

### Appeals

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/appeals` | Session | appeal:decide → all; others own | List appeals (deciders: all with filters; others: own) |
| POST | `/api/v1/appeals` | Session + CSRF | appeal:create + linked player | Appeal a confirmed/inconclusive case verdict (linked player only) |
| GET | `/api/v1/appeals/{id}` | Session | appeal:decide or the submitter | Appeal detail (decider or submitter) |
| POST | `/api/v1/appeals/{id}/assign` | Session + CSRF | appeal:assign | Assign an appeal to a reviewer |
| POST | `/api/v1/appeals/{id}/decision` | Session + CSRF | appeal:decide; §11.5 independence rule | Decide an appeal (independence rule §11.5) |
| POST | `/api/v1/appeals/{id}/withdraw` | Session + CSRF | submitter | Withdraw an appeal (submitter) |

### Whitelist

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/whitelist-requests` | Session | own + member servers; whitelist:decide_any → all | List whitelist requests (own; server members: their servers; decide_any: all) |
| POST | `/api/v1/whitelist-requests` | Session + CSRF | whitelist:request + linked player | Request a VPN / account-age whitelist for a server |
| GET | `/api/v1/whitelist-requests/{id}` | Session | requester, server member or whitelist:decide_any | Whitelist request detail |
| POST | `/api/v1/whitelist-requests/{id}/decision` | Session + CSRF | member owner/admin/moderator or whitelist:decide_any; no self-decision | Approve or reject a pending whitelist request |
| POST | `/api/v1/whitelist-requests/{id}/revoke` | Session + CSRF | member owner/admin/moderator or whitelist:decide_any | Revoke an approved whitelist request (and its bypass) |

### Bypasses

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| POST | `/api/v1/bypasses/{id}/revoke` | Session + CSRF | server scope: member owner/admin; global scope: bypass:manage_global | Revoke a bypass |
| GET | `/api/v1/servers/{id}/bypasses` | Session | member (any role) or server:manage_any | List a server's bypasses |
| POST | `/api/v1/servers/{id}/bypasses` | Session + CSRF | member owner/admin or server:manage_any | Grant a server-scoped bypass |

### Overwatch (web) & proof

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/evidence/proof` | Public (optional session) | proof rate limit; code required without proof:view_code | Verify an Overwatch proof code (optional auth; strict rate limit) |
| GET | `/api/v1/overwatch/sessions` | Session | overwatch:view | List Overwatch sessions (overwatch:view) |
| GET | `/api/v1/overwatch/sessions/{id}` | Session | overwatch:view; never contains the secret | Overwatch session detail (overwatch:view; no secret, ever) |

### Admin

| Method | Path | Auth | Permission / scope | Description |
|---|---|---|---|---|
| GET | `/api/v1/admin/audit` | Session | audit:view | List audit events |
| GET | `/api/v1/admin/audit/verify` | Session | audit:verify | Verify the audit hash chain |
| GET | `/api/v1/admin/bypasses` | Session | bypass:manage_global | List global bypasses |
| POST | `/api/v1/admin/bypasses` | Session + CSRF | bypass:manage_global | Grant a global bypass |
| GET | `/api/v1/admin/users` | Session | user:view | List user accounts |
| PATCH | `/api/v1/admin/users/{id}` | Session + CSRF | user:manage (admin targets need user:manage_admins); no self-change | Change a user role or status |
<!-- END GENERATED ENDPOINT TABLES -->

## 4. Examples

### 4.1 `POST /api/v1/player/check` (signed)

Information only — the response deliberately contains **no** enforcement action; the
plugin evaluates its local policy (§7) against it.

Request:

```json
{
  "server_id": "srv_0123456789abcdef",
  "player": { "type": "steam", "id": "76561198012345678" },
  "nickname": "PlayerName",
  "ip": "203.0.113.7",
  "account_created_at": "2020-01-15T00:00:00Z"
}
```

Response `200`:

```json
{
  "player": {
    "type": "steam",
    "id": "76561198012345678",
    "user_id": "76561198012345678@steam",
    "first_seen_at": "2026-01-02T18:00:00.000Z"
  },
  "global_status": "confirmed",
  "case_id": "CASE-2026-000123",
  "cases": [
    { "case_id": "CASE-2026-000123", "verdict": "confirmed", "status": "closed", "confirmed_servers": 3 }
  ],
  "reports": 4,
  "open_reports": 0,
  "confirmed_servers": 3,
  "independent_confirmed_servers": 2,
  "account_age": { "days": 2450, "created_at": "2020-01-15T00:00:00.000Z", "source": "steam" },
  "vpn": { "detected": false, "confidence": "not_detected", "type": null, "checked": true },
  "bypass": { "active": false, "types": [], "bypasses": [] },
  "alt_account": { "possible": false, "confidence": "none", "signals": [], "linked_confirmed_cases": [] },
  "policy_version": 4,
  "checked_at": "2026-09-30T12:00:00.000Z"
}
```

Raw IPs are used transiently for VPN/alt analysis and are never stored — only salted
network hashes (§8.1).

### 4.2 `POST /api/v1/player/bypass/check` (signed)

Request: `{ "player": { "type": "steam", "id": "76561198012345678" }, "ip": "203.0.113.7", "types": ["vpn_whitelist"] }`

Response `200`:

```json
{
  "vpn": true,
  "bypass": true,
  "bypass_type": "vpn_whitelist",
  "expires_at": "2026-10-30T12:00:00.000Z",
  "bypasses": [
    { "id": "0e9c1b34-…", "type": "vpn_whitelist", "scope": "server", "expires_at": "2026-10-30T12:00:00.000Z" }
  ]
}
```

Global bypasses are only honored when the server's active policy sets
`honor_global_bypasses`. The winner is the bypass with the latest expiry; `null` expiry
(permanent) wins.

### 4.3 `POST /api/v1/servers/register` (token + PoP)

Request:

```json
{
  "registration_token": "sreg_L2FhY2NvdW50cy9wcm9maWxlL2pzb24vMTIzNDU2Nzg5",
  "public_key": "5oyB6Xw1…44 chars base64…",
  "plugin_version": "1.2.0",
  "game_version": "14.0.1",
  "timestamp": 1790769361262,
  "pop_signature": "…88 chars base64…"
}
```

Response `201`:

```json
{
  "server_id": "srv_0123456789abcdef",
  "key_fingerprint": "SHA256:9f3a…",
  "status": "active",
  "server_time": "2026-09-30T12:00:00.000Z"
}
```

Errors: `TOKEN_INVALID` (unknown/used/expired/revoked token), `TIMESTAMP_OUT_OF_RANGE`
(±300 s), `SIGNATURE_INVALID` (bad PoP), `ALREADY_EXISTS` 409 (server still has an active
key), `SERVER_SUSPENDED`/`SERVER_REVOKED` 403. Registration materializes the default
policy v1 and is audited as `SERVER_REGISTERED`.

### 4.4 `POST /api/v1/servers/keys/rotate` (signed by the ACTIVE key)

Request: `{ "new_public_key": "…", "timestamp": 1790769361262, "pop_signature": "…" }` —
the PoP is signed by the **new** key over
`SCPSL-TRUST-ROT-V1\n{server_id}\n{new_public_key}\n{timestamp}`.

Response `200`:

```json
{
  "key_fingerprint": "SHA256:1b2c…",
  "previous_key_fingerprint": "SHA256:9f3a…",
  "previous_key_retiring_until": "2026-09-30T13:00:00.000Z",
  "server_time": "2026-09-30T12:00:00.000Z"
}
```

The old key keeps verifying until `previous_key_retiring_until` (grace window,
`KEY_ROTATION_GRACE_SECONDS`), then is retired by a background job. A retiring key may
not rotate again (403).

### 4.5 `GET /api/v1/evidence/proof` (public; strict rate limit)

Query: `server_id`, `player_id` (`id@type`), `spectator_id`, `timestamp` (ISO or epoch
ms), and `code` (`XXX-XXX`; optional for `proof:view_code` callers, who get the expected
code back instead).

Response `200` (valid):

```json
{
  "valid": true,
  "server_id": "srv_0123456789abcdef",
  "player_id": "76561198012345678@steam",
  "spectator_id": "76561198087654321@steam",
  "session_id": "7e2f95d4-…",
  "timestamp_window": { "start": "2026-09-30T12:00:00.000Z", "end": "2026-09-30T12:00:30.000Z" },
  "window_offset": 0
}
```

Invalid proofs return `valid: false` with the checked window and **no** oracle about
which part mismatched. Adjacent windows (±1) are accepted and reported via
`window_offset`. Reviewers may receive `reason: "secret_expired"` when retention already
wiped the session secret. Every verification is audited (`PROOF_VERIFIED`).

### 4.6 `POST /api/v1/cases/{caseNumber}/verdict` (session + CSRF; `case:set_verdict`; MFA-verified session)

Request: `{ "verdict": "confirmed", "comment": "Multiple verified clips.", "public_summary": "Aim assistance confirmed." }`

Response `200`: `{ "case_number": "CASE-2026-000123", "status": "closed", "verdict": "confirmed", "updated_at": "…" }`

Rules (§11.2): `confirmed` requires at least one non-superseded evidence object whose
cheating and authenticity assessments are verified (`409 INSUFFICIENT_EVIDENCE`);
reviewers who reported the player are blocked (`409 CONFLICT_OF_INTEREST`); the verdict
closes the case, resolves/rejects open reports, writes a `verdict_set` review entry and a
`VERDICT_CHANGED` audit event with previous/new.

### 4.7 `POST /api/v1/whitelist-requests/{id}/decision` (session + CSRF; member owner/admin/moderator or `whitelist:decide_any`)

Request: `{ "decision": "approve", "days": 30, "note": "Known VPN user, verified identity." }`

* `days` omitted/null on approve = no expiry — allowed only for member owner/admin (or a
  `whitelist:decide_any` overrider).
* Deciding your own request is always forbidden, whatever your roles.

Response `200` (the updated request view):

```json
{
  "id": "b1b2c3d4-…",
  "server_id": "srv_0123456789abcdef",
  "type": "vpn_whitelist",
  "status": "approved",
  "requested_days": 30,
  "decision_note": "Known VPN user, verified identity.",
  "bypass_id": "0e9c1b34-…",
  "expires_at": "2026-10-30T12:00:00.000Z",
  "decided_at": "2026-09-30T12:00:00.000Z"
}
```

Approval creates the matching bypass (`vpn_whitelist` / `account_age_whitelist`) in the
same transaction; rejects create nothing. Revoking an approved request also revokes its
bypass. Pending requests expire after `WHITELIST_REQUEST_TTL_DAYS` (background job).

## 5. Regenerating this document

```bash
cd backend
pnpm exec tsx scripts/generate-api-docs.ts            # builds the app in-process
pnpm exec tsx scripts/generate-api-docs.ts --check    # CI: fail when the tables are stale
```

The script replaces only the generated block in §3 and fails when an endpoint exists
without an entry in its auth table (or vice versa), so the tables cannot silently drift
from the implementation.
