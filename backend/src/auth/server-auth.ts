/**
 * Ed25519 signed-request authentication for plugin endpoints (ARCHITECTURE §5.3, §5.4).
 *
 * Verification order (exactly as §5.4):
 *   1. required headers present (401 MISSING_AUTH_HEADERS) and well-formed (400 INVALID_AUTH_HEADERS)
 *   2. |now − X-Timestamp| ≤ SIGNATURE_MAX_SKEW_SECONDS (401 TIMESTAMP_OUT_OF_RANGE)
 *   3. server exists (401 UNKNOWN_SERVER) and is active (403 SERVER_SUSPENDED / SERVER_REVOKED;
 *      a never-registered `pending` server has no key: 401 NO_ACTIVE_KEY)
 *   4. candidate keys: active + retiring within grace, filtered by X-Key-Fingerprint
 *      (401 KEY_REVOKED when the selected key is revoked, else 401 NO_ACTIVE_KEY)
 *   5. Ed25519 over the canonical string built from the raw body (401 INVALID_SIGNATURE)
 *   6. nonce claim (401 REPLAYED_NONCE)          — only after a valid signature
 *   7. request id claim (409 DUPLICATE_REQUEST_ID) — only after a valid signature
 *   8. request.authServer + throttled last_seen_at / plugin_version update
 *   9. body.server_id, if present, equals X-Server-Id (400 SERVER_ID_MISMATCH)
 *
 * Failures are logged without secrets and counted per (claimed server, client) and per
 * client; repeated failures are answered with 429 RATE_LIMITED before any DB work.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import type { Kysely } from 'kysely';

import {
  buildCanonicalRequest,
  KEY_FINGERPRINT_REGEX,
  LIMITS,
  NONCE_REGEX,
  PLUGIN_VERSION_REGEX,
  REQUEST_ID_REGEX,
  REQUIRED_SIGNING_HEADERS_LOWER,
  SERVER_ID_REGEX,
  SIGNATURE_B64_REGEX,
  SIGNING_HEADERS_LOWER,
  TIMESTAMP_MS_REGEX,
  type ErrorCode,
} from '@scpsl-trust/shared';

import type { Database } from '../db/types';
import { hmacSha256Hex, sha256Hex, verifyEd25519 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import type { AppLogger } from '../lib/logger';
import type { Clock } from '../lib/time';
import { storeKeys } from '../redis/keys';
import type { ShortLivedStore } from '../redis/store';
import { nonceTtlMs, REQUEST_ID_TTL_MS, type NonceStore } from './nonce-store';
import type { AuthenticatedServer } from './types';

/** last_seen_at / plugin_version are written at most once per minute per server. */
export const SERVER_SEEN_THROTTLE_MS = 60_000;
const FAILURE_WINDOW_MS = 60_000;
/** A single client may fail this many times more across all servers before being limited. */
const PER_CLIENT_FAILURE_FACTOR = 4;

export interface SignedRequestInput {
  method: string;
  /** Raw request target (path + query exactly as sent), i.e. request.raw.url. */
  url: string;
  headers: IncomingHttpHeaders;
  /** Raw body bytes; undefined/empty for requests without body. */
  rawBody: Buffer | undefined;
}

export interface VerifyServerSignatureDeps {
  db: Kysely<Database>;
  nonceStore: NonceStore;
  clock: Clock;
  maxSkewSeconds: number;
}

interface ParsedSigningHeaders {
  serverId: string;
  timestamp: string;
  timestampMs: number;
  nonce: string;
  requestId: string;
  pluginVersion: string;
  signature: string;
  fingerprint: string | null;
}

function fail(code: ErrorCode, details?: Record<string, unknown>): never {
  throw new AppError(code, undefined, details);
}

/** Step 1: presence and format of the signing headers. */
export function parseSigningHeaders(headers: IncomingHttpHeaders): ParsedSigningHeaders {
  const missing = REQUIRED_SIGNING_HEADERS_LOWER.filter((name) => headers[name] === undefined);
  if (missing.length > 0) fail('MISSING_AUTH_HEADERS', { missing });

  const read = (name: string): string | undefined => {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  const invalid: string[] = [];
  const check = (name: string, valid: (value: string) => boolean): string => {
    const value = read(name);
    if (value === undefined || !valid(value)) {
      invalid.push(name);
      return '';
    }
    return value;
  };

  const serverId = check(SIGNING_HEADERS_LOWER.SERVER_ID, (v) => SERVER_ID_REGEX.test(v));
  const timestamp = check(
    SIGNING_HEADERS_LOWER.TIMESTAMP,
    (v) => TIMESTAMP_MS_REGEX.test(v) && Number.isSafeInteger(Number(v)),
  );
  const nonce = check(SIGNING_HEADERS_LOWER.NONCE, (v) => NONCE_REGEX.test(v));
  const requestId = check(SIGNING_HEADERS_LOWER.REQUEST_ID, (v) => REQUEST_ID_REGEX.test(v));
  const pluginVersion = check(
    SIGNING_HEADERS_LOWER.PLUGIN_VERSION,
    (v) => v.length <= LIMITS.PLUGIN_VERSION_MAX && PLUGIN_VERSION_REGEX.test(v),
  );
  const signature = check(SIGNING_HEADERS_LOWER.SIGNATURE, (v) => SIGNATURE_B64_REGEX.test(v));
  let fingerprint: string | null = null;
  if (headers[SIGNING_HEADERS_LOWER.KEY_FINGERPRINT] !== undefined) {
    fingerprint = check(SIGNING_HEADERS_LOWER.KEY_FINGERPRINT, (v) => KEY_FINGERPRINT_REGEX.test(v));
  }
  if (invalid.length > 0) fail('INVALID_AUTH_HEADERS', { invalid });

  return {
    serverId,
    timestamp,
    timestampMs: Number(timestamp),
    nonce,
    requestId,
    pluginVersion,
    signature,
    fingerprint,
  };
}

interface VerifiedRequest {
  server: AuthenticatedServer;
  /** servers.plugin_version before this request. */
  storedPluginVersion: string | null;
}

/**
 * Steps 1–7. Returns the authenticated server or throws an AppError. Performs the nonce
 * and request-id claims (side effects) only after the signature has been verified.
 */
export async function verifySignedRequest(
  deps: VerifyServerSignatureDeps,
  input: SignedRequestInput,
): Promise<AuthenticatedServer> {
  return (await verify(deps, input)).server;
}

async function verify(deps: VerifyServerSignatureDeps, input: SignedRequestInput): Promise<VerifiedRequest> {
  // 1. Headers.
  const headers = parseSigningHeaders(input.headers);

  // 2. Timestamp.
  const now = deps.clock.now();
  if (Math.abs(now.getTime() - headers.timestampMs) > deps.maxSkewSeconds * 1000) {
    fail('TIMESTAMP_OUT_OF_RANGE');
  }

  // 3. Server.
  const server = await deps.db
    .selectFrom('servers')
    .select(['id', 'server_id', 'name', 'status', 'owner_user_id', 'plugin_version'])
    .where('server_id', '=', headers.serverId)
    .executeTakeFirst();
  if (server === undefined) fail('UNKNOWN_SERVER');
  if (server.status === 'suspended') fail('SERVER_SUSPENDED');
  if (server.status === 'revoked') fail('SERVER_REVOKED');
  if (server.status !== 'active') fail('NO_ACTIVE_KEY');

  // 4. Candidate keys.
  let candidateQuery = deps.db
    .selectFrom('server_keys')
    .select(['id', 'public_key', 'fingerprint', 'status'])
    .where('server_id', '=', server.id)
    .where((eb) =>
      eb.or([eb('status', '=', 'active'), eb.and([eb('status', '=', 'retiring'), eb('retiring_until', '>', now)])]),
    );
  if (headers.fingerprint !== null) candidateQuery = candidateQuery.where('fingerprint', '=', headers.fingerprint);
  // Active key first: it is the one a healthy plugin uses.
  const candidates = await candidateQuery.orderBy('activated_at', 'desc').execute();
  candidates.sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
  if (candidates.length === 0) {
    let selected = deps.db
      .selectFrom('server_keys')
      .select(['status'])
      .where('server_id', '=', server.id);
    selected =
      headers.fingerprint !== null
        ? selected.where('fingerprint', '=', headers.fingerprint)
        : selected.orderBy('created_at', 'desc').orderBy('activated_at', 'desc').limit(1);
    const key = await selected.executeTakeFirst();
    fail(key?.status === 'revoked' ? 'KEY_REVOKED' : 'NO_ACTIVE_KEY');
  }

  // 5. Signature over the canonical string (raw body bytes, raw path + query).
  let canonical: string;
  try {
    canonical = buildCanonicalRequest({
      method: input.method,
      pathWithQuery: input.url,
      serverId: headers.serverId,
      timestamp: headers.timestamp,
      nonce: headers.nonce,
      requestId: headers.requestId,
      bodySha256Hex: sha256Hex(input.rawBody ?? Buffer.alloc(0)),
    });
  } catch {
    fail('INVALID_SIGNATURE');
  }
  const key = candidates.find((candidate) => verifyEd25519(candidate.public_key, canonical, headers.signature));
  if (key === undefined) fail('INVALID_SIGNATURE');

  // 6. Nonce (2 × skew + 30 s).
  if (!(await deps.nonceStore.claimNonce(headers.serverId, headers.nonce, nonceTtlMs(deps.maxSkewSeconds)))) {
    fail('REPLAYED_NONCE');
  }
  // 7. Request id (10 min).
  if (!(await deps.nonceStore.claimRequestId(headers.serverId, headers.requestId, REQUEST_ID_TTL_MS))) {
    fail('DUPLICATE_REQUEST_ID');
  }

  return {
    server: {
      id: server.id,
      server_id: server.server_id,
      key_id: key.id,
      fingerprint: key.fingerprint,
      plugin_version: headers.pluginVersion,
      name: server.name,
      owner_user_id: server.owner_user_id,
    },
    storedPluginVersion: server.plugin_version,
  };
}

/** Step 9: a server_id in the JSON body must equal the authenticated one. */
export function assertBodyServerId(body: unknown, server: Pick<AuthenticatedServer, 'server_id'>): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  if (!Object.hasOwn(body, 'server_id')) return;
  const value: unknown = (body as Record<string, unknown>)['server_id'];
  if (value === undefined || value === null) return;
  if (value !== server.server_id) fail('SERVER_ID_MISMATCH');
}

/** Steps 1–7 and 9 without the request side effects of step 8 (unit tests, tools). */
export async function verifyServerSignature(
  deps: VerifyServerSignatureDeps,
  input: SignedRequestInput & { body?: unknown },
): Promise<AuthenticatedServer> {
  const server = await verifySignedRequest(deps, input);
  assertBodyServerId(input.body, server);
  return server;
}

// ---------------------------------------------------------------------------
// preHandler
// ---------------------------------------------------------------------------

export interface ServerAuthDeps extends VerifyServerSignatureDeps {
  store: ShortLivedStore;
  logger: AppLogger;
  /** Failures per (claimed server, client) and minute before 429 (per client: 4×). */
  failureLimitPerMinute: number;
  /** Secret used to pseudonymize client IPs in failure-counter keys. */
  ipHashSecret: string;
}

/** Codes that count as authentication failures (everything except infrastructure errors). */
const COUNTED_FAILURES: ReadonlySet<string> = new Set<ErrorCode>([
  'MISSING_AUTH_HEADERS',
  'INVALID_AUTH_HEADERS',
  'TIMESTAMP_OUT_OF_RANGE',
  'UNKNOWN_SERVER',
  'SERVER_SUSPENDED',
  'SERVER_REVOKED',
  'KEY_REVOKED',
  'NO_ACTIVE_KEY',
  'INVALID_SIGNATURE',
  'REPLAYED_NONCE',
  'DUPLICATE_REQUEST_ID',
]);

function claimedServerId(headers: IncomingHttpHeaders): string {
  const value = headers[SIGNING_HEADERS_LOWER.SERVER_ID];
  return typeof value === 'string' && SERVER_ID_REGEX.test(value) ? value : 'invalid';
}

function failureKeys(deps: ServerAuthDeps, request: FastifyRequest): { perServer: string; perClient: string } {
  const client = hmacSha256Hex(deps.ipHashSecret, `authfail:v1:${request.ip}`).slice(0, 32);
  return {
    perServer: storeKeys.serverAuthFailures(`${claimedServerId(request.headers)}.${client}`),
    perClient: storeKeys.serverAuthFailures(`client.${client}`),
  };
}

async function assertNotThrottled(deps: ServerAuthDeps, keys: { perServer: string; perClient: string }): Promise<void> {
  const [perServer, perClient] = await Promise.all([deps.store.get(keys.perServer), deps.store.get(keys.perClient)]);
  const limit = deps.failureLimitPerMinute;
  if (Number(perServer ?? 0) >= limit || Number(perClient ?? 0) >= limit * PER_CLIENT_FAILURE_FACTOR) {
    const ttl = (await deps.store.ttl(keys.perServer)) ?? FAILURE_WINDOW_MS;
    const error = new AppError('RATE_LIMITED', 'Too many failed authentication attempts', {
      retry_after_seconds: Math.max(1, Math.ceil(ttl / 1000)),
    });
    throw error;
  }
}

async function touchServer(deps: ServerAuthDeps, server: AuthenticatedServer, storedPluginVersion: string | null): Promise<void> {
  const throttleOpen = await deps.store.setNx(storeKeys.serverSeen(server.server_id), '1', SERVER_SEEN_THROTTLE_MS);
  if (!throttleOpen && storedPluginVersion === server.plugin_version) return;
  await deps.db
    .updateTable('servers')
    .set({ last_seen_at: deps.clock.now(), plugin_version: server.plugin_version })
    .where('id', '=', server.id)
    .execute();
}

function isInfrastructureError(err: unknown): boolean {
  return !(err instanceof AppError);
}

/**
 * Creates the `requireServerSignature` preHandler. On success request.authServer is set and
 * request.log carries server_id.
 */
export function createServerSignatureHandler(deps: ServerAuthDeps): preHandlerAsyncHookHandler {
  const handler = async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const keys = failureKeys(deps, request);
    let verified: VerifiedRequest;
    try {
      await assertNotThrottled(deps, keys);
      verified = await verify(deps, {
        method: request.method,
        url: request.raw.url ?? request.url,
        headers: request.headers,
        rawBody: request.rawBody,
      });
    } catch (err) {
      if (err instanceof AppError && COUNTED_FAILURES.has(err.code)) {
        await Promise.all([
          deps.store.incr(keys.perServer, FAILURE_WINDOW_MS),
          deps.store.incr(keys.perClient, FAILURE_WINDOW_MS),
        ]).catch(() => undefined);
        request.log.warn(
          { event: 'server_auth_failed', error_code: err.code, claimed_server_id: claimedServerId(request.headers) },
          'signed request rejected',
        );
        throw err;
      }
      if (isInfrastructureError(err)) {
        request.log.error({ err, event: 'server_auth_unavailable' }, 'signed request verification failed');
        throw new AppError('SERVICE_UNAVAILABLE', undefined, undefined, { cause: err });
      }
      throw err;
    }

    // 8. Principal + throttled bookkeeping (never fails the request).
    const { server } = verified;
    request.authServer = server;
    request.log = request.log.child({ server_id: server.server_id });
    try {
      await touchServer(deps, server, verified.storedPluginVersion);
    } catch (err) {
      request.log.warn({ err }, 'failed to update server last_seen_at');
    }

    // 9. Body server_id.
    assertBodyServerId(request.body, server);
  };
  return handler;
}
