# SCP:SL Trust Network — Server Plugin

The plugin connects an SCP:SL dedicated server to the trust network backend. It checks
joining players, enforces the **server's own** policy locally (the backend never dictates
an action), forwards in-game reports, and runs Overwatch proof sessions. It is built on
the official **LabAPI** (1.1.7) — Exiled is not used and not required.

Related documents: [ARCHITECTURE.md](ARCHITECTURE.md) (§5–§7, §10, §17 are the binding
contract), [SERVER_REGISTRATION.md](SERVER_REGISTRATION.md) (registration, key rotation,
troubleshooting).

## 1. Components

| Project | Target | Purpose |
|---|---|---|
| `plugin/src/ScpslTrust.Core` | netstandard2.0 | Signing, key storage, API client, policy engine, proof codes — no game references, fully unit-tested |
| `plugin/src/ScpslTrust.Plugin` | net48 | LabAPI entry point: events, enforcement, commands, hints, coroutines |
| `plugin/tests/ScpslTrust.Core.Tests` | net8.0 | xUnit tests incl. the shared test vectors (`shared/test-vectors/`) |
| `plugin/tools/ScpslTrust.DevClient` | net8.0 | Command-line client for end-to-end tests against a real backend |

## 2. Requirements

* SCP:SL dedicated server with LabAPI ≥ 1.1.7 (ships with the game).
* Outbound HTTPS to the backend. Plain `http://` is accepted only for loopback addresses.
* A server entry in the web panel and a registration token (see SERVER_REGISTRATION.md).
* To build: .NET SDK 8 and the game's managed assemblies (`plugin/lib/README.md`).

## 3. Building

```sh
cd plugin
dotnet build ScpslTrust.sln -c Release -p:SCPSL_MANAGED_DIR=/path/to/server/SCPSL_Data/Managed
dotnet test        # Core tests; runs without game assemblies (plugin project is Release-only)
```

The build stages exactly the files to deploy under `plugin/dist/`:

```
dist/plugins/ScpslTrust.Plugin.dll        → LabAPI plugins folder
dist/dependencies/ScpslTrust.Core.dll     → LabAPI dependencies folder
```

Nothing else is deployed. `BouncyCastle.Cryptography` and `System.Text.Json` are
referenced with `Private=false`/no runtime assets because the game ships both — deploying
second copies would cause assembly-load conflicts.

## 4. Installation

LabAPI's folder root (verified against the LabAPI 1.1.7 loader) is:

* Linux: `~/.config/SCP Secret Laboratory/LabAPI/`
* Windows: `%AppData%\SCP Secret Laboratory\LabAPI\`
* With `hoster_policy.txt` containing `gamedir_for_configs: true`: `<game dir>/AppData/SCP Secret Laboratory/LabAPI/`

Inside it the loader reads (defaults from `LabApi-<port>.yml`: `plugin_paths` and
`dependency_paths` are `[global, $port]`):

```
LabAPI/
  plugins/<port>/        or  plugins/global/        ← ScpslTrust.Plugin.dll
  dependencies/<port>/   or  dependencies/global/   ← ScpslTrust.Core.dll
  configs/<port>/ScpslTrust/                        ← created on first start:
      config.yml            plugin configuration (below)
      identity.json         server identity — SECRET, back it up (mode 0600)
      policy-cache.json     last successfully fetched remote policy
```

Use the `<port>` folders to scope the plugin to one server instance, `global` for all
instances. The config directory is always per-port. Steps:

1. Copy `dist/plugins/ScpslTrust.Plugin.dll` to `LabAPI/plugins/<port or global>/`.
2. Copy `dist/dependencies/ScpslTrust.Core.dll` to `LabAPI/dependencies/<port or global>/`.
3. Start the server once; edit `configs/<port>/ScpslTrust/config.yml` (`api_base_url` at minimum).
4. Register (SERVER_REGISTRATION.md): server console → `trust register <token>`.

Verified on a real dedicated server (game 14.2.7, LabAPI loader, Linux): the first start
creates `LabAPI/LabApi-<port>.yml`, `plugins/{global,<port>}/`, `dependencies/{global,<port>}/`,
`configs/permissions.yml` and, once the plugin is loaded, `configs/<port>/ScpslTrust/config.yml`
(plus LabAPI's `properties.yml`). Expected log lines:

```
[LabApi] [LOADER] Successfully loaded ScpslTrust.Core, Version=1.0.0.0, …
[LabApi] [LOADER] Successfully enabled 'ScpslTrust', Version: 1.0.0, Author: 'SCP:SL Trust Network'
[ScpslTrust.Plugin] Registered as srv_… with key SHA256:… (status active).
[ScpslTrust.Plugin] Policy version 1 loaded (4 rules).
```

LabAPI then prints "This server has been flagged as transparently modded …" — that is the
game's normal notice for any installed plugin, not an error. For an unattended first start,
`LocalAdmin <port> --acceptEULA --useDefault` skips the interactive questions; server console
commands (`trust status`, `trust register …`) are typed into LocalAdmin's stdin.

### Troubleshooting: `CLIENT_NETWORK_ERROR … An address incompatible with the requested protocol was used`

The game's Mono runtime `HttpClient` always opens an IPv6 dual-mode socket, even for IPv4
backends such as `http://127.0.0.1:…`. On a host whose kernel has **no IPv6 support at all**
(`ipv6.disable=1`, some minimal VMs/containers — `/proc/net/if_inet6` is missing) every request
fails with this error, and so do the game's own central-server requests. Enable IPv6 in the
kernel/container (an IPv6 address or route is not needed, only the address family). The plugin
appends a hint to the error when it detects this case.

## 5. Configuration reference (`config.yml`)

LabAPI serializes the config with snake_case keys. Defaults shown.

```yaml
# Backend origin, e.g. https://trust.example.org — https required (http only for localhost).
api_base_url: ''
# Per-request timeout, 1–60 s.
request_timeout_seconds: 5
# One-shot registration on first start; the plugin clears this key after use.
registration_token: ''
# remote: fetch the policy from the backend (cached on disk). local: use local_policy below.
policy_source: remote
# How often the remote policy is refreshed (min 30 s). Heartbeats also trigger a refetch
# when the backend reports a new policy_version.
policy_refresh_seconds: 300
# Check players when they join and enforce the policy result.
check_on_join: true
# Send the joining player's IP so the backend can run VPN detection. The backend stores
# only a keyed hash, never the raw IP; the plugin never logs full IPs.
send_ip_for_vpn_check: true
# Send an (untrusted) account-created-at hint if the game exposes one.
send_account_age_hint: false
# Forward in-game cheater/player reports to the backend.
forward_ingame_reports: true
# Heartbeat interval, 15–3600 s. Heartbeats deliver policy_version and key-rotation requests.
heartbeat_seconds: 60
staff_notifications:
  enabled: true      # notify online staff on admin_notify/require_review/enforcement
  use_hints: true    # on-screen hint to staff with RemoteAdminAccess
  use_console: true  # message into the RA console
overwatch_proof:
  enabled: true
  auto_start_on_spectate: true   # start a session when a staff spectator switches target
  only_in_overwatch: true        # require the spectator to be in Overwatch mode
  required_permission: RemoteAdminAccess   # PlayerPermissions name required to run sessions
  hint_vertical_offset: -10      # vertical offset of the proof-code hint (-50..50)
command_permissions:
  admin: ServerConsoleCommands   # PlayerPermissions for rotatekey / policy reload via RA
  staff: PlayersManagement       # PlayerPermissions for check / status / proof / policy show
# Same schema as the web policy editor (§7.1); used when policy_source: local.
local_policy: { ... }
# Cap for policy bans in minutes; 0 = no cap (a ban rule without duration is permanent).
max_ban_duration_minutes: 0
# Verbose plugin logging (never logs key material or full IPs).
debug: false
```

Invalid values are reported at startup and replaced by safe defaults; an invalid or
missing `api_base_url` leaves the plugin idle (players are treated per
`backend_unavailable_action` of the active policy only when a check was actually
attempted — without any backend configured nothing is enforced).

`api_base_url` may carry a path prefix (e.g. `https://example.org/trust`). The signature covers the
**full request path** (prefix + `/api/v1/…` + query string, ARCHITECTURE §5.3), so a reverse proxy in
front of the backend must forward the prefix unchanged — a proxy that strips `/trust` before
forwarding makes every signed request fail with `401 INVALID_SIGNATURE`. Serve the backend under
the same prefix, or use an origin without a prefix.

## 6. Commands

RA = remote admin console, SC = server console. Permissions are LabAPI/game
`PlayerPermissions` names, configurable via `command_permissions`.

| Command | Where | Permission | Purpose |
|---|---|---|---|
| `trust register <sreg_…> [--force]` | SC only | — | Register this server (token from the web panel) |
| `trust status` | RA/SC | staff | Identity, backend reachability, policy version, last heartbeat |
| `trust rotatekey` | RA/SC | admin | Rotate the Ed25519 key (also runs automatically when the web panel requests it) |
| `trust check <player>` | RA/SC | staff | On-demand check of an online player (or an id like `76561198…@steam`) |
| `trust proof start <player>` | RA/SC | staff + `overwatch_proof.required_permission` | Start an Overwatch proof session manually |
| `trust proof stop` | RA/SC | staff + required_permission | End the caller's session |
| `trust proof list` | RA/SC | staff | List active sessions |
| `trust policy [show\|reload]` | RA/SC | staff (show) / admin (reload) | Show the active policy / force a refetch |
| `.trustlink LNK-XXXXXX` | player console | — | Link the in-game identity to a web account (code from the profile page, valid 10 min) |

`trust register` is deliberately restricted to the server console: registration tokens
are secrets and RA traffic involves more parties.

## 7. Policy examples

Policies are edited in the web panel (or `local_policy`). Rules evaluate in array order;
the **highest-severity** matching action wins (§7.2). Examples:

```jsonc
// Kick accounts younger than 7 days (unknown age is NOT matched):
{ "signal": "account_age", "action": "kick", "max_account_age_days": 7,
  "match_unknown_age": false, "message": "Your account must be at least 7 days old." }

// VPN users must request a whitelist first (kick with explanatory message):
{ "signal": "vpn", "action": "require_whitelist", "min_vpn_confidence": "likely" }

// Soft mode: only notify staff about confirmed cheaters …
{ "signal": "global_verdict", "action": "admin_notify", "statuses": ["confirmed"] }

// … or hard mode: ban confirmed cheaters for 30 days when at least two servers confirmed:
{ "signal": "global_verdict", "action": "ban", "statuses": ["confirmed"],
  "min_confirmed_servers": 2, "ban_duration_minutes": 43200 }

// Possible alt accounts of confirmed cheaters → put the join on staff's radar:
{ "signal": "alt_account", "action": "admin_notify", "min_alt_confidence": "medium",
  "require_linked_confirmed_case": true }
```

Enforcement (§7.3): `allow` nothing; `admin_notify` staff hint/RA console;
`warn` message to the player; `require_review` player stays, staff are notified
persistently for the round; `require_whitelist` kick with the whitelist URL;
`kick` kick; `ban` local ban (duration capped by `max_ban_duration_minutes`).
Active bypasses (VPN whitelist, verdict override, …) suppress matching rules. If the
backend is unreachable, the cached policy's `backend_unavailable_action`
(`allow` | `admin_notify` | `kick`) applies.

## 8. Overwatch proof codes

With `overwatch_proof.enabled`, a staff member in Overwatch who spectates a player gets a
short code (`XXX-XXX`) as an on-screen hint, refreshed every second and rotating every
`interval_seconds` (backend-controlled, default 10 s):

```
PROOF 7K4-X92 · 15:42:20 UTC · srv_7k4x… · #a1b2c3d4
```

Recording the screen therefore proves *when* and *on which server* the footage was made
(HMAC of a server-held secret; see §10.2). Anyone can verify a code on the website
without an account; the expected code is never revealed to non-reviewers. A valid proof
authenticates the session — it never changes a verdict by itself.

## 9. Security notes

* **The private key never leaves the server.** Registration and rotation send only the
  public key plus a proof-of-possession signature. Nothing secret is ever transmitted.
* `identity.json` is written atomically (temp file + rename) with mode 0600 where the OS
  supports it. **Back it up** — without it the server must re-register with a new token.
  Treat backups like a password.
* During rotation the previous key is kept in `identity.previous.json` until the first
  successful request with the new key; an interrupted rotation is resolved automatically
  on the next start (`identity.rotating.json`).
* The plugin never logs key material, signatures, registration tokens, session secrets
  or full IP addresses (IPs are truncated in logs).
* All requests are signed (Ed25519 over method, path+query, timestamp, nonce, request id
  and body hash — §5.3) and pinned to TLS origins; redirects are not followed.
* Keep the server clock NTP-synced; signatures are valid for ±60 s
  (`TIMESTAMP_OUT_OF_RANGE` otherwise — see SERVER_REGISTRATION.md §Troubleshooting).

## 10. DevClient (end-to-end testing)

`plugin/tools/ScpslTrust.DevClient` exercises the exact Core code the plugin uses,
against a real backend, without a game server. stdout is JSON; logs go to stderr.

```sh
cd plugin && dotnet build tools/ScpslTrust.DevClient -c Release
alias devclient='dotnet tools/ScpslTrust.DevClient/bin/Release/net8.0/trust-devclient.dll'

devclient init                                    # create a key pair (identity.pending.json)
devclient register --api https://localhost:8443 --insecure --token sreg_…
devclient time --api …                            # backend time + measured clock skew
devclient heartbeat --api … --players 5
devclient check   --api … --player 76561198000000001@steam --ip 203.0.113.4
devclient bypass  --api … --player 76561198000000001@steam --types vpn_whitelist
devclient link    --api … --player 76561198000000001@steam --code LNK-7K4X92
devclient report  --api … --player 76561198000000001@steam --reason "aimbot" --description "…"
devclient policy  --api …
devclient overwatch --api … --target 7656…@steam --spectator 7656…@steam --seconds 60
devclient rotate  --api …
```

Common options: `--identity <dir>` (default `$TRUST_IDENTITY_DIR` or `./trust-identity`),
`--api <url>` (default `$TRUST_API`), `--timeout <s>`, `--insecure` (allow http for
non-loopback — development only), `--debug`. Exit codes: 0 ok, 1 usage/local error,
2 API error (error JSON on stderr, shape `{ "error": { "code", "message", "status", "request_id" } }`).

`overwatch` starts a session, prints the proof code of every window (plus the overlay
line), sends heartbeats and ends the session — the printed codes can be verified against
`GET /api/v1/evidence/proof`.

## 11. Tests

`plugin/tests/ScpslTrust.Core.Tests` (net8.0, xUnit, 468 tests) verifies the C# port
byte-for-byte against the shared vectors in `shared/test-vectors/` (signing, proof codes,
all policy-engine cases) and covers key storage (atomicity, no secrets in errors), the
API client with a fake HTTP handler (headers, signature verification over what was
actually sent, error parsing, timeouts), the Overwatch session manager and config
validation. Run with `cd plugin && dotnet test`.
