# SCP:SL Trust Network — Server Registration & Keys

How a game server joins the network, how its key is rotated, and how to recover from
authentication problems. Companion to [PLUGIN.md](PLUGIN.md); the protocol is specified
in [ARCHITECTURE.md](ARCHITECTURE.md) §5.

## 1. How authentication works (short version)

Each game server owns an **Ed25519 key pair, generated on the game server by the
plugin**. The backend knows only the public key. Every API request is signed; the backend
verifies the signature, a ±60 s timestamp, a single-use nonce and a unique request id.

**The private key and the registration procedure never transmit any secret**: the
registration request contains the registration token, the *public* key, a timestamp and a
proof-of-possession signature made with the new private key — nothing else. The private
key is stored only in the plugin's `identity.json` (mode 0600) on the game server.

## 2. Registering a server

1. **Web panel** — a user with the `server:create` permission creates the server
   (name, description). The panel shows a **registration token** `sreg_…` exactly once.
   It expires after **24 hours**, can be used **once**, and is stored only as a hash.
2. **Install the plugin** on the game server (PLUGIN.md §4) and set `api_base_url`.
3. **Server console** (not RA — the token is a secret):

   ```
   trust register sreg_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

   The plugin generates the key pair (kept in `identity.pending.json` until the backend
   accepts, so a lost response can be retried with the same key), sends
   `POST /api/v1/servers/register` and, on success, writes `identity.json` with the
   assigned `server_id` (`srv_…`).

   Alternatively put the token into `config.yml` as `registration_token` before the first
   start; the plugin registers on startup and clears the key from its config. Remove the
   token from any copies afterwards.
4. Verify with `trust status` — it shows the server id, key fingerprint
   (`SHA256:…`, also visible in the web panel under the server's keys) and the result of
   the last heartbeat.

`trust register --force` replaces the identity of an already registered server on
purpose (e.g. after restoring a machine from an image you do not trust anymore); it needs
a fresh registration token.

## 3. Key rotation

Rotation replaces the key pair without downtime. The rotate request is signed with the
**current** key and carries the **new** public key plus a proof of possession by the new
key. The old key stays valid for a grace period (default 10 minutes, `retiring`), then
retires; the plugin switches immediately after the backend confirms.

* **From the game server**: `trust rotatekey` (RA with the admin command permission, or
  server console).
* **From the web panel**: a member with `server:manage` requests a rotation; the backend
  sets `key_rotation_requested` and the plugin rotates automatically on its next
  heartbeat (within `heartbeat_seconds`).
* **Automatic crash-safety**: the candidate key is persisted (`identity.rotating.json`)
  before the request; if the plugin dies mid-rotation it probes on next start which key
  the backend accepted and resolves to the correct one.

Rotate whenever staff with access to `identity.json` backups leave, on suspicion of a
leak, or on a regular schedule.

## 4. Revocation and re-registration

* **Revoke a key** (web panel, `server:manage` on the server, or admins): the key is
  rejected immediately (`KEY_REVOKED`). If another key is active (grace overlap), the
  server keeps working; otherwise it is offline for signed calls.
* **If no active key remains**, generate a **new registration token** in the web panel
  (`POST /servers/{id}/registration-token`, panel: "re-register") and run
  `trust register <token> --force` on the game server. The server keeps its `srv_…` id
  and history.
* **Suspend / revoke a server** (admins): all signed calls answer `SERVER_SUSPENDED` /
  `SERVER_REVOKED`; players are handled per the cached policy's
  `backend_unavailable_action`.

## 5. Troubleshooting authentication errors

Errors appear in the plugin log as `code — message (request id)`. The `GET /api/v1/time`
endpoint (DevClient: `time`) is unsigned and reports the backend clock — use it first.

| Code | Meaning | Fix |
|---|---|---|
| `TIMESTAMP_OUT_OF_RANGE` | Server clock differs from the backend by more than 60 s | Sync the clock (`timedatectl`, `chrony`/`ntpd`). DevClient `time` prints the measured skew. |
| `INVALID_SIGNATURE` | Signature does not verify | Almost always a wrong identity file for this backend (copied from another server / another environment) or a proxy rewriting the request path, query, or body. Do not put rewriting proxies in front of `/api/v1`. Check `trust status` fingerprint against the web panel; if they differ, re-register. |
| `REPLAYED_NONCE` | The same nonce was seen twice | Usually a retrying proxy sending the request twice, or two servers sharing one `identity.json`. Every game server needs its own identity. One-off occurrences after network hiccups are harmless (the plugin retries with a fresh nonce). |
| `DUPLICATE_REQUEST_ID` | Same request id re-sent | Same causes as `REPLAYED_NONCE`. |
| `KEY_REVOKED` | This key was revoked in the web panel | Rotate is impossible with a revoked key: create a new registration token and `trust register <token> --force`. |
| `NO_ACTIVE_KEY` | Server exists but has no usable key (never registered, or all keys retired/revoked) | Register (or re-register) with a fresh token. |
| `UNKNOWN_SERVER` | `X-Server-Id` unknown to this backend | The identity belongs to a different backend/environment — check `api_base_url`, re-register if the server was deleted. |
| `SERVER_SUSPENDED` / `SERVER_REVOKED` | The server was suspended/revoked by admins | Contact the network operators; resolve via the web panel. |
| `MISSING_AUTH_HEADERS` / `INVALID_AUTH_HEADERS` | Headers missing or malformed | A proxy is stripping `X-*` headers. Pass them through unchanged. |
| `RATE_LIMITED` | Too many failed auth attempts | Fix the underlying error first; the limit clears within a minute. |

Registration-specific errors:

| Code | Meaning | Fix |
|---|---|---|
| `REGISTRATION_TOKEN_INVALID` | Token unknown, malformed, already used or expired | Create a fresh token in the web panel (valid 24 h, single use). |
| `PUBLIC_KEY_IN_USE` | The offered public key is already registered | Handled automatically: the plugin generates a fresh key and retries once. Seeing it repeatedly means two servers share an identity directory. |
| `SERVER_ID_MISMATCH` | Body `server_id` differs from the header | Only possible with hand-built clients; fix the request. |

Every error response carries a `request_id` — include it when asking the backend
operators to check their logs.
