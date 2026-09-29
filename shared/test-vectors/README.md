# Cross-language test vectors

Fixtures that pin down every algorithm implemented both in TypeScript (`@scpsl-trust/shared`)
and in C# (`ScpslTrust.Core`). Both test suites MUST load these files and reproduce them
byte-for-byte. The files are generated — never edit them by hand:

```bash
cd shared
pnpm exec tsx scripts/generate-test-vectors.ts          # regenerate
pnpm exec tsx scripts/generate-test-vectors.ts --check  # exit 1 if a committed file is stale
```

The generator cross-checks everything before writing (independent re-implementations,
self-verification of every signature, hand-written policy expectations), so a regenerated file
is either consistent or not written at all.

General conventions:

* Files are UTF-8 JSON with **snake_case** keys; enum values are lowercase snake_case.
* Strings are text; where exact bytes matter a `*_base64` / `*_hex` twin is provided.
* All keys/seeds in these files are **TEST ONLY** and must never be used on a real server.

| File | Algorithm | Spec |
|---|---|---|
| `signing.json` | Ed25519 request signing, registration / rotation proof of possession | ARCHITECTURE §5 |
| `proof-codes.json` | Overwatch proof codes (HMAC-SHA256 → Crockford base32) | ARCHITECTURE §10.2 |
| `policy.json` | Local policy engine | ARCHITECTURE §7.2 |
| `audit-chain.json` | Canonical JSON + audit hash chain (backend only) | ARCHITECTURE §9.1 |

---

## `signing.json`

```jsonc
{
  "version": "SCPSL-TRUST-V1",
  "rfc8032_test_1": { "seed_hex", "public_key_hex", "message_hex", "signature_hex" },
  "key":          { "seed_hex", "public_key_hex", "public_key_b64", "fingerprint" },  // seed = bytes 0x00..0x1f
  "rotation_key": { ... },                                                         // seed = bytes 0x20..0x3f
  "requests":  [ SignedRequest ],        // must verify
  "negative":  [ NegativeRequest ],      // must NOT verify
  "registration_pop": { ... },
  "rotation_pop": { ... },
  "pop_negative": [ ... ]                // must NOT verify
}
```

### Keys

* `seed_hex` — the 32-byte Ed25519 private seed. BouncyCastle: `new Ed25519PrivateKeyParameters(seed, 0)`.
* `public_key_hex` / `public_key_b64` — the 32 raw public-key bytes; wire encoding is
  **standard, padded base64** (44 chars). BouncyCastle: `privateKey.GeneratePublicKey().GetEncoded()`.
* `fingerprint` — `"SHA256:" + lowercase_hex(SHA-256(32 raw public-key bytes))`.
* `rfc8032_test_1` — RFC 8032 §7.1 TEST 1 (empty message) to validate the Ed25519 binding itself.

Node's `crypto` has no raw Ed25519 import; the TS side wraps the raw bytes in fixed DER prefixes
(see `scripts/vectors/node-crypto.ts`): PKCS#8 `302e020100300506032b657004220420 || seed`,
SPKI `302a300506032b6570032100 || public_key`.

### `requests[]` — `SignedRequest`

| field | meaning |
|---|---|
| `name`, `description` | identification |
| `method` | as given by the caller (may be lower case, e.g. `put`) |
| `path_with_query` | path + query exactly as sent (percent-encoding preserved, not reordered) |
| `server_id` | `X-Server-Id` |
| `timestamp` | `X-Timestamp` — unix **milliseconds** as a decimal string |
| `nonce` | `X-Nonce` — 24 chars base64url (18 bytes) |
| `request_id` | `X-Request-Id` — UUID v4 |
| `body` | raw request body as text (`""` = no body) |
| `body_base64` | the exact body bytes (= UTF-8 of `body`) |
| `body_sha256_hex` | lowercase hex SHA-256 of the body bytes (empty body → `e3b0c442…b855`) |
| `canonical` | the canonical string (below) |
| `signature_b64` | base64 Ed25519 signature of `UTF-8(canonical)` with `key` |
| `headers` | every header the plugin sends (`X-Key-Fingerprint` is optional and omitted in one vector) |

Canonical string (`\n` separators, **no trailing newline**):

```
SCPSL-TRUST-V1
<METHOD upper-cased>
<path_with_query>
<server_id>
<timestamp>
<nonce>
<request_id>
<body_sha256_hex>
```

Test procedure: decode `body_base64`, hash it, build the canonical string from the fields, compare
with `canonical`, verify `signature_b64` with `key.public_key_b64`, and re-sign with
`key.seed_hex` — Ed25519 is deterministic, so the signature must be identical.

Notable vectors: `get_policy_with_query` (encoded query), `post_server_report_unicode` (umlauts,
CJK, emoji — hash over UTF-8 bytes), `post_heartbeat_pretty_body` (whitespace/newlines are part of
the hashed bytes: never re-serialize before hashing), `post_overwatch_heartbeat_empty_body`,
`put_lowercase_method`, `post_key_rotate` (its body is `rotation_pop.request_body`).

### `negative[]` — `NegativeRequest`

Same fields as a signed request plus `based_on` (the original vector), `public_key_b64` (the key
to verify with) and `expected_valid: false`. `canonical` is the canonical string of the
**tampered** request; `signature_b64` is the original signature (or a wrong/bit-flipped one).
Verification MUST fail. Covered: tampered body (value, whitespace, removed), path, query
(value, order, percent-decoding), timestamp, nonce, request id, method, server id, empty body
replaced, wrong key, flipped signature bit.

### Proof of possession

* `registration_pop`: `message = "SCPSL-TRUST-REGISTER-V1\n" + registration_token + "\n" + public_key_b64 + "\n" + timestamp`,
  signed by the key being registered (`key`). `timestamp` is a JSON number (unix ms);
  `request_body` is a complete `POST /api/v1/servers/register` body.
* `rotation_pop`: `message = "SCPSL-TRUST-ROTATE-V1\n" + server_id + "\n" + new_public_key_b64 + "\n" + timestamp`,
  signed by the **new** key (`rotation_key`); `request_body` is the `POST /api/v1/servers/keys/rotate` body.
* `pop_negative[]`: `{ name, description, message, signature_b64, public_key_b64, expected_valid: false }` —
  other token, other timestamp, rotation signed by the old key, rotation replayed for another server.

---

## `proof-codes.json`

```jsonc
{ "version": "SCPSL-TRUST-PROOF-V1", "alphabet": "0123456789ABCDEFGHJKMNPQRSTVWXYZ", "cases": [ ProofCase ] }
```

| field | meaning |
|---|---|
| `secret_b64` / `secret_hex` | 32-byte session secret (as returned by `POST /overwatch/sessions`) |
| `session_id`, `server_id` | session UUID, `srv_…` |
| `target_user_id`, `spectator_user_id` | canonical `<id>@<type>` |
| `unix_seconds`, `interval_seconds` | inputs |
| `window` | `floor(unix_seconds / interval_seconds)` |
| `message` | `"SCPSL-TRUST-PROOF-V1|" + session_id + "|" + server_id + "|" + target_user_id + "|" + spectator_user_id + "|" + window` |
| `mac_hex` | `HMAC-SHA256(key = secret, UTF-8(message))` |
| `code` | see below |

Code: `v = (mac[0] << 24 | mac[1] << 16 | mac[2] << 8 | mac[3]) >>> 2` (unsigned 32-bit, i.e. the top
30 bits); take six 5-bit groups from the most significant end (`(v >> 25) & 31`, `(v >> 20) & 31`, …,
`v & 31`), map through `alphabet` and insert a dash after the third character (`XXX-XXX`).
Cases cover intervals 5/10/30/60, exact window boundaries (`t = k·interval`, `t = k·interval − 1`),
all-zero / all-0xff secrets, other session / server / secret, swapped target/spectator, discord and
northwood ids, `t = 0` and year 2100.

The proof API accepts windows `w−1`, `w`, `w+1` (clock drift); that logic is backend-only.

---

## `policy.json`

```jsonc
{ "version": "1", "cases": [ PolicyCase ] }
```

| field | meaning |
|---|---|
| `name`, `description` | identification |
| `schema_valid` | `false` when the policy intentionally contains a rule with an unknown `signal` or `action` (forward compatibility) |
| `policy` | a `ServerPolicy` (§7.1): `version`, `backend_unavailable_action`, `notify_on_enforcement`, `honor_global_bypasses`, `whitelist_url`, `rules[]` |
| `input` | engine input — the subset of the `/player/check` response the engine reads: `global_status`, `case_id`, `confirmed_servers`, `open_reports`, `account_age.days`, `vpn.confidence`, `alt_account.{possible,confidence,linked_confirmed_cases}`, `bypass.types` |
| `context` | `{ "server_name"?: string }` for the `{server_name}` placeholder |
| `expected` | `{ action, applied_rule_ids, bypassed_rule_ids, notify_admins, message, ban_duration_minutes }` |
| `expected_decision` | the complete decision: `{ action, applied: [Outcome], bypassed: [Outcome], notify_admins, message, ban_duration_minutes }` with `Outcome = { rule_id, signal, action, reason_code }` |

Rules carry `id`, `enabled`, `signal`, `action`, `message`, `ban_duration_minutes` and only the
condition fields of their signal:

| signal | condition fields | matches when | reason_code |
|---|---|---|---|
| `global_verdict` | `statuses[]`, `min_confirmed_servers` (nullable) | `global_status ∈ statuses` and (`min` null or `confirmed_servers ≥ min`) | `global_verdict_match` |
| `account_age` | `max_account_age_days`, `match_unknown_age` | `days != null && days < max`, or `days == null && match_unknown_age` | `account_age_below_threshold` / `account_age_unknown` |
| `vpn` | `min_vpn_confidence` | `rank(vpn.confidence) ≥ rank(min)` with `not_detected < possible < likely < confirmed` | `vpn_confidence` |
| `alt_account` | `min_alt_confidence`, `require_linked_confirmed_case` | `possible && rank(confidence) ≥ rank(min)` (`none < low < medium < high`) and (`!require` or `linked_confirmed_cases` non-empty) | `alt_account_confidence` |
| `open_reports` | `min_open_reports` | `open_reports ≥ min` | `open_reports_threshold` |

Evaluation (identical in TS and C#):

1. Walk `rules` in array order. Skip rules with `enabled != true` and rules whose `signal` **or**
   `action` is unknown. Test the condition.
2. A matching rule is **bypassed** if `input.bypass.types` contains its exempt type
   (`vpn→vpn_whitelist`, `account_age→account_age_whitelist`, `alt_account→alt_account_whitelist`,
   `global_verdict→verdict_override`, `open_reports→verdict_override`), otherwise **applied**.
   Only matching rules appear in either list; order is rule order.
3. `action` = most severe applied action: `allow 0 < admin_notify 1 < warn 2 < require_review 3 <
   require_whitelist 4 < kick 5 < ban 6`; `allow` when nothing is applied.
4. `message`: take the **first applied rule whose action equals the winning action**; if its
   `message` is null or `""`, use the default text of the action (below). `allow` has no default
   (`null`). Then substitute placeholders in a **single pass**: `{case_id}` → `input.case_id` or `""`,
   `{days}` → decimal `account_age.days` or `""`, `{whitelist_url}` → `policy.whitelist_url` or `""`,
   `{server_name}` → `context.server_name` or `""`. Substituted values are not re-scanned; unknown,
   differently cased or spaced placeholders (`{unknown}`, `{CASE_ID}`, `{ days }`) stay literally.
5. `notify_admins` = any applied rule with action `admin_notify` or `require_review`, or
   (`notify_on_enforcement` and severity(action) ≥ severity(`warn`)). Bypassed rules never notify.
6. `ban_duration_minutes` = when `action` is `ban`: `ban_duration_minutes` of the first applied
   `ban` rule, `null` normalized to `0` (= permanent); otherwise `null`.

Default messages:

| action | text |
|---|---|
| `allow` | *(null)* |
| `admin_notify` | `Player matched a server policy rule.` (staff-facing) |
| `warn` | `Your account has been flagged by this server's trust policy.` (player-facing, as are the rows below) |
| `require_review` | `Player requires staff review under the server policy.` (staff-facing) |
| `require_whitelist` | `A VPN/proxy was detected. Request a whitelist at {whitelist_url}` |
| `kick` | `You were removed by this server's trust policy.` |
| `ban` | `You have been banned by this server's trust policy.` |

Cases cover every signal, every action as the winner, the severity order, the bypass exemption per
signal, disabled rules, unknown signals/actions, `match_unknown_age`, `min_confirmed_servers`,
`require_linked_confirmed_case`, `open_reports`, `notify_on_enforcement = false`, message selection,
placeholders, ban durations and the empty policy. `default_policy_*` cases use the §7.4 default
policy (rule ids `default-global-verdict`, `default-account-age`, `default-vpn`, `default-alt-account`).

---

## `audit-chain.json`

Backend only (the plugin never hashes audit events), included for completeness and for any
external verifier.

```jsonc
{
  "genesis_prev_hash": "000…000",          // 64 zeros
  "events": [ { "event_without_hashes", "canonical_json", "prev_hash", "hash" } ],   // 4 chained events
  "canonical_json_examples": [ { "name", "input", "canonical_json" } ]
}
```

* `event_without_hashes` = `{ seq, event_id, created_at, actor_type, actor_id, action, target_type,
  target_id, server_id, case_id, metadata, request_id }` — absent optional fields are `null`,
  `created_at` is ISO-8601 UTC with milliseconds, `seq` is a JSON number.
* `hash = lowercase_hex(SHA-256(UTF-8(canonical_json + prev_hash)))`; `prev_hash` of event *n* is
  the `hash` of event *n−1*, genesis `prev_hash` is 64 × `0`.
* Canonical JSON: object keys sorted recursively by UTF-16 code units (C#: `StringComparer.Ordinal`),
  no whitespace, arrays in order, `undefined` object members omitted, strings and numbers exactly as
  ECMAScript `JSON.stringify` (non-ASCII kept raw, control characters as `\uXXXX` or short escapes,
  `1e21` → `1e+21`, `-0` → `0`). `canonical_json_examples` pin these edge cases down.
