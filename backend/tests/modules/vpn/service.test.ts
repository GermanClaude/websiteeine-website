/**
 * VpnService (§6.4): private/reserved short-circuit, cache keyed by network hash
 * (never the raw IP), TTL expiry, and provider-failure degradation.
 */
import { describe, expect, it } from 'vitest';

import { networkHashes } from '../../../src/lib/ip';
import { createAdjustableClock } from '../../../src/lib/time';
import { MemoryShortLivedStore } from '../../../src/redis/store';
import { VpnService, type VpnCheckResult, type VpnDetectionProvider } from '../../../src/modules/vpn';

const SECRET = 'test-ip-hash-secret';

function countingProvider(result: Partial<VpnCheckResult> = {}, shouldFail = { fail: false }) {
  const state = { calls: 0 };
  const provider: VpnDetectionProvider = {
    name: 'counting',
    check: async () => {
      state.calls += 1;
      if (shouldFail.fail) throw new Error('provider down');
      return { detected: true, confidence: 'likely', type: 'vpn', provider: 'counting', ...result };
    },
  };
  return { provider, state };
}

function build(provider: VpnDetectionProvider, cacheTtlSeconds = 21_600) {
  const clock = createAdjustableClock('2026-09-29T12:00:00.000Z');
  const store = new MemoryShortLivedStore({ clock });
  const service = new VpnService({ provider, store, ipHashSecret: SECRET, cacheTtlSeconds });
  return { service, store, clock };
}

describe('VpnService', () => {
  it('short-circuits private and reserved addresses without calling any provider', async () => {
    const { provider, state } = countingProvider();
    const { service } = build(provider);
    for (const ip of ['10.1.2.3', '192.168.0.1', '127.0.0.1', '169.254.10.10', 'fe80::1', 'fc00::1', '100.64.0.1']) {
      const result = await service.check(ip);
      expect(result).toMatchObject({ detected: false, confidence: 'not_detected', type: null, checked: false });
      expect(result.error).toBeUndefined();
    }
    expect(state.calls).toBe(0);
  });

  it('returns not-checked for a missing ip', async () => {
    const { provider, state } = countingProvider();
    const { service } = build(provider);
    expect((await service.check(null)).checked).toBe(false);
    expect((await service.check(undefined)).checked).toBe(false);
    expect(state.calls).toBe(0);
  });

  it('caches results under the network hash and serves them until the TTL expires', async () => {
    const { provider, state } = countingProvider();
    const { service, store, clock } = build(provider, 3600);
    const first = await service.check('93.184.216.34');
    expect(first).toMatchObject({ detected: true, confidence: 'likely', checked: true });
    expect(state.calls).toBe(1);

    // Cached: same network → no second provider call, also for a different host
    // in the same IPv6 /64 (the cache key is the network hash).
    await service.check('93.184.216.34');
    expect(state.calls).toBe(1);

    // The cache key is the HMAC network hash, never the raw address.
    const hash = networkHashes('93.184.216.34', SECRET)!.network_hash;
    expect(await store.get(`vpn:${hash}`)).not.toBeNull();

    clock.advance(3600 * 1000 + 1);
    await service.check('93.184.216.34');
    expect(state.calls).toBe(2);
  });

  it('shares the cache across an IPv6 /64', async () => {
    const { provider, state } = countingProvider();
    const { service } = build(provider);
    await service.check('2606:4700:1:2::10');
    await service.check('2606:4700:1:2:ffff::20');
    expect(state.calls).toBe(1);
    await service.check('2606:4700:1:3::10'); // different /64
    expect(state.calls).toBe(2);
  });

  it('degrades to provider_unavailable on failure and does not cache the failure', async () => {
    const flag = { fail: true };
    const { provider, state } = countingProvider({}, flag);
    const { service } = build(provider);
    const failed = await service.check('93.184.216.34');
    expect(failed).toMatchObject({ detected: false, confidence: 'not_detected', checked: false, error: 'provider_unavailable' });
    flag.fail = false;
    const ok = await service.check('93.184.216.34');
    expect(ok).toMatchObject({ detected: true, checked: true });
    expect(state.calls).toBe(2); // the failure was retried, not cached
  });

  it('ignores corrupted cache entries', async () => {
    const { provider, state } = countingProvider();
    const { service, store } = build(provider);
    const hash = networkHashes('93.184.216.34', SECRET)!.network_hash;
    await store.set(`vpn:${hash}`, 'not-json{', 60_000);
    const result = await service.check('93.184.216.34');
    expect(result.checked).toBe(true);
    expect(state.calls).toBe(1);
  });
});
