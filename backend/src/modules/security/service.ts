/**
 * SecurityService — the server-side intrusion-detection & anomaly-flagging engine.
 *
 * Detection is entirely server-side: it inspects requests, scores privacy-preserving sources,
 * and transiently blocks abusive ones (429/403) before handler/DB work. It NEVER reaches,
 * attacks or runs code on any client device, and NEVER auto-disables a human account — only
 * the current in-flight requests of a source are throttled; escalation to disabling an
 * account is a human decision surfaced in the monitor.
 *
 * Fail-open: when the short-lived store is unavailable, detection degrades to off (it never
 * blocks legitimate traffic because the store is down) and the request proceeds normally.
 *
 * Privacy: a source is identified by an HMAC network hash (anonymous), a user id (session) or
 * a server id (plugin) — never a raw IP, in the store, the events table, audit metadata or logs.
 */
import {
  securitySeverityRank,
  type SecurityEventKind,
  type SecuritySeverity,
  type SecuritySourceType,
} from '@scpsl-trust/shared';

import type { AuditActor, AuditService } from '../audit/service';
import { SYSTEM_ACTOR } from '../audit/service';
import type { Config } from '../../config';
import { withTransaction } from '../../db/tx';
import type { Database, JsonObject } from '../../db/types';
import { networkHashes } from '../../lib/ip';
import type { AppLogger } from '../../lib/logger';
import { normalizePage, type PageQuery } from '../../lib/pagination';
import type { Clock } from '../../lib/time';
import { storeKeys } from '../../redis/keys';
import type { ShortLivedStore } from '../../redis/store';
import type { Kysely } from 'kysely';
import { AnomalyDetector, type AnomalyFlag } from './anomaly';
import * as repo from './repository';
import { SIGNAL_DEFS, type SignalKind, type MetadataScanResult } from './signals';

export interface SecuritySource {
  type: SecuritySourceType;
  /** Privacy-preserving reference (network hash / user id / server id). null = unknown. */
  ref: string | null;
}

export interface SignalContext {
  endpoint?: string | null;
  requestId?: string | null;
}

interface StoredBlock {
  strikes: number;
  score: number;
  expires_at: number;
}

export interface SecurityServiceDeps {
  config: Config;
  db: Kysely<Database>;
  store: ShortLivedStore;
  clock: Clock;
  logger: AppLogger;
  audit: Pick<AuditService, 'record'>;
}

const BURST_WINDOW_MS = 60_000;
const MAX_BLOCK_TTL_SECONDS = 604_800; // 7 days
const BASELINE_SNAPSHOT_KEY = 'anomaly-baseline';
const MAX_SAMPLE_KEYS = 10_000;

export class SecurityService {
  private readonly config: Config;
  private readonly db: Kysely<Database>;
  private readonly store: ShortLivedStore;
  private readonly clock: Clock;
  private readonly logger: AppLogger;
  private readonly audit: SecurityServiceDeps['audit'];
  private readonly anomaly: AnomalyDetector;
  /** In-process, per-interval activity counts fed to the anomaly detector by the baseline job. */
  private readonly activityCounts = new Map<string, number>();

  constructor(deps: SecurityServiceDeps) {
    this.config = deps.config;
    this.db = deps.db;
    this.store = deps.store;
    this.clock = deps.clock;
    this.logger = deps.logger;
    this.audit = deps.audit;
    this.anomaly = new AnomalyDetector({ sensitivity: deps.config.security.anomalySensitivity });
  }

  get detectionEnabled(): boolean {
    return this.config.security.detectionEnabled;
  }

  get anomalyEnabled(): boolean {
    return this.config.security.anomalyEnabled;
  }

  /** Exposed for unit tests of the deterministic detector. */
  get anomalyDetector(): AnomalyDetector {
    return this.anomaly;
  }

  // -------------------------------------------------------------------------
  // Source helpers
  // -------------------------------------------------------------------------

  /** Network source for an anonymous request (HMAC network hash; unknown for a non-IP). */
  networkSource(ip: string): SecuritySource {
    const hashes = networkHashes(ip, this.config.secrets.ipHashSecret);
    return hashes === null ? { type: 'unknown', ref: null } : { type: 'network', ref: hashes.network_hash };
  }

  private sourceKey(source: SecuritySource): string | null {
    if (source.ref === null || source.type === 'unknown') return null;
    return `${source.type}.${source.ref}`;
  }

  // -------------------------------------------------------------------------
  // Block checks (fast path)
  // -------------------------------------------------------------------------

  /** Fast block check; fail-open (false) when the store is unavailable. */
  async isBlocked(source: SecuritySource): Promise<boolean> {
    if (!this.detectionEnabled) return false;
    const key = this.sourceKey(source);
    if (key === null) return false;
    try {
      return (await this.store.get(storeKeys.securityBlock(key))) !== null;
    } catch (err) {
      this.logger.debug({ err }, 'security: block check skipped (store unavailable)');
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Signal intake & scoring
  // -------------------------------------------------------------------------

  /** Adds the signal's weight to the source's decaying score; blocks on crossing the threshold. */
  async observeSignal(source: SecuritySource, kind: SignalKind, ctx: SignalContext = {}): Promise<void> {
    if (!this.detectionEnabled) return;
    const key = this.sourceKey(source);
    if (key === null) return;
    const def = SIGNAL_DEFS[kind];
    try {
      const windowMs = this.config.security.windowSeconds * 1000;
      const score = await this.store.incrBy(storeKeys.securityScore(key), def.weight, windowMs);
      if (score < this.config.security.blockThreshold) return;
      // Do not re-block a source that is already blocked.
      if ((await this.store.get(storeKeys.securityBlock(key))) !== null) return;
      await this.block(source, key, score, ctx);
    } catch (err) {
      // Fail-open: never turn a detection hiccup into a request failure.
      this.logger.debug({ err, kind }, 'security: signal observation skipped (store unavailable)');
    }
  }

  /** Records low-weight heuristic metadata matches. */
  async observeHeuristics(source: SecuritySource, scan: MetadataScanResult, ctx: SignalContext = {}): Promise<void> {
    if (scan.probe) await this.observeSignal(source, 'injection_probe', ctx);
    if (scan.scanner) await this.observeSignal(source, 'scanner_user_agent', ctx);
  }

  /** Sliding per-minute burst counter; emits a request_burst signal once over the threshold. */
  async observeBurst(source: SecuritySource, ctx: SignalContext = {}): Promise<void> {
    if (!this.detectionEnabled) return;
    const key = this.sourceKey(source);
    if (key === null) return;
    try {
      const count = await this.store.incr(storeKeys.securityBurst(key), BURST_WINDOW_MS);
      if (count > this.config.security.burstPerMinute) {
        await this.observeSignal(source, 'request_burst', ctx);
      }
    } catch (err) {
      this.logger.debug({ err }, 'security: burst counter skipped (store unavailable)');
    }
  }

  private backoffTtlSeconds(strikes: number): number {
    const base = this.config.security.blockTtlSeconds;
    const ttl = base * 2 ** Math.min(strikes - 1, 20);
    return Math.min(ttl, MAX_BLOCK_TTL_SECONDS);
  }

  /** Places a transient block (exponential backoff) and records threshold + block events. */
  private async block(source: SecuritySource, key: string, score: number, ctx: SignalContext): Promise<void> {
    const strikeTtlMs = MAX_BLOCK_TTL_SECONDS * 1000;
    const strikes = await this.store.incr(storeKeys.securityStrikes(key), strikeTtlMs);
    const ttlSeconds = this.backoffTtlSeconds(strikes);
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const blockValue: StoredBlock = { strikes, score, expires_at: expiresAt.getTime() };
    await this.store.set(storeKeys.securityBlock(key), JSON.stringify(blockValue), ttlSeconds * 1000);
    // Reset the score so an active block does not immediately re-trigger.
    await this.store.del(storeKeys.securityScore(key));

    const severity: SecuritySeverity = strikes >= 3 ? 'high' : 'medium';
    const baseMeta: JsonObject = { source_type: source.type, strikes, score, ttl_seconds: ttlSeconds };
    try {
      await withTransaction(this.db, async (trx) => {
        await repo.insertSecurityEvent(trx, {
          kind: 'threshold_exceeded',
          severity,
          source_type: source.type,
          source_ref: source.ref,
          score,
          action_taken: 'none',
          endpoint: ctx.endpoint ?? null,
          request_id: ctx.requestId ?? null,
          metadata: baseMeta,
          created_at: now,
        });
        await this.audit.record(trx, {
          actor: SYSTEM_ACTOR,
          action: 'SECURITY_THRESHOLD_EXCEEDED',
          target_type: 'security_source',
          target_id: source.ref,
          metadata: baseMeta,
          request_id: ctx.requestId ?? null,
        });
        await repo.insertSecurityEvent(trx, {
          kind: 'source_blocked',
          severity,
          source_type: source.type,
          source_ref: source.ref,
          score,
          action_taken: 'blocked',
          endpoint: ctx.endpoint ?? null,
          request_id: ctx.requestId ?? null,
          metadata: baseMeta,
          expires_at: expiresAt,
          created_at: now,
        });
        await this.audit.record(trx, {
          actor: SYSTEM_ACTOR,
          action: 'SECURITY_SOURCE_BLOCKED',
          target_type: 'security_source',
          target_id: source.ref,
          metadata: { ...baseMeta, expires_at: expiresAt.toISOString() },
          request_id: ctx.requestId ?? null,
        });
      });
    } catch (err) {
      // The block (store side) still stands; the audit/event write failing must not crash the request.
      this.logger.error({ err, source_type: source.type }, 'security: failed to persist block event');
    }
    this.logger.warn(
      { event: 'security_source_blocked', source_type: source.type, strikes, ttl_seconds: ttlSeconds, score },
      'security: source auto-blocked',
    );
  }

  // -------------------------------------------------------------------------
  // Admin actions
  // -------------------------------------------------------------------------

  /** Parses a `<type>.<ref>` block id into a source, or null when malformed. */
  parseBlockId(id: string): SecuritySource | null {
    const idx = id.indexOf('.');
    if (idx <= 0) return null;
    const type = id.slice(0, idx) as SecuritySourceType;
    const ref = id.slice(idx + 1);
    if (!['network', 'user', 'server', 'unknown'].includes(type) || ref.length === 0) return null;
    return { type, ref };
  }

  /** Clears a transient block (admin action). Audited; records a source_unblocked event. */
  async clearBlock(
    source: SecuritySource,
    audit: { actor: AuditActor; request_id: string },
    reason: string | null,
  ): Promise<{ cleared: boolean }> {
    const key = this.sourceKey(source);
    if (key === null) return { cleared: false };
    let storeExisted = false;
    try {
      storeExisted = (await this.store.getDel(storeKeys.securityBlock(key))) !== null;
      await this.store.del(storeKeys.securityScore(key));
    } catch (err) {
      this.logger.warn({ err }, 'security: clearing store block failed');
    }
    const tableActive = await repo.hasActiveBlock(this.db, source.type, source.ref as string, this.clock.now());
    const cleared = storeExisted || tableActive;
    if (!cleared) return { cleared: false };

    const meta: JsonObject = { source_type: source.type, reason };
    await withTransaction(this.db, async (trx) => {
      await repo.insertSecurityEvent(trx, {
        kind: 'source_unblocked',
        severity: 'info',
        source_type: source.type,
        source_ref: source.ref,
        action_taken: 'unblocked',
        request_id: audit.request_id,
        metadata: meta,
        created_at: this.clock.now(),
      });
      await this.audit.record(trx, {
        actor: audit.actor,
        action: 'SECURITY_SOURCE_UNBLOCKED',
        target_type: 'security_source',
        target_id: source.ref,
        metadata: meta,
        request_id: audit.request_id,
      });
    });
    return { cleared: true };
  }

  // -------------------------------------------------------------------------
  // Queries (monitor)
  // -------------------------------------------------------------------------

  listEvents(filters: repo.SecurityEventFilters, page: Partial<PageQuery>): Promise<{ items: repo.SecurityEventRecord[]; total: number }> {
    return repo.listSecurityEvents(this.db, filters, page);
  }

  async listActiveBlocks(): Promise<Array<repo.ActiveBlockRecord & { ttl_seconds: number }>> {
    const now = this.clock.now();
    const blocks = await repo.listActiveBlocks(this.db, now);
    return blocks.map((block) => ({
      ...block,
      ttl_seconds: Math.max(0, Math.ceil((block.expires_at.getTime() - now.getTime()) / 1000)),
    }));
  }

  async summary(): Promise<{
    eventsBySeverity: Record<SecuritySeverity, number>;
    totalEvents: number;
    anomalies: number;
    activeBlocks: number;
    topSources: Array<{ source_type: SecuritySourceType; source_ref: string; event_count: number; max_severity: SecuritySeverity }>;
  }> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [bySeverity, anomalies, topSources, activeBlocks] = await Promise.all([
      repo.countBySeveritySince(this.db, since),
      repo.countKindSince(this.db, 'anomaly', since),
      repo.topSourcesSince(this.db, since, 10),
      repo.listActiveBlocks(this.db, now),
    ]);
    const eventsBySeverity: Record<SecuritySeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    let totalEvents = 0;
    for (const row of bySeverity) {
      eventsBySeverity[row.severity] = row.count;
      totalEvents += row.count;
    }
    const severities: SecuritySeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    return {
      eventsBySeverity,
      totalEvents,
      anomalies,
      activeBlocks: activeBlocks.length,
      topSources: topSources.map((row) => ({
        source_type: row.source_type,
        source_ref: row.source_ref,
        event_count: row.event_count,
        max_severity: severities[Math.max(0, Math.min(4, row.max_severity_rank))] ?? 'info',
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Anomaly flagging (review items only)
  // -------------------------------------------------------------------------

  /** Cheap in-process per-interval activity sample for a per-actor baseline. */
  recordActivitySample(source: SecuritySource, endpoint: string | null): void {
    if (!this.anomalyEnabled) return;
    if (source.type !== 'user' && source.type !== 'server') return;
    const key = this.sourceKey(source);
    if (key === null) return;
    if (this.activityCounts.size >= MAX_SAMPLE_KEYS && !this.activityCounts.has(key)) return;
    this.activityCounts.set(key, (this.activityCounts.get(key) ?? 0) + 1);
    if (endpoint !== null) {
      const epKey = `endpoint.${endpoint}`;
      if (this.activityCounts.size < MAX_SAMPLE_KEYS || this.activityCounts.has(epKey)) {
        this.activityCounts.set(epKey, (this.activityCounts.get(epKey) ?? 0) + 1);
      }
    }
  }

  /** Test seam: feeds an explicit interval of per-key counts (bypasses the in-process buffer). */
  async evaluateAnomalyInterval(counts: Map<string, number>, now: Date): Promise<AnomalyFlag[]> {
    const flags: AnomalyFlag[] = [];
    for (const [key, value] of counts) {
      const flag = this.anomaly.observe(key, value, now);
      if (flag !== null) flags.push(flag);
    }
    if (flags.length > 0) await this.persistAnomalies(flags, now);
    return flags;
  }

  private sourceFromSampleKey(key: string): { type: SecuritySourceType; ref: string } {
    const idx = key.indexOf('.');
    const type = key.slice(0, idx);
    const ref = key.slice(idx + 1);
    if (type === 'user' || type === 'server') return { type, ref };
    return { type: 'unknown', ref: key };
  }

  private async persistAnomalies(flags: AnomalyFlag[], now: Date): Promise<void> {
    for (const flag of flags) {
      const source = this.sourceFromSampleKey(flag.key);
      try {
        await repo.insertSecurityEvent(this.db, {
          kind: 'anomaly',
          severity: flag.severity,
          source_type: source.type,
          source_ref: source.ref,
          action_taken: 'flagged',
          metadata: {
            reason: flag.reason,
            value: flag.value,
            baseline_mean: flag.mean,
            deviation: flag.deviation,
          },
          created_at: now,
        });
      } catch (err) {
        this.logger.error({ err }, 'security: failed to record anomaly');
      }
    }
    if (flags.length > 0) {
      this.logger.warn({ event: 'security_anomalies_flagged', count: flags.length }, 'security: anomalies flagged for review');
    }
  }

  /** Baseline job: drains the activity buffer, flags deviations, snapshots and prunes baselines. */
  async runAnomalyBaseline(now: Date = this.clock.now()): Promise<{ samples: number; anomalies: number; pruned: number }> {
    if (!this.anomalyEnabled) return { samples: 0, anomalies: 0, pruned: 0 };
    const counts = new Map(this.activityCounts);
    this.activityCounts.clear();
    await this.loadBaselineSnapshot();
    const flags = await this.evaluateAnomalyInterval(counts, now);
    const pruned = this.anomaly.prune(now, this.config.security.windowSeconds * 1000 * 48);
    await this.saveBaselineSnapshot();
    return { samples: counts.size, anomalies: flags.length, pruned };
  }

  private async loadBaselineSnapshot(): Promise<void> {
    try {
      const raw = await this.store.get(storeKeys.lock(BASELINE_SNAPSHOT_KEY));
      if (raw !== null) this.anomaly.load(JSON.parse(raw) as Record<string, never>);
    } catch (err) {
      this.logger.debug({ err }, 'security: anomaly baseline load skipped');
    }
  }

  private async saveBaselineSnapshot(): Promise<void> {
    try {
      const ttlMs = this.config.security.windowSeconds * 1000 * 96;
      await this.store.set(storeKeys.lock(BASELINE_SNAPSHOT_KEY), JSON.stringify(this.anomaly.snapshot()), ttlMs);
    } catch (err) {
      this.logger.debug({ err }, 'security: anomaly baseline save skipped');
    }
  }
}

/** Rank helper re-export for views. */
export { securitySeverityRank };
