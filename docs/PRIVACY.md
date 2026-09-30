# Privacy and data minimization

The platform exists to share information about cheating across servers. It is built to share as
little personal data as that purpose needs: raw IPs are never stored, signals are not verdicts
(R3–R5), evidence is access-controlled and the public view of a case is deliberately small.
Operators are responsible for their own legal basis, privacy notice and data-subject requests; this
document describes what the software does to support that.

## 1. What is stored

### Players (in-game identities)

| Data | Where | Retention |
|---|---|---|
| Identifier (`steam` / `discord` / `northwood` id), last nickname (≤ 64 chars), first/last seen | `players` | kept (needed for cases) |
| Account creation date + source (`steam`, `server_reported`, `unknown`) | `players` | kept, refreshed after `ACCOUNT_AGE_CACHE_DAYS` |
| Which server saw the player, first/last seen, join count | `player_server_sightings` | kept |
| **Network hashes** (HMAC of the IP / prefix, see §2), per server, first/last seen, count | `player_network_observations` | `RETENTION_NETWORK_OBSERVATIONS_DAYS` (30) |
| Derived signals (`vpn_detected`, `possible_alt_account`, `young_account`) with confidence and reason codes | `player_signals` | `RETENTION_PLAYER_SIGNALS_DAYS` (90) |
| Alt links between two players with the signal type (visible to staff only) | `player_links` | kept |
| Cases, reports (reason, description), reviews, appeals, confirmations | case tables | never deleted (R7) |
| Evidence metadata + files | `evidence`, storage | never deleted automatically (§5) |
| Overwatch sessions (server, target, spectator, times) + encrypted session secret | `overwatch_sessions` | secret wiped after `RETENTION_OVERWATCH_SECRETS_DAYS` (365); row kept |
| Bypasses / whitelist requests (reason, decision) | `bypasses`, `whitelist_requests` | kept |

The plugin sends a player's IP only when `send_ip_for_vpn_check: true` (default) — it is used for the
VPN lookup and the hashes during that request and then dropped. VPN results are cached in Redis under the
network hash for `VPN_CACHE_TTL_SECONDS` (6 h). External VPN providers (`proxycheck`, `iphub`) receive the
IP if you enable them; the Steam Web API receives Steam ids if `STEAM_WEB_API_KEY` is set — mention these
processors in your privacy notice.

### Web accounts

E-mail (lower-case), username, Argon2id password hash, role/status, e-mail verification and login
timestamps, encrypted TOTP secret and hashed recovery codes, optional link to a player identity
(`DELETE /me/player-link` removes it). Sessions store the SHA-256 of the cookie token, a truncated user agent and
a network hash — no raw IP. Sessions that expired or were revoked, and used/expired e-mail and reset tokens,
are deleted `RETENTION_SESSIONS_DAYS` (30) after they ended (hourly job `auth-sessions-retention`).

### Audit log and logs

Audit events contain actor, action, target and small metadata — never passwords, tokens, keys, raw IPs or
evidence content; failed logins for unknown e-mail addresses are recorded without the address. Application
logs never contain request bodies; client IPs are not logged unless `LOG_CLIENT_IP=true`, and then only as
a network hash.

## 2. Network hashes instead of IPs

```
network_hash = HMAC-SHA256(IP_HASH_SECRET, "net:v1:" + IPv4 address | IPv6 /64 prefix)
prefix_hash  = HMAC-SHA256(IP_HASH_SECRET, "pfx:v1:" + IPv4 /24     | IPv6 /48 prefix)
```

Database columns only accept 64-hex hashes, so an IP cannot be stored by mistake. Hashes are used only to
compute alt-account *signals* within `ALT_LOOKBACK_DAYS` (30): a shared network is never treated as the
same person (R5), IP-only matches are capped at `medium`, VPN/hosting networks at `low`. Servers never
receive linked identities or hashes — only `possible`, a confidence, reason codes and case numbers of
linked **confirmed** cases. Staff see linked players in the panel, never IPs.

Limits: the hash is pseudonymous, not anonymous. With `IP_HASH_SECRET` the IPv4 space can be enumerated;
keep the secret as protected as the database backups ([SECURITY.md §3](./SECURITY.md#3-what-is-not-protected)).

## 3. Retention settings

Executed by the in-process `retention` jobs (`JOBS_ENABLED=true`, see [DATABASE.md §4](./DATABASE.md#4-retention)):

| Variable | Default | Effect |
|---|---|---|
| `RETENTION_NETWORK_OBSERVATIONS_DAYS` | 30 | delete network observations not seen for this long |
| `RETENTION_PLAYER_SIGNALS_DAYS` | 90 | delete derived signals older than this |
| `RETENTION_SESSIONS_DAYS` | 30 | delete sessions/tokens that expired, were revoked or were used more than this long ago |
| `RETENTION_OVERWATCH_SECRETS_DAYS` | 365 | wipe Overwatch session secrets (proofs become unverifiable, the session row stays) |
| `VPN_CACHE_TTL_SECONDS` | 21600 | Redis TTL of cached VPN results |
| `ALT_LOOKBACK_DAYS` | 30 | how far back alt analysis looks (≤ network retention is sensible) |

The network-observation/signal run is audited (`RETENTION_RUN`, counters only). Case history, evidence metadata and audit events are
not subject to retention (R7, R8).

## 4. Evidence access control

* Metadata and files: `evidence:view` (reviewer and above), the uploading user, and members of the uploading
  server — nobody else, not even other servers that report on the same case.
* Every download (and every download ticket) is audited as `EVIDENCE_ACCESSED`; tickets expire after 60 s.
* Files are served as attachments with a sandbox CSP and `Cache-Control: private, no-store`.
* Storage buckets must be private ([DEPLOYMENT.md §6](./DEPLOYMENT.md#6-evidence-storage)).
* The public case view shows only evidence *counts*.

## 5. Public case information

`GET /api/v1/public/cases/{caseNumber}` (anonymous; disable with `PUBLIC_CASE_LOOKUP=false`) returns only:
case number, player identifier and last nickname, status, verdict, the reviewer-written `public_summary`
(≤ 500 chars; the internal `reason` is never public), verdict time, counts of reports, evidence, verified
evidence and confirming servers, the latest appeal status, and optionally a timeline of selected events
(report created, evidence uploaded/verified, verdict changed, appeal created/resolved) in which reviewers
appear only as pseudonyms (`Reviewer #184`). No reporter identities, evidence, comments, servers' identities,
signals or network data. The public player view (`GET /players/{userId}`) likewise shows identifier,
nickname, first-seen time, global status and the public fields of the player's cases. Public lookups are not
audited (so the audit log does not become a record of who looked whom up).

VPN use, account age and alt signals are **never** shown publicly and never become verdicts (R3–R5).

## 6. IP_HASH_SECRET rotation

Rotating `IP_HASH_SECRET` makes every stored network hash (observations, session hashes) uncorrelatable
with new ones: alt-account signals start from zero, and cached VPN results are no longer found. This is
equivalent to purging all network data at once and is a legitimate privacy measure (e.g. after a suspected
leak of the secret). Consequences: alt detection is blind until new observations accumulate; existing
`player_links` and signals remain until their own retention. Procedure: set the new secret, restart the
backend; optionally delete old observations immediately by temporarily lowering
`RETENTION_NETWORK_OBSERVATIONS_DAYS`. Keep the secret in your backups otherwise — losing it has the same effect.

## 7. Deletion requests and legal hold

The software deliberately has **no API that deletes case history or evidence** (R7): history tables are
protected by triggers and deletions would destroy the audit trail of verdicts that affect players. What is
possible:

* **Automatic minimization**: §3 retention for network data, signals and Overwatch secrets.
* **Account-level**: a user can unlink their player identity (`DELETE /me/player-link`); admins can disable
  accounts (`PATCH /admin/users/{id}`, audited).
* **Verdict corrections** go through appeals or `POST /cases/{caseNumber}/reopen` — changes are new history
  entries, not edits.
* **Evidence file removal (manual, legal-hold-aware procedure)** — for a court order, a legal obligation or
  illegal content:
  1. Check that no legal hold, pending appeal or open case requires the file; document the legal basis.
  2. Record the decision on the case (`POST /cases/{caseNumber}/notes`, audited as `CASE_NOTE_ADDED`) with a
     reference to the request — never the removed content itself.
  3. An operator with storage access removes the object at the evidence's `storage_key` (local file under
     `STORAGE_LOCAL_DIR`, or the S3 object and its versions — object lock must allow it). The database row,
     its SHA-256 and the review history stay, so the removal is visible and the hash still identifies the file.
  4. Consider superseding the evidence (`POST /evidence/{id}/supersede`) with a redacted version, and review
     whether the verdict still has sufficient evidence.
* **Legal hold**: because nothing in the case history is deleted automatically, a hold only concerns the
  retention-limited data of §3 and evidence files. To preserve them, raise the relevant `RETENTION_*` values
  (or set `JOBS_ENABLED=false` temporarily, which also stops the expiry jobs) and take a database/storage
  backup; do not remove files under the procedure above while a hold is active.

Requests about data that the software keeps by design (cases, reports, audit events) need a decision by the
operator under the applicable law; the database roles in [DATABASE.md §1.1](./DATABASE.md#11-roles-and-database)
intentionally prevent the application itself from deleting it.
