/**
 * Append-only, hash-chained audit log (ARCHITECTURE §9, R8).
 *
 *   hash = sha256_hex(canonical_json(event_without_hashes) + prev_hash), genesis prev = 64 × "0"
 *
 * record() must run inside the transaction of the change it documents. Writers are
 * serialized with pg_advisory_xact_lock(7274001); the chain is ordered by seq. Audit writes
 * require READ COMMITTED (the default): a REPEATABLE READ snapshot taken before the lock
 * could read a stale predecessor hash (the UNIQUE(prev_hash) constraint then rejects it).
 */
import { randomUUID } from 'node:crypto';

import { sql, type Kysely } from 'kysely';

import {
  AUDIT_ADVISORY_LOCK_KEY,
  AUDIT_GENESIS_PREV_HASH,
  auditHashInput,
  type ActorType,
  type AuditAction,
  type AuditVerifyFailure,
  type Paginated,
} from '@scpsl-trust/shared';

import { nextAuditSeq } from '../../db/sequences';
import { withTransaction, type DbExecutor } from '../../db/tx';
import type { AuditEventRow, Database } from '../../db/types';
import { sha256Hex } from '../../lib/crypto';
import type { AppLogger } from '../../lib/logger';
import { paginatedResult, toOffset, type PageQuery } from '../../lib/pagination';
import type { Clock } from '../../lib/time';
import { sanitizeAuditMetadata } from './sanitize';

export interface AuditActor {
  actor_type: ActorType;
  /** users.id for users, `srv_…` for servers, canonical user id for players, null for system/anonymous. */
  actor_id: string | null;
}

export const SYSTEM_ACTOR: AuditActor = Object.freeze({ actor_type: 'system', actor_id: null });

export interface AuditRecordInput {
  actor: AuditActor;
  action: AuditAction;
  /** Lowercase snake_case (AuditTargetType), e.g. "case", "server_key". */
  target_type: string;
  target_id?: string | null;
  /** servers.id (uuid) the event relates to (hashed; used for scoping). */
  server_id?: string | null;
  /** cases.id (uuid) the event relates to (hashed; used for case history). */
  case_id?: string | null;
  /** Sanitized before hashing (no secrets, tokens, raw IPs, content). */
  metadata?: Record<string, unknown>;
  request_id?: string | null;
}

export interface AuditListFilters {
  actor_type?: ActorType;
  actor_id?: string;
  action?: AuditAction;
  target_type?: string;
  target_id?: string;
  /** servers.id (uuid). */
  server_id?: string;
  /** cases.id (uuid). */
  case_id?: string;
  from?: Date;
  to?: Date;
}

export interface AuditEventWithLabel extends AuditEventRow {
  /** username (user actors), `srv_…` (servers), canonical id (players), "system". */
  actor_label: string | null;
}

export interface AuditChainVerification {
  valid: boolean;
  checked: number;
  first_invalid_seq: number | null;
  reason: AuditVerifyFailure | null;
  /** Last event covered by this verification. */
  last_seq: number | null;
  last_hash: string | null;
}

export interface VerifyChainOptions {
  /** Start at this seq (its predecessor's hash is used as the expected prev_hash). */
  fromSeq?: number;
  /** Maximum number of events to check. */
  limit?: number;
  /** Rows fetched per query (default 1000). */
  batchSize?: number;
}

const TARGET_TYPE_REGEX = /^[a-z][a-z_]{0,63}$/;

export interface AuditServiceDeps {
  db: Kysely<Database>;
  clock: Clock;
  logger: AppLogger;
}

/** Hash of an event row (or input) given its predecessor hash. */
export function computeAuditHash(
  event: Pick<
    AuditEventRow,
    | 'seq'
    | 'event_id'
    | 'created_at'
    | 'actor_type'
    | 'actor_id'
    | 'action'
    | 'target_type'
    | 'target_id'
    | 'server_id'
    | 'case_id'
    | 'metadata'
    | 'request_id'
  >,
  prevHash: string,
): string {
  return sha256Hex(auditHashInput(event, prevHash));
}

export class AuditService {
  private readonly db: Kysely<Database>;
  private readonly clock: Clock;
  private readonly logger: AppLogger;

  constructor(deps: AuditServiceDeps) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.logger = deps.logger;
  }

  /**
   * Appends an event. Pass the transaction of the documented change; a plain Kysely
   * instance gets its own transaction (the advisory lock is transaction-scoped).
   */
  async record(executor: DbExecutor, input: AuditRecordInput): Promise<AuditEventRow> {
    if (!TARGET_TYPE_REGEX.test(input.target_type)) {
      throw new TypeError(`Invalid audit target_type "${input.target_type}"`);
    }
    const { metadata, truncated } = sanitizeAuditMetadata(input.metadata);
    if (truncated) this.logger.warn({ action: input.action }, 'audit metadata exceeded the size limit and was truncated');

    return withTransaction(executor, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(${AUDIT_ADVISORY_LOCK_KEY})`.execute(trx);
      const last = await trx
        .selectFrom('audit_events')
        .select('hash')
        .orderBy('seq', 'desc')
        .limit(1)
        .executeTakeFirst();
      const prevHash = last?.hash ?? AUDIT_GENESIS_PREV_HASH;
      const seq = await nextAuditSeq(trx);
      const event = {
        seq,
        event_id: randomUUID(),
        // Date has millisecond precision, matching the DB CHECK and the hashed ISO string.
        created_at: new Date(this.clock.now().getTime()),
        actor_type: input.actor.actor_type,
        actor_id: input.actor.actor_id,
        action: input.action,
        target_type: input.target_type,
        target_id: input.target_id ?? null,
        server_id: input.server_id ?? null,
        case_id: input.case_id ?? null,
        metadata,
        request_id: input.request_id ?? null,
      };
      const hash = computeAuditHash(event, prevHash);
      return trx
        .insertInto('audit_events')
        .values({ ...event, prev_hash: prevHash, hash })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /** Newest first, with actor labels. */
  async list(filters: AuditListFilters, page: Partial<PageQuery>): Promise<Paginated<AuditEventWithLabel>> {
    let query = this.db.selectFrom('audit_events as a');
    if (filters.actor_type !== undefined) query = query.where('a.actor_type', '=', filters.actor_type);
    if (filters.actor_id !== undefined) query = query.where('a.actor_id', '=', filters.actor_id);
    if (filters.action !== undefined) query = query.where('a.action', '=', filters.action);
    if (filters.target_type !== undefined) query = query.where('a.target_type', '=', filters.target_type);
    if (filters.target_id !== undefined) query = query.where('a.target_id', '=', filters.target_id);
    if (filters.server_id !== undefined) query = query.where('a.server_id', '=', filters.server_id);
    if (filters.case_id !== undefined) query = query.where('a.case_id', '=', filters.case_id);
    if (filters.from !== undefined) query = query.where('a.created_at', '>=', filters.from);
    if (filters.to !== undefined) query = query.where('a.created_at', '<=', filters.to);

    const { limit, offset } = toOffset(page);
    const [rows, count] = await Promise.all([
      query
        .leftJoin('users as u', (join) =>
          join.on('a.actor_type', '=', 'user').on(sql`u.id::text`, '=', sql.ref('a.actor_id')),
        )
        .selectAll('a')
        .select('u.username as actor_username')
        .orderBy('a.seq', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      query.select((eb) => eb.fn.countAll<number>().as('total')).executeTakeFirst(),
    ]);
    const items = rows.map(({ actor_username, ...row }) => ({
      ...row,
      actor_label: actorLabel(row.actor_type, row.actor_id, actor_username),
    }));
    return paginatedResult(items, Number(count?.total ?? 0), page);
  }

  /**
   * Recomputes the chain in seq order. Reports the first event whose prev_hash does not
   * match its predecessor (deleted/reordered/forked events) or whose hash does not match
   * its content (edited events).
   */
  async verifyChain(options: VerifyChainOptions = {}): Promise<AuditChainVerification> {
    const batchSize = options.batchSize ?? 1000;
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    let cursor = 0;
    let expectedPrev = AUDIT_GENESIS_PREV_HASH;
    if (options.fromSeq !== undefined && options.fromSeq > 1) {
      cursor = options.fromSeq - 1;
      const predecessor = await this.db
        .selectFrom('audit_events')
        .select('hash')
        .where('seq', '<', options.fromSeq)
        .orderBy('seq', 'desc')
        .limit(1)
        .executeTakeFirst();
      expectedPrev = predecessor?.hash ?? AUDIT_GENESIS_PREV_HASH;
    }

    let checked = 0;
    let lastSeq: number | null = null;
    let lastHash: string | null = null;
    while (checked < limit) {
      const rows = await this.db
        .selectFrom('audit_events')
        .selectAll()
        .where('seq', '>', cursor)
        .orderBy('seq', 'asc')
        .limit(Math.min(batchSize, limit - checked))
        .execute();
      if (rows.length === 0) break;
      for (const row of rows) {
        checked += 1;
        if (row.prev_hash !== expectedPrev) {
          return { valid: false, checked, first_invalid_seq: row.seq, reason: 'prev_hash_mismatch', last_seq: lastSeq, last_hash: lastHash };
        }
        if (computeAuditHash(row, row.prev_hash) !== row.hash) {
          return { valid: false, checked, first_invalid_seq: row.seq, reason: 'hash_mismatch', last_seq: lastSeq, last_hash: lastHash };
        }
        expectedPrev = row.hash;
        lastSeq = row.seq;
        lastHash = row.hash;
        cursor = row.seq;
      }
    }
    return { valid: true, checked, first_invalid_seq: null, reason: null, last_seq: lastSeq, last_hash: lastHash };
  }
}

export function actorLabel(actorType: ActorType, actorId: string | null, username: string | null | undefined): string | null {
  switch (actorType) {
    case 'system':
      return 'system';
    case 'user':
      return username ?? actorId;
    default:
      return actorId;
  }
}
