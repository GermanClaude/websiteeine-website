/**
 * VpnService (§6.4): cached VPN lookup.
 *
 * - Private/reserved addresses are never sent to any provider → `not_detected`,
 *   `checked: false` (no error: there is nothing to check).
 * - Results are cached in the ShortLivedStore under the *network hash* of the
 *   address (never the raw IP) for VPN_CACHE_TTL_SECONDS. Failed lookups
 *   (`checked: false`) are not cached so the next check retries the providers.
 */
import type { AppLogger } from '../../lib/logger';
import { isPublicIp, networkHashes } from '../../lib/ip';
import type { ShortLivedStore } from '../../redis/store';
import { storeKeys } from '../../redis/keys';
import type { VpnDetectionProvider, VpnLookupResult } from './types';

const CACHEABLE_CONFIDENCES = new Set(['not_detected', 'possible', 'likely', 'confirmed']);

export interface VpnServiceOptions {
  provider: VpnDetectionProvider;
  store: ShortLivedStore;
  /** IP_HASH_SECRET — cache keys are network hashes. */
  ipHashSecret: string | Buffer;
  cacheTtlSeconds: number;
  logger?: AppLogger | undefined;
}

const NOT_CHECKED: VpnLookupResult = Object.freeze({
  detected: false,
  confidence: 'not_detected',
  type: null,
  provider: 'none',
  checked: false,
});

export class VpnService {
  private readonly provider: VpnDetectionProvider;
  private readonly store: ShortLivedStore;
  private readonly ipHashSecret: string | Buffer;
  private readonly cacheTtlMs: number;
  private readonly logger: AppLogger | undefined;

  constructor(options: VpnServiceOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.ipHashSecret = options.ipHashSecret;
    this.cacheTtlMs = Math.max(0, Math.floor(options.cacheTtlSeconds * 1000));
    this.logger = options.logger;
  }

  /** `ip` is used transiently; nothing derived from it except HMAC hashes is stored. */
  async check(ip: string | null | undefined): Promise<VpnLookupResult> {
    if (ip === null || ip === undefined || ip.length === 0) return NOT_CHECKED;
    if (!isPublicIp(ip)) return NOT_CHECKED; // private/reserved → never looked up (§6.4)
    const hashes = networkHashes(ip, this.ipHashSecret);
    if (hashes === null) return NOT_CHECKED;
    const cacheKey = storeKeys.vpnCache(hashes.network_hash);

    if (this.cacheTtlMs > 0) {
      try {
        const cached = await this.store.get(cacheKey);
        if (cached !== null) {
          const parsed = this.parseCached(cached);
          if (parsed !== null) return parsed;
        }
      } catch (error) {
        this.logger?.warn({ err: error }, 'vpn cache read failed');
      }
    }

    let result: VpnLookupResult;
    try {
      const answer = await this.provider.check(ip, new AbortController().signal);
      result = { ...answer, checked: (answer as VpnLookupResult).checked ?? true };
      const error = (answer as VpnLookupResult).error;
      if (error !== undefined) result.error = error;
    } catch (error) {
      this.logger?.warn({ err: error, provider: this.provider.name }, 'vpn provider failed');
      result = { detected: false, confidence: 'not_detected', type: null, provider: this.provider.name, checked: false, error: 'provider_unavailable' };
    }

    if (result.checked && this.cacheTtlMs > 0) {
      try {
        await this.store.set(cacheKey, JSON.stringify(result), this.cacheTtlMs);
      } catch (error) {
        this.logger?.warn({ err: error }, 'vpn cache write failed');
      }
    }
    return result;
  }

  private parseCached(raw: string): VpnLookupResult | null {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as VpnLookupResult).detected === 'boolean' &&
        CACHEABLE_CONFIDENCES.has((parsed as VpnLookupResult).confidence)
      ) {
        return parsed as VpnLookupResult;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}
