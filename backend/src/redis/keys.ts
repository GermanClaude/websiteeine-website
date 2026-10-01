/**
 * Key builders for short-lived state (Redis or the in-memory store). The client-level
 * REDIS_KEY_PREFIX is added by ioredis; these builders only produce the logical key.
 * Components are validated so user input can never inject separators or wildcards.
 */

const COMPONENT = /^[A-Za-z0-9_.@-]{1,200}$/;

function part(name: string, value: string): string {
  if (!COMPONENT.test(value)) throw new TypeError(`Invalid ${name} for a store key`);
  return value;
}

export const storeKeys = Object.freeze({
  /** §5.4 step 6: nonce:{server_id}:{nonce}. */
  nonce: (serverId: string, nonce: string): string => `nonce:${part('serverId', serverId)}:${part('nonce', nonce)}`,
  /** §5.4 step 7: reqid:{server_id}:{request_id} (request id lower-cased). */
  requestId: (serverId: string, requestId: string): string =>
    `reqid:${part('serverId', serverId)}:${part('requestId', requestId.toLowerCase())}`,
  /** Throttle for servers.last_seen_at / plugin_version updates (§5.4 step 8). */
  serverSeen: (serverId: string): string => `srvseen:${part('serverId', serverId)}`,
  /** Failed signed-request authentications, scoped by a hashed client key. */
  serverAuthFailures: (scope: string): string => `authfail:${part('scope', scope)}`,
  /** Fixed-window rate limit counters owned by services (e.g. report creation). */
  rateLimit: (name: string, subject: string): string => `rl:${part('name', name)}:${part('subject', subject)}`,
  /** Single-use 2FA login token (§12.2), keyed by the token hash. */
  mfaToken: (tokenHash: string): string => `mfa:${part('tokenHash', tokenHash)}`,
  /** Account link code (§6.6) → user id. */
  linkCode: (code: string): string => `link:${part('code', code)}`,
  /** Active link code of a user (one per user). */
  linkCodeOfUser: (userId: string): string => `link:user:${part('userId', userId)}`,
  /** VPN detection cache keyed by network hash (§6.4). */
  vpnCache: (networkHash: string): string => `vpn:${part('networkHash', networkHash)}`,
  /** Distributed lock (jobs, one-off critical sections). */
  lock: (name: string): string => `lock:${part('name', name)}`,
  /** Intrusion detection: decaying risk score of a source (`<type>.<ref>`). */
  securityScore: (source: string): string => `secscore:${part('source', source)}`,
  /** Intrusion detection: repeat-offence counter driving exponential block backoff. */
  securityStrikes: (source: string): string => `secstk:${part('source', source)}`,
  /** Intrusion detection: active transient block of a source. */
  securityBlock: (source: string): string => `secblk:${part('source', source)}`,
  /** Intrusion detection: sliding per-minute request counter of a source. */
  securityBurst: (source: string): string => `secburst:${part('source', source)}`,
});
