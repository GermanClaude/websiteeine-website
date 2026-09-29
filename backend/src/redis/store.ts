/**
 * ShortLivedStore: the TTL primitives the backend needs (nonces, request ids, single-use
 * tokens, counters, locks). Implemented on Redis for production and in memory for tests
 * and Redis-less development.
 */
import type { Clock } from '../lib/time';
import { systemClock } from '../lib/time';
import type { RedisClient } from './client';

export interface ShortLivedStore {
  readonly kind: 'redis' | 'memory';
  /** Sets `key` only if absent; true when this call created it. */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
  /** Unconditionally sets `key` with a TTL. */
  set(key: string, value: string, ttlMs: number): Promise<void>;
  get(key: string): Promise<string | null>;
  /** Deletes `key`; true when it existed. */
  del(key: string): Promise<boolean>;
  /** Atomically reads and deletes (single-use tokens). */
  getDel(key: string): Promise<string | null>;
  /** Deletes `key` only if it holds `value` (safe lock release). */
  delIfEquals(key: string, value: string): Promise<boolean>;
  /** Increments a counter; the TTL is applied when the counter is created. */
  incr(key: string, ttlMs: number): Promise<number>;
  /** Remaining TTL in ms, or null when the key does not exist / has no TTL. */
  ttl(key: string): Promise<number | null>;
  /** Throws when the backing store is unreachable (readiness probe). */
  ping(): Promise<void>;
}

function assertTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new RangeError('ttlMs must be a positive integer');
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

const INCR_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if value == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return value`;

const DEL_IF_EQUALS = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export class RedisShortLivedStore implements ShortLivedStore {
  readonly kind = 'redis' as const;

  constructor(private readonly redis: RedisClient) {}

  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    assertTtl(ttlMs);
    return (await this.redis.set(key, value, 'PX', ttlMs, 'NX')) === 'OK';
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    assertTtl(ttlMs);
    await this.redis.set(key, value, 'PX', ttlMs);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async del(key: string): Promise<boolean> {
    return (await this.redis.del(key)) > 0;
  }

  async getDel(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async delIfEquals(key: string, value: string): Promise<boolean> {
    const result = await this.redis.eval(DEL_IF_EQUALS, 1, key, value);
    return Number(result) > 0;
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    assertTtl(ttlMs);
    const result = await this.redis.eval(INCR_WITH_TTL, 1, key, String(ttlMs));
    return Number(result);
  }

  async ttl(key: string): Promise<number | null> {
    const result = await this.redis.pttl(key);
    return result >= 0 ? result : null;
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }
}

// ---------------------------------------------------------------------------
// In memory
// ---------------------------------------------------------------------------

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export interface MemoryStoreOptions {
  /** Time source (tests pass an adjustable clock so TTLs can be fast-forwarded). */
  clock?: Clock;
  /** Hard cap on live entries; the oldest-expiring entries are evicted beyond it. */
  maxEntries?: number;
}

/** Single-process store. Expired entries are dropped lazily and by periodic sweeps. */
export class MemoryShortLivedStore implements ShortLivedStore {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly clock: Clock;
  private readonly maxEntries: number;
  private operations = 0;

  constructor(options: MemoryStoreOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  private live(key: string): MemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private write(key: string, value: string, ttlMs: number): void {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    this.operations += 1;
    if (this.operations % 1000 === 0 || this.entries.size > this.maxEntries) this.sweep();
  }

  /** Removes expired entries and enforces maxEntries. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    if (this.entries.size <= this.maxEntries) return;
    const byExpiry = [...this.entries.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of byExpiry.slice(0, this.entries.size - this.maxEntries)) this.entries.delete(key);
  }

  /** Number of live entries (tests). */
  size(): number {
    this.sweep();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    assertTtl(ttlMs);
    if (this.live(key) !== undefined) return false;
    this.write(key, value, ttlMs);
    return true;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    assertTtl(ttlMs);
    this.write(key, value, ttlMs);
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async del(key: string): Promise<boolean> {
    const existed = this.live(key) !== undefined;
    this.entries.delete(key);
    return existed;
  }

  async getDel(key: string): Promise<string | null> {
    const entry = this.live(key);
    this.entries.delete(key);
    return entry?.value ?? null;
  }

  async delIfEquals(key: string, value: string): Promise<boolean> {
    const entry = this.live(key);
    if (entry === undefined || entry.value !== value) return false;
    this.entries.delete(key);
    return true;
  }

  async incr(key: string, ttlMs: number): Promise<number> {
    assertTtl(ttlMs);
    const entry = this.live(key);
    if (entry === undefined) {
      this.write(key, '1', ttlMs);
      return 1;
    }
    const next = (Number.parseInt(entry.value, 10) || 0) + 1;
    entry.value = String(next);
    return next;
  }

  async ttl(key: string): Promise<number | null> {
    const entry = this.live(key);
    return entry === undefined ? null : entry.expiresAt - this.now();
  }

  async ping(): Promise<void> {
    // Always reachable.
  }
}
