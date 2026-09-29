/**
 * buildTestApp(): a fully wired Fastify app on a fresh, migrated PostgreSQL database.
 *
 *   const t = await buildTestApp();
 *   const res = await t.app.inject({ method: 'GET', url: '/healthz' });
 *   await t.close();
 *
 * Defaults: in-memory ShortLivedStore (driven by the adjustable test clock), local evidence
 * storage in a temp dir, NoopMailer, silent logger, generous rate limits. `redis: true`
 * uses the real Redis (REDIS_TEST_URL, default redis://localhost:6379/15) with a random key
 * prefix that is deleted on close.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll } from 'vitest';

import { buildApp } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { createContainer, type Deps } from '../../src/container';
import type { Database } from '../../src/db/types';
import { createSilentLogger, type AppLogger } from '../../src/lib/logger';
import { createAdjustableClock, type AdjustableClock } from '../../src/lib/time';
import { NoopMailer } from '../../src/mail';
import type { NamedModule } from '../../src/modules/types';
import { closeRedis, createRedis, type RedisClient } from '../../src/redis/client';
import { MemoryShortLivedStore, type ShortLivedStore } from '../../src/redis/store';
import { LocalObjectStorage } from '../../src/storage';
import { testEnv } from './env';
import { createTestDatabase, type TestDatabase } from './test-db';

export interface TestAppOptions {
  /** Environment overrides (merged over testEnv()). */
  env?: Record<string, string | undefined>;
  /** Start of the adjustable clock (default: real now). */
  now?: Date | string | number;
  /** Use the real Redis (REDIS_TEST_URL) instead of the in-memory store. */
  redis?: boolean;
  /** Feature modules to register (default: all). */
  modules?: readonly NamedModule[];
  /** Extra routes for the test (registered after the core and modules). */
  extend?: (app: FastifyInstance) => Promise<void> | void;
  /** Reuse an existing test database (not destroyed by close()). */
  database?: TestDatabase;
  /** Custom logger (default silent). */
  logger?: AppLogger;
}

export interface TestApp {
  app: FastifyInstance;
  deps: Deps;
  config: Config;
  db: Kysely<Database>;
  testDb: TestDatabase;
  clock: AdjustableClock;
  mailer: NoopMailer;
  store: ShortLivedStore;
  redis: RedisClient | null;
  /** Local evidence storage directory (temp, removed on close). */
  storageDir: string;
  close(): Promise<void>;
}

export const REDIS_TEST_URL = process.env['REDIS_TEST_URL'] ?? 'redis://localhost:6379/15';

async function deleteKeysWithPrefix(prefix: string): Promise<void> {
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
  }
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const ownsDatabase = options.database === undefined;
  const testDb = options.database ?? (await createTestDatabase());
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scpsl-trust-storage-'));
  const redisPrefix = `stn-test:${randomBytes(6).toString('hex')}:`;

  try {
    const config = loadConfig(
      testEnv({
        DATABASE_URL: testDb.url,
        STORAGE_LOCAL_DIR: storageDir,
        ...(options.redis === true ? { REDIS_URL: REDIS_TEST_URL, REDIS_KEY_PREFIX: redisPrefix } : {}),
        ...options.env,
      }),
    );
    const clock = createAdjustableClock(options.now ?? Date.now());
    const mailer = new NoopMailer();
    const redis = options.redis === true ? createRedis(REDIS_TEST_URL, { keyPrefix: redisPrefix }) : null;
    const deps = createContainer(config, {
      database: { db: testDb.db, pool: testDb.pool },
      redis,
      ...(redis === null ? { store: new MemoryShortLivedStore({ clock }) } : {}),
      clock,
      logger: options.logger ?? createSilentLogger(),
      mailer,
      storage: new LocalObjectStorage(storageDir),
    });
    const buildOptions: Parameters<typeof buildApp>[1] = {};
    if (options.modules !== undefined) buildOptions.modules = options.modules;
    if (options.extend !== undefined) buildOptions.extend = options.extend;
    const app = await buildApp(deps, buildOptions);
    await app.ready();

    let closed: Promise<void> | undefined;
    return {
      app,
      deps,
      config,
      db: testDb.db,
      testDb,
      clock,
      mailer,
      store: deps.store,
      redis,
      storageDir,
      close(): Promise<void> {
        closed ??= (async () => {
          await app.close();
          await deps.close();
          if (redis !== null) {
            await closeRedis(redis);
            await deleteKeysWithPrefix(redisPrefix);
          }
          if (ownsDatabase) await testDb.destroy();
          await fs.rm(storageDir, { recursive: true, force: true });
        })();
        return closed;
      },
    };
  } catch (err) {
    if (ownsDatabase) await testDb.destroy();
    await fs.rm(storageDir, { recursive: true, force: true });
    throw err;
  }
}

/** Vitest convenience: one app per file (beforeAll/afterAll); returns an accessor. */
export function useTestApp(options: TestAppOptions = {}): () => TestApp {
  let testApp: TestApp | undefined;
  beforeAll(async () => {
    testApp = await buildTestApp(options);
  });
  afterAll(async () => {
    await testApp?.close();
  });
  return () => {
    if (testApp === undefined) throw new Error('Test app is not ready (use it inside tests or hooks)');
    return testApp;
  };
}
