# Backend test helpers

Everything is re-exported from `tests/helpers` (`import { … } from '../helpers'`). Tests run with
vitest against a real PostgreSQL (one fresh, migrated database **per test file**) and, on request,
a real Redis. Files may therefore run in parallel; keep one app or database per file and never
share state between files.

Requirements: PostgreSQL reachable through `TEST_DATABASE_ADMIN_URL` (default
`postgres://scpsl:scpsl@localhost:5432/postgres`, needs `CREATEDB`; `reset()` needs superuser) and,
for `redis: true`, `REDIS_TEST_URL` (default `redis://localhost:6379/15`).

## Test application — `app.ts`

```ts
import { useTestApp, createUser, sessionFor, expectError } from '../helpers';

describe('my module', () => {
  const t = useTestApp({ now: '2026-09-29T15:42:20.000Z' });   // beforeAll/afterAll wired

  it('requires auth', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/cases' });
    expectError(res, 401, 'UNAUTHENTICATED');
  });
});
```

* `buildTestApp(options?) → Promise<TestApp>` builds the full Fastify app (`buildApp`) on a new
  test database. `useTestApp(options?)` wraps it in `beforeAll`/`afterAll` and returns an accessor.
* `TestApp`: `{ app, deps, config, db, testDb, clock, mailer, store, redis, storageDir, close() }`.
  * `deps` is the container (`Deps`) the modules receive: `db`, `audit`, `sessions`, `secretBox`,
    `store`, `nonceStore`, `storage`, `mailer`, `scheduler`, `rateLimits`, `config`, `clock`, `logger`.
  * `clock` is an `AdjustableClock` (`advance(ms)`, `advanceSeconds(s)`, `set(date)`). Everything
    in the core reads time from it: session expiry, signed-request timestamps, TTLs of the
    in-memory store, audit `created_at`. Advance it instead of sleeping.
  * `mailer` is a `NoopMailer`: `mailer.sent` (array of `{ to, subject, text, html? }`),
    `mailer.lastTo(address)`, `mailer.clear()`.
  * `store` is the `ShortLivedStore` (in memory by default, driven by `clock`; Redis with
    `redis: true`). `storageDir` is a temp directory backing a `LocalObjectStorage`; both are
    removed by `close()`.
* Options: `env` (overrides merged over `testEnv()`; e.g. `{ RATE_LIMIT_AUTH_PER_MINUTE: '3' }`),
  `now`, `redis: true`, `modules` (subset of `MODULES` from `src/modules`, `[]` = core only),
  `extend(app)` (register extra routes for the test), `database` (reuse a `TestDatabase`), `logger`.

`testEnv(overrides?)` (`env.ts`) is the base environment: `NODE_ENV=test`, random per-process
secrets, `COOKIE_SECURE=true`, `MAIL_TRANSPORT=noop`, jobs and OpenAPI UI off, and every rate limit
raised to 100000 so functional tests are never throttled (tests of limits set them explicitly).

## Databases — `test-db.ts`

`createTestDatabase()` / `useTestDatabase()` give a `TestDatabase` (`{ name, url, db, pool, reset(),
destroy() }`) without an app: migrations run once into a template database and each test database
is a copy. `buildTestApp` uses this internally.

## Factories — `factories.ts`

All factories write rows directly through Kysely, so a module's tests do not depend on other
modules being implemented. Pass `t().deps` (or `app.deps`).

| Helper | Returns | Notes |
|---|---|---|
| `createUser(deps, { role?, email?, username?, password?, verified?, totp?, status?, playerId?, lockedUntil? })` | `{ user, password, totpSecret }` | Verified `player` by default; `DEFAULT_TEST_PASSWORD`; reviewer+ roles get a `reviewer_number`; `totp: true` enrolls 2FA and returns the base32 secret (use `generateTotpCode(secret, clock.now())` from `src/auth/totp`). Argon2 hashes are cached per password. |
| `sessionFor(deps, user, { mfa_verified?, user_agent?, ip? })` | `TestSession` | Creates a session row directly and returns `{ sessionId, token, cookie, csrfToken, headers }`. `headers` holds `cookie` + `x-csrf-token` for `app.inject({ headers })`. `mfa_verified` defaults to whether the user has 2FA. |
| `loginAs(app, user, { mfa_verified? })` | `TestSession` | Same as `sessionFor(app.deps, …)`; keep using it so tests survive a later switch to a real login request. |
| `createServerWithKey(deps, { owner?, status?, name?, isTrusted?, acceptsWhitelistRequests?, keyStatus? })` | `{ server, owner, keyPair, key, fingerprint }` | Active server with owner membership and an active Ed25519 key. `status: 'pending'` creates no key; `keyStatus: 'retiring' | 'revoked' | …` sets the initial key's state. |
| `addServerKey(deps, server, { status?, retiringUntil? })` | `{ keyPair, key, fingerprint }` | Extra key (rotation / revocation scenarios). |
| `createPlayer(deps, ref?, { display_name?, account_created_at? })` | `PlayerRow` | Default: unique steam id (`randomSteamId()`). |

## Signed plugin requests — `signed-request.ts`

```ts
const identity = await createServerWithKey(t().deps);
const res = await signedRequest(t().app, identity, {
  method: 'POST',
  url: '/api/v1/player/check',
  body: { player: { type: 'steam', id: '76561198000000001' } },
});
```

* `signedRequest(app, identity, options)` builds the canonical string with the shared
  `buildCanonicalRequest`, signs it with the identity's private key, sets all `X-*` headers
  (timestamp = app clock) and injects the request.
* Options: `method`, `url` (path + query exactly as signed), `body` (JSON) or `rawBody` (exact
  bytes), `contentType`, `timestamp`, `nonce`, `requestId`, `pluginVersion`,
  `includeFingerprint` (default true when the identity has one), `headers` (applied after signing;
  `undefined` removes a header).
* Negative tests: `sign: { method?, url?, body?, serverId?, timestamp?, nonce?, requestId?,
  privateKey?, signature? }` signs *other* values than the ones sent (tampering), or replaces the
  signature / signing key.
* `prepareSignedRequest(identity, options, nowMs)` returns the headers, payload and canonical string
  without sending; `randomNonce()` gives a plugin-style nonce.

The identity only needs `{ server: { server_id }, keyPair: { privateKey, publicKeyB64 }, fingerprint? }`.

## Assertions — `expect.ts`

`expectError(res, status, code)` asserts the status, the `{ error: { code, message, request_id } }`
shape, the `X-Request-Id` echo, and that the body contains no stack traces or file paths. It returns
the error body so tests can inspect `details`.

## Conventions

* Prefer `t().deps.audit.verifyChain()` / `t().db.selectFrom('audit_events')` to assert that an
  action was audited; audit writes must be inside the business transaction.
* Never sleep: advance `t().clock`. TTLs of the in-memory store follow the clock; with
  `redis: true` real TTLs apply.
* Cover negative and malicious cases (wrong role, other user's resource, tampered signature,
  replay, oversized input) next to the happy path.
