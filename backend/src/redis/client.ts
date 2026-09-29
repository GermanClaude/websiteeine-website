/**
 * ioredis client factory. `lazyConnect` defers the connection until the first command, so
 * constructing the container never blocks; readiness is checked via PING (/readyz).
 */
import { Redis, type RedisOptions } from 'ioredis';

export type RedisClient = Redis;

export interface CreateRedisOptions {
  /** Prefix applied to every key by ioredis (including Lua KEYS). */
  keyPrefix?: string;
  /** Called for connection errors (ioredis emits them on every failed reconnect). */
  onError?: (err: Error) => void;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

export function createRedis(url: string, options: CreateRedisOptions = {}): RedisClient {
  const redisOptions: RedisOptions = {
    lazyConnect: true,
    keyPrefix: options.keyPrefix ?? '',
    connectTimeout: options.connectTimeoutMs ?? 5_000,
    commandTimeout: options.commandTimeoutMs ?? 5_000,
    // Fail fast instead of queueing requests for a long time while Redis is down.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times: number) => Math.min(100 * 2 ** Math.min(times, 6), 5_000),
  };
  const client = new Redis(url, redisOptions);
  client.on('error', (err: Error) => {
    options.onError?.(err);
  });
  return client;
}

/** Quits gracefully (falls back to disconnect when the connection is not usable). */
export async function closeRedis(client: RedisClient): Promise<void> {
  if (client.status === 'end') return;
  if (client.status === 'wait') {
    client.disconnect();
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
