/**
 * Dependency wiring (ARCHITECTURE §1). createContainer() builds every shared, long-lived
 * dependency once; modules construct their own stateless services from `Deps`.
 */
import type { Kysely } from 'kysely';
import type { Pool } from 'pg';

import { createNonceStore, type NonceStore } from './auth/nonce-store';
import { SessionManager } from './auth/user-session';
import type { Config } from './config';
import { createDatabase } from './db/kysely';
import type { Database } from './db/types';
import { createRouteRateLimits, type RouteRateLimits } from './http/rate-limit';
import { JobScheduler } from './jobs/scheduler';
import { createSecretBox, type SecretBox } from './lib/crypto';
import { createLogger, type AppLogger } from './lib/logger';
import { systemClock, type Clock } from './lib/time';
import { createMailer, type Mailer } from './mail';
import { AuditService } from './modules/audit/service';
import { SecurityService } from './modules/security/service';
import { closeRedis, createRedis, type RedisClient } from './redis/client';
import { MemoryShortLivedStore, RedisShortLivedStore, type ShortLivedStore } from './redis/store';
import { createStorage, type ObjectStorage } from './storage';

export interface Deps {
  readonly config: Config;
  readonly db: Kysely<Database>;
  readonly pool: Pool;
  /** null when REDIS_URL is not configured (development/tests). */
  readonly redis: RedisClient | null;
  /** Redis-backed when available, otherwise in memory. */
  readonly store: ShortLivedStore;
  readonly nonceStore: NonceStore;
  readonly clock: Clock;
  readonly logger: AppLogger;
  readonly audit: AuditService;
  /** Server-side intrusion detection & anomaly flagging (shared by the observer, routes and job). */
  readonly security: SecurityService;
  readonly storage: ObjectStorage;
  readonly mailer: Mailer;
  readonly scheduler: JobScheduler;
  readonly sessions: SessionManager;
  /** AES-256-GCM bound to DATA_ENCRYPTION_KEY (TOTP / Overwatch secrets). */
  readonly secretBox: SecretBox;
  /** Per-route rate limit configs: `config: { rateLimit: deps.rateLimits.auth }`. */
  readonly rateLimits: RouteRateLimits;
  /** Releases everything the container created (not injected overrides). */
  close(): Promise<void>;
}

export interface ContainerOverrides {
  /** Use an existing database (e.g. a test database); the container will not close it. */
  database?: { db: Kysely<Database>; pool: Pool };
  /** Use an existing Redis client (not closed by the container); null forces no Redis. */
  redis?: RedisClient | null;
  store?: ShortLivedStore;
  clock?: Clock;
  logger?: AppLogger;
  storage?: ObjectStorage;
  mailer?: Mailer;
}

export function createContainer(config: Config, overrides: ContainerOverrides = {}): Deps {
  const logger = overrides.logger ?? createLogger({ level: config.logging.level, pretty: config.logging.pretty });
  const clock = overrides.clock ?? systemClock;
  const closers: Array<() => Promise<void>> = [];

  let db: Kysely<Database>;
  let pool: Pool;
  if (overrides.database !== undefined) {
    ({ db, pool } = overrides.database);
  } else {
    const handle = createDatabase({
      connectionString: config.database.url,
      poolMax: config.database.poolMax,
      statementTimeoutMs: config.database.statementTimeoutMs,
      onPoolError: (err) => logger.error({ err }, 'PostgreSQL pool error'),
    });
    ({ db, pool } = handle);
    closers.push(() => handle.destroy());
  }

  let redis: RedisClient | null;
  if (overrides.redis !== undefined) {
    redis = overrides.redis;
  } else if (config.redis.url !== null) {
    const client = createRedis(config.redis.url, {
      keyPrefix: config.redis.keyPrefix,
      onError: (err) => logger.warn({ err: { message: err.message } }, 'Redis connection error'),
    });
    redis = client;
    closers.push(() => closeRedis(client));
  } else {
    redis = null;
  }

  const store = overrides.store ?? (redis !== null ? new RedisShortLivedStore(redis) : new MemoryShortLivedStore({ clock }));
  const mailer = overrides.mailer ?? createMailer(config, clock);
  if (overrides.mailer === undefined) closers.push(() => mailer.close());

  const scheduler = new JobScheduler({ db, store, clock, logger });
  const audit = new AuditService({ db, clock, logger });
  const security = new SecurityService({ config, db, store, clock, logger, audit });
  let closed: Promise<void> | undefined;

  const deps: Deps = {
    config,
    db,
    pool,
    redis,
    store,
    nonceStore: createNonceStore(store),
    clock,
    logger,
    audit,
    security,
    storage: overrides.storage ?? createStorage(config),
    mailer,
    scheduler,
    sessions: new SessionManager({ db, config, clock }),
    secretBox: createSecretBox(config.secrets.dataEncryptionKey),
    rateLimits: createRouteRateLimits(config),
    close(): Promise<void> {
      closed ??= (async () => {
        await scheduler.stop(config.http.shutdownTimeoutMs);
        // Close in reverse creation order; one failure must not keep others open.
        for (const close of [...closers].reverse()) {
          try {
            await close();
          } catch (err) {
            logger.warn({ err }, 'error while closing a dependency');
          }
        }
      })();
      return closed;
    },
  };
  return deps;
}
