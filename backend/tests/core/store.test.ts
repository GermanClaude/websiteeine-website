import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createNonceStore, nonceTtlMs, REQUEST_ID_TTL_MS } from '../../src/auth/nonce-store';
import { createAdjustableClock } from '../../src/lib/time';
import { closeRedis, createRedis, type RedisClient } from '../../src/redis/client';
import { storeKeys } from '../../src/redis/keys';
import { MemoryShortLivedStore, RedisShortLivedStore, type ShortLivedStore } from '../../src/redis/store';
import { REDIS_TEST_URL } from '../helpers';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Contract shared by both implementations. `wait(ms)` lets real time (Redis) or the test
 * clock (memory) pass.
 */
function storeContract(label: string, create: () => Promise<ShortLivedStore>, wait: (ms: number) => Promise<void>): void {
  describe(`ShortLivedStore contract (${label})`, () => {
    let store: ShortLivedStore;
    const key = (name: string): string => `t:${randomBytes(4).toString('hex')}:${name}`;

    beforeAll(async () => {
      store = await create();
      await store.ping();
    });

    it('setNx sets only when absent and expires', async () => {
      const k = key('nx');
      expect(await store.setNx(k, 'a', 400)).toBe(true);
      expect(await store.setNx(k, 'b', 400)).toBe(false);
      expect(await store.get(k)).toBe('a');
      const ttl = await store.ttl(k);
      expect(ttl).not.toBeNull();
      expect(ttl).toBeLessThanOrEqual(400);
      expect(ttl).toBeGreaterThan(0);
      await wait(450);
      expect(await store.get(k)).toBeNull();
      expect(await store.ttl(k)).toBeNull();
      expect(await store.setNx(k, 'c', 400)).toBe(true);
    });

    it('set overrides, del reports existence, getDel is single-use', async () => {
      const k = key('set');
      await store.set(k, 'one', 1_000);
      await store.set(k, 'two', 1_000);
      expect(await store.get(k)).toBe('two');
      expect(await store.del(k)).toBe(true);
      expect(await store.del(k)).toBe(false);
      await store.set(k, 'token', 1_000);
      expect(await store.getDel(k)).toBe('token');
      expect(await store.getDel(k)).toBeNull();
      expect(await store.get(k)).toBeNull();
    });

    it('delIfEquals only releases a lock held with the same value', async () => {
      const k = key('lock');
      expect(await store.setNx(k, 'owner-1', 1_000)).toBe(true);
      expect(await store.delIfEquals(k, 'owner-2')).toBe(false);
      expect(await store.get(k)).toBe('owner-1');
      expect(await store.delIfEquals(k, 'owner-1')).toBe(true);
      expect(await store.get(k)).toBeNull();
      expect(await store.delIfEquals(k, 'owner-1')).toBe(false);
    });

    it('incr counts within a window that starts with the first increment', async () => {
      const k = key('incr');
      expect(await store.incr(k, 400)).toBe(1);
      expect(await store.incr(k, 400)).toBe(2);
      await wait(250);
      // Later increments do not extend the window.
      expect(await store.incr(k, 400)).toBe(3);
      await wait(250);
      expect(await store.get(k)).toBeNull();
      expect(await store.incr(k, 400)).toBe(1);
    });

    it('rejects invalid TTLs', async () => {
      for (const ttl of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(store.setNx(key('ttl'), 'x', ttl)).rejects.toThrow(RangeError);
        await expect(store.set(key('ttl'), 'x', ttl)).rejects.toThrow(RangeError);
        await expect(store.incr(key('ttl'), ttl)).rejects.toThrow(RangeError);
      }
    });
  });
}

// --- memory -----------------------------------------------------------------

const memoryClock = createAdjustableClock('2026-09-29T12:00:00.000Z');
storeContract(
  'memory',
  async () => new MemoryShortLivedStore({ clock: memoryClock }),
  async (ms) => memoryClock.advance(ms),
);

describe('MemoryShortLivedStore specifics', () => {
  it('follows the injected clock and evicts beyond maxEntries', async () => {
    const clock = createAdjustableClock(0);
    const store = new MemoryShortLivedStore({ clock, maxEntries: 3 });
    await store.set('a', '1', 1_000);
    await store.set('b', '1', 5_000);
    await store.set('c', '1', 3_000);
    expect(store.size()).toBe(3);
    await store.set('d', '1', 4_000);
    // The entry expiring soonest (a) is evicted first.
    expect(store.size()).toBe(3);
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBe('1');
    clock.advance(3_500);
    expect(store.size()).toBe(2); // c expired
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('is unaffected by real time', async () => {
    const clock = createAdjustableClock(0);
    const store = new MemoryShortLivedStore({ clock });
    await store.set('k', 'v', 1);
    await sleep(5);
    expect(await store.get('k')).toBe('v');
    clock.advance(1);
    expect(await store.get('k')).toBeNull();
  });
});

// --- redis ------------------------------------------------------------------

describe('RedisShortLivedStore', () => {
  const prefix = `stn-test:store:${randomBytes(6).toString('hex')}:`;
  let redis: RedisClient;

  beforeAll(() => {
    redis = createRedis(REDIS_TEST_URL, { keyPrefix: prefix });
  });

  afterAll(async () => {
    const cleaner = createRedis(REDIS_TEST_URL);
    try {
      let cursor = '0';
      do {
        const [next, keys] = await cleaner.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) await cleaner.del(...keys);
      } while (cursor !== '0');
    } finally {
      await closeRedis(cleaner);
      await closeRedis(redis);
    }
  });

  storeContract('redis', async () => new RedisShortLivedStore(redis), sleep);

  it('namespaces keys with the client prefix', async () => {
    const store = new RedisShortLivedStore(redis);
    await store.set('namespaced', '1', 5_000);
    const raw = createRedis(REDIS_TEST_URL);
    try {
      expect(await raw.get(`${prefix}namespaced`)).toBe('1');
      expect(await raw.get('namespaced')).toBeNull();
    } finally {
      await closeRedis(raw);
    }
  });
});

// --- key builders and nonce store ------------------------------------------

describe('storeKeys', () => {
  it('builds the documented keys', () => {
    expect(storeKeys.nonce('srv_7k4x92m8pq174kf9', 'abcDEF123-_')).toBe('nonce:srv_7k4x92m8pq174kf9:abcDEF123-_');
    expect(storeKeys.requestId('srv_7k4x92m8pq174kf9', '5B5C0F9E-7F3B-4B1B-9C1F-0A1B2C3D4E5F')).toBe(
      'reqid:srv_7k4x92m8pq174kf9:5b5c0f9e-7f3b-4b1b-9c1f-0a1b2c3d4e5f',
    );
    expect(storeKeys.serverSeen('srv_7k4x92m8pq174kf9')).toBe('srvseen:srv_7k4x92m8pq174kf9');
    expect(storeKeys.rateLimit('reports', 'user-1')).toBe('rl:reports:user-1');
    expect(storeKeys.mfaToken('a'.repeat(64))).toBe(`mfa:${'a'.repeat(64)}`);
    expect(storeKeys.linkCode('LNK-7K4X92')).toBe('link:LNK-7K4X92');
    expect(storeKeys.linkCodeOfUser('u1')).toBe('link:user:u1');
    expect(storeKeys.vpnCache('f'.repeat(64))).toBe(`vpn:${'f'.repeat(64)}`);
    expect(storeKeys.lock('job-retention')).toBe('lock:job-retention');
  });

  it('rejects components that could inject separators or patterns', () => {
    for (const bad of ['', ' ', 'a b', 'a:b', 'a*', '*', 'a\n', 'a/b', 'ä', 'a'.repeat(201), '{x}', 'a?']) {
      expect(() => storeKeys.nonce('srv_7k4x92m8pq174kf9', bad), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => storeKeys.lock(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    expect(() => storeKeys.nonce('srv_x:*', 'nonce')).toThrow(TypeError);
  });
});

describe('NonceStore', () => {
  it('claims nonces and request ids once per server within their TTL', async () => {
    const clock = createAdjustableClock(0);
    const nonces = createNonceStore(new MemoryShortLivedStore({ clock }));
    expect(await nonces.claimNonce('srv_a', 'n1', nonceTtlMs(60))).toBe(true);
    expect(await nonces.claimNonce('srv_a', 'n1', nonceTtlMs(60))).toBe(false);
    expect(await nonces.claimNonce('srv_b', 'n1', nonceTtlMs(60))).toBe(true);
    clock.advance(nonceTtlMs(60));
    expect(await nonces.claimNonce('srv_a', 'n1', nonceTtlMs(60))).toBe(true);

    const id = '5b5c0f9e-7f3b-4b1b-9c1f-0a1b2c3d4e5f';
    expect(await nonces.claimRequestId('srv_a', id, REQUEST_ID_TTL_MS)).toBe(true);
    expect(await nonces.claimRequestId('srv_a', id.toUpperCase(), REQUEST_ID_TTL_MS)).toBe(false);
    clock.advance(REQUEST_ID_TTL_MS - 1);
    expect(await nonces.claimRequestId('srv_a', id, REQUEST_ID_TTL_MS)).toBe(false);
    clock.advance(1);
    expect(await nonces.claimRequestId('srv_a', id, REQUEST_ID_TTL_MS)).toBe(true);
  });

  it('derives the nonce TTL from the skew (2 × skew + 30 s) and remembers request ids for 10 min', () => {
    expect(nonceTtlMs(60)).toBe(150_000);
    expect(nonceTtlMs(5)).toBe(40_000);
    expect(REQUEST_ID_TTL_MS).toBe(600_000);
  });
});
