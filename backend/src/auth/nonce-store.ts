/**
 * Replay protection for signed plugin requests (ARCHITECTURE §5.4 steps 6–7), built on
 * the ShortLivedStore (Redis in production, memory in tests).
 */
import { storeKeys } from '../redis/keys';
import type { ShortLivedStore } from '../redis/store';

export interface NonceStore {
  /** Records a nonce; false when it was already used within its TTL. */
  claimNonce(serverId: string, nonce: string, ttlMs: number): Promise<boolean>;
  /** Records a request id; false when it was already used within its TTL. */
  claimRequestId(serverId: string, requestId: string, ttlMs: number): Promise<boolean>;
}

export function createNonceStore(store: ShortLivedStore): NonceStore {
  return {
    claimNonce: (serverId, nonce, ttlMs) => store.setNx(storeKeys.nonce(serverId, nonce), '1', ttlMs),
    claimRequestId: (serverId, requestId, ttlMs) => store.setNx(storeKeys.requestId(serverId, requestId), '1', ttlMs),
  };
}

/** Request ids are remembered for 10 minutes (§5.4 step 7). */
export const REQUEST_ID_TTL_MS = 600_000;

/** Nonces live for 2 × skew + 30 s, longer than any acceptable timestamp window (§5.4 step 6). */
export function nonceTtlMs(maxSkewSeconds: number): number {
  return (2 * maxSkewSeconds + 30) * 1000;
}
