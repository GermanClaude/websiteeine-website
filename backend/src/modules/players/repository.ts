/**
 * Players repository: upserts for the check pipeline and read-only queries over
 * players, cases, reports, confirmations, appeals, bypasses, policies, signals,
 * links and sightings (read-only from other modules' tables by design — the
 * check pipeline must not depend on their services).
 *
 * Raw IPs never reach this file: callers pass HMAC network hashes only.
 */
import { sql, type ExpressionBuilder } from 'kysely';

import type { GlobalStatus, PlayerRef, PlayerSearchQuery } from '@scpsl-trust/shared';

import type { Database, DbExecutor, PlayerRow } from '../../db';

const OPEN_REPORT_STATUSES = ['open', 'under_review'] as const;

// ---------------------------------------------------------------------------
// Upserts (check pipeline)
// ---------------------------------------------------------------------------

export async function findPlayer(db: DbExecutor, ref: PlayerRef): Promise<PlayerRow | undefined> {
  return db
    .selectFrom('players')
    .selectAll()
    .where('id_type', '=', ref.type)
    .where('external_id', '=', ref.id)
    .executeTakeFirst();
}

export async function upsertPlayer(db: DbExecutor, ref: PlayerRef, nickname: string | null, now: Date): Promise<PlayerRow> {
  const update: Record<string, unknown> = { last_seen_at: now, updated_at: now };
  if (nickname !== null) update.display_name = nickname;
  return db
    .insertInto('players')
    .values({
      id_type: ref.type,
      external_id: ref.id,
      display_name: nickname,
      first_seen_at: now,
      last_seen_at: now,
    })
    .onConflict((oc) => oc.columns(['id_type', 'external_id']).doUpdateSet(update))
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function upsertSighting(db: DbExecutor, playerId: string, serverId: string, now: Date): Promise<void> {
  await db
    .insertInto('player_server_sightings')
    .values({ player_id: playerId, server_id: serverId, first_seen_at: now, last_seen_at: now, join_count: 1 })
    .onConflict((oc) =>
      oc.columns(['player_id', 'server_id']).doUpdateSet((eb) => ({
        last_seen_at: now,
        join_count: eb('player_server_sightings.join_count', '+', 1),
      })),
    )
    .execute();
}

// ---------------------------------------------------------------------------
// Case aggregation (§6.1)
// ---------------------------------------------------------------------------

export interface PlayerCaseAggregate {
  id: string;
  case_number: string;
  verdict: 'unknown' | 'inconclusive' | 'confirmed' | 'rejected';
  status: 'open' | 'under_review' | 'closed';
  reason: string;
  public_summary: string | null;
  created_at: Date;
  updated_at: Date;
  report_count: number;
  open_report_count: number;
  confirmed_servers: number;
  independent_confirmed_servers: number;
  evidence_count: number;
  latest_appeal_status: 'open' | 'under_review' | 'decided' | 'withdrawn' | null;
}

export async function playerCases(db: DbExecutor, playerId: string): Promise<PlayerCaseAggregate[]> {
  const rows = await db
    .selectFrom('cases as c')
    .where('c.player_id', '=', playerId)
    .select([
      'c.id',
      'c.case_number',
      'c.current_verdict as verdict',
      'c.status',
      'c.reason',
      'c.public_summary',
      'c.created_at',
      'c.updated_at',
    ])
    .select((eb) => [
      eb
        .selectFrom('reports as r')
        .whereRef('r.case_id', '=', 'c.id')
        .where('r.status', '!=', 'rejected')
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('report_count'),
      eb
        .selectFrom('reports as r')
        .whereRef('r.case_id', '=', 'c.id')
        .where('r.status', 'in', [...OPEN_REPORT_STATUSES])
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('open_report_count'),
      eb
        .selectFrom('case_server_confirmations as cc')
        .whereRef('cc.case_id', '=', 'c.id')
        .where('cc.revoked_at', 'is', null)
        .select((qb) => qb.fn.count<number>(qb.ref('cc.server_id')).distinct().as('n'))
        .as('confirmed_servers'),
      eb
        .selectFrom('case_server_confirmations as cc')
        .innerJoin('servers as s', 's.id', 'cc.server_id')
        .whereRef('cc.case_id', '=', 'c.id')
        .where('cc.revoked_at', 'is', null)
        .select((qb) => qb.fn.count<number>(qb.ref('s.owner_user_id')).distinct().as('n'))
        .as('independent_confirmed_servers'),
      eb
        .selectFrom('evidence as e')
        .whereRef('e.case_id', '=', 'c.id')
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('evidence_count'),
      eb
        .selectFrom('appeals as a')
        .whereRef('a.case_id', '=', 'c.id')
        .orderBy('a.created_at', 'desc')
        .limit(1)
        .select('a.status')
        .as('latest_appeal_status'),
    ])
    .orderBy('c.created_at', 'desc')
    .execute();
  return rows.map((row) => ({
    ...row,
    report_count: Number(row.report_count ?? 0),
    open_report_count: Number(row.open_report_count ?? 0),
    confirmed_servers: Number(row.confirmed_servers ?? 0),
    independent_confirmed_servers: Number(row.independent_confirmed_servers ?? 0),
    evidence_count: Number(row.evidence_count ?? 0),
  }));
}

/**
 * §6.1 global status: any confirmed verdict → confirmed; else any case under
 * review → under_review; else any open case with ≥ 1 non-rejected report →
 * reported; else any inconclusive verdict → inconclusive; else any rejected →
 * rejected; else none. The producing case is the most recent (created_at) match.
 */
export function computeGlobalStatus(cases: readonly PlayerCaseAggregate[]): { global_status: GlobalStatus; producingCase: PlayerCaseAggregate | null } {
  // `cases` is ordered created_at DESC, so `find` returns the most recent match.
  const rules: [GlobalStatus, (c: PlayerCaseAggregate) => boolean][] = [
    ['confirmed', (c) => c.verdict === 'confirmed'],
    ['under_review', (c) => c.status === 'under_review'],
    ['reported', (c) => c.status === 'open' && c.report_count > 0],
    ['inconclusive', (c) => c.verdict === 'inconclusive'],
    ['rejected', (c) => c.verdict === 'rejected'],
  ];
  for (const [status, test] of rules) {
    const producing = cases.find(test);
    if (producing !== undefined) return { global_status: status, producingCase: producing };
  }
  return { global_status: 'none', producingCase: null };
}

// ---------------------------------------------------------------------------
// Policies & bypasses (read-only)
// ---------------------------------------------------------------------------

export async function activePolicyInfo(db: DbExecutor, serverUuid: string): Promise<{ version: number; honor_global_bypasses: boolean } | null> {
  const row = await db
    .selectFrom('server_policies')
    .select(['version', 'honor_global_bypasses'])
    .where('server_id', '=', serverUuid)
    .where('is_active', '=', true)
    .executeTakeFirst();
  return row ?? null;
}

export interface ActiveBypassRow {
  id: string;
  type: 'vpn_whitelist' | 'account_age_whitelist' | 'alt_account_whitelist' | 'verdict_override';
  scope: 'server' | 'global';
  expires_at: Date | null;
}

/** Active bypasses considered for a server: server-scoped + (optionally) global. */
export async function activeBypasses(
  db: DbExecutor,
  playerId: string,
  serverUuid: string,
  includeGlobal: boolean,
  now: Date,
  types?: readonly string[],
): Promise<ActiveBypassRow[]> {
  let query = db
    .selectFrom('bypasses')
    .select(['id', 'type', 'scope', 'expires_at'])
    .where('player_id', '=', playerId)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .where((eb) => {
      const scopes = [eb.and([eb('scope', '=', 'server' as const), eb('server_id', '=', serverUuid)])];
      if (includeGlobal) scopes.push(eb.and([eb('scope', '=', 'global' as const)]));
      return eb.or(scopes);
    });
  if (types !== undefined && types.length > 0) {
    query = query.where('type', 'in', types as ActiveBypassRow['type'][]);
  }
  return query.orderBy('created_at', 'desc').execute();
}

// ---------------------------------------------------------------------------
// Search (player:view_staff)
// ---------------------------------------------------------------------------

function globalStatusExpr(eb: ExpressionBuilder<Database, 'players'>) {
  const caseExists = (cond: string) =>
    sql`EXISTS (SELECT 1 FROM cases c WHERE c.player_id = players.id AND ${sql.raw(cond)})`;
  return sql<GlobalStatus>`CASE
    WHEN ${caseExists("c.current_verdict = 'confirmed'")} THEN 'confirmed'
    WHEN ${caseExists("c.status = 'under_review'")} THEN 'under_review'
    WHEN ${sql`EXISTS (SELECT 1 FROM cases c WHERE c.player_id = players.id AND c.status = 'open'
      AND EXISTS (SELECT 1 FROM reports r WHERE r.case_id = c.id AND r.status <> 'rejected'))`} THEN 'reported'
    WHEN ${caseExists("c.current_verdict = 'inconclusive'")} THEN 'inconclusive'
    WHEN ${caseExists("c.current_verdict = 'rejected'")} THEN 'rejected'
    ELSE 'none'
  END`.$castTo<GlobalStatus>() ?? eb.val('none');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export interface PlayerSearchRow extends PlayerRow {
  global_status: GlobalStatus;
  case_count: number;
  open_case_count: number;
}

export async function searchPlayers(
  db: DbExecutor,
  query: PlayerSearchQuery,
  page: { limit: number; offset: number },
): Promise<{ rows: PlayerSearchRow[]; total: number }> {
  const applyFilters = <QB extends { where: (...args: never[]) => QB }>(qb: QB): QB => qb;
  void applyFilters;

  let base = db.selectFrom('players');
  if (query.type !== undefined) base = base.where('id_type', '=', query.type);
  if (query.q !== undefined) {
    const q = query.q;
    // Accept a canonical user id ("<id>@<type>") as an exact identity search.
    const at = q.lastIndexOf('@');
    const canonical = at > 0 ? { id: q.slice(0, at), type: q.slice(at + 1) } : null;
    base = base.where((eb) => {
      const conditions = [
        eb('external_id', '=', q),
        eb(sql`players.display_name`, 'ilike', `%${escapeLike(q)}%`),
      ];
      if (canonical !== null && ['steam', 'discord', 'northwood'].includes(canonical.type)) {
        conditions.push(eb.and([eb('external_id', '=', canonical.id), eb('id_type', '=', canonical.type as PlayerRow['id_type'])]));
      }
      return eb.or(conditions);
    });
  }
  if (query.global_status !== undefined) {
    base = base.where((eb) => eb(globalStatusExpr(eb as ExpressionBuilder<Database, 'players'>), '=', query.global_status!));
  }

  const totalRow = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
  const rows = await base
    .selectAll('players')
    .select((eb) => [
      globalStatusExpr(eb as ExpressionBuilder<Database, 'players'>).as('global_status'),
      eb
        .selectFrom('cases as c')
        .whereRef('c.player_id', '=', 'players.id')
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('case_count'),
      eb
        .selectFrom('cases as c')
        .whereRef('c.player_id', '=', 'players.id')
        .where('c.status', 'in', ['open', 'under_review'])
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('open_case_count'),
    ])
    .orderBy(sql`players.last_seen_at DESC NULLS LAST`)
    .orderBy('players.created_at', 'desc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  return {
    rows: rows.map((row) => ({
      ...row,
      global_status: row.global_status as GlobalStatus,
      case_count: Number(row.case_count ?? 0),
      open_case_count: Number(row.open_case_count ?? 0),
    })) as PlayerSearchRow[],
    total: Number(totalRow?.n ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Staff view details
// ---------------------------------------------------------------------------

export async function linkedUser(db: DbExecutor, playerId: string): Promise<{ id: string; username: string } | null> {
  const row = await db.selectFrom('users').select(['id', 'username']).where('player_id', '=', playerId).executeTakeFirst();
  return row ?? null;
}

export interface SignalRowWithServer {
  id: string;
  signal: 'vpn_detected' | 'possible_alt_account' | 'young_account';
  confidence: string | null;
  source: string;
  detail_codes: string[];
  created_at: Date;
  expires_at: Date | null;
  server_public_id: string | null;
  server_name: string | null;
  server_is_trusted: boolean | null;
}

export async function recentSignals(db: DbExecutor, playerId: string, limit = 50): Promise<SignalRowWithServer[]> {
  return db
    .selectFrom('player_signals as ps')
    .leftJoin('servers as s', 's.id', 'ps.server_id')
    .select([
      'ps.id',
      'ps.signal',
      'ps.confidence',
      'ps.source',
      'ps.detail_codes',
      'ps.created_at',
      'ps.expires_at',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
    ])
    .where('ps.player_id', '=', playerId)
    .orderBy('ps.created_at', 'desc')
    .limit(limit)
    .execute() as Promise<SignalRowWithServer[]>;
}

export interface LinkRowWithPlayer {
  linked_player_id: string;
  signal: 'same_network_identifier' | 'same_network_prefix' | 'linked_account_confirmed_case' | 'linked_account_recently_seen' | 'shared_network_many_accounts' | 'network_is_vpn';
  first_detected_at: Date;
  last_detected_at: Date;
  occurrences: number;
  linked_id_type: 'steam' | 'discord' | 'northwood';
  linked_external_id: string;
  linked_display_name: string | null;
}

export async function playerLinks(db: DbExecutor, playerId: string): Promise<{ links: LinkRowWithPlayer[]; confirmedCasesByPlayer: Map<string, string[]> }> {
  const links = (await db
    .selectFrom('player_links as pl')
    .innerJoin('players as lp', 'lp.id', 'pl.linked_player_id')
    .select([
      'pl.linked_player_id',
      'pl.signal',
      'pl.first_detected_at',
      'pl.last_detected_at',
      'pl.occurrences',
      'lp.id_type as linked_id_type',
      'lp.external_id as linked_external_id',
      'lp.display_name as linked_display_name',
    ])
    .where('pl.player_id', '=', playerId)
    .orderBy('pl.last_detected_at', 'desc')
    .execute()) as LinkRowWithPlayer[];
  const confirmedCasesByPlayer = new Map<string, string[]>();
  const linkedIds = [...new Set(links.map((row) => row.linked_player_id))];
  if (linkedIds.length > 0) {
    const cases = await db
      .selectFrom('cases')
      .select(['player_id', 'case_number'])
      .where('player_id', 'in', linkedIds)
      .where('current_verdict', '=', 'confirmed')
      .orderBy('case_number')
      .execute();
    for (const row of cases) {
      const list = confirmedCasesByPlayer.get(row.player_id) ?? [];
      list.push(row.case_number);
      confirmedCasesByPlayer.set(row.player_id, list);
    }
  }
  return { links, confirmedCasesByPlayer };
}

export interface SightingRowWithServer {
  first_seen_at: Date;
  last_seen_at: Date;
  join_count: number;
  server_public_id: string;
  server_name: string;
  server_is_trusted: boolean;
}

export async function playerSightings(db: DbExecutor, playerId: string): Promise<SightingRowWithServer[]> {
  return db
    .selectFrom('player_server_sightings as ps')
    .innerJoin('servers as s', 's.id', 'ps.server_id')
    .select([
      'ps.first_seen_at',
      'ps.last_seen_at',
      'ps.join_count',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
    ])
    .where('ps.player_id', '=', playerId)
    .orderBy('ps.last_seen_at', 'desc')
    .execute();
}

export interface RecentReportRow {
  id: string;
  case_number: string;
  reporter_type: 'user' | 'server';
  reason: string;
  description: string | null;
  status: 'open' | 'under_review' | 'resolved' | 'rejected';
  resolution_note: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  server_public_id: string | null;
  server_name: string | null;
  server_is_trusted: boolean | null;
  reporter_user_id: string | null;
  reporter_username: string | null;
  reporter_player_id_type: 'steam' | 'discord' | 'northwood' | null;
  reporter_player_external_id: string | null;
  reporter_player_display_name: string | null;
  resolver_reviewer_number: number | null;
  evidence_count: number;
}

export async function recentReports(db: DbExecutor, playerId: string, limit = 10): Promise<RecentReportRow[]> {
  const rows = await db
    .selectFrom('reports as r')
    .innerJoin('cases as c', 'c.id', 'r.case_id')
    .leftJoin('servers as s', 's.id', 'r.server_id')
    .leftJoin('users as ru', 'ru.id', 'r.reporter_user_id')
    .leftJoin('players as rp', 'rp.id', 'r.reporter_player_id')
    .leftJoin('users as resolver', 'resolver.id', 'r.resolved_by')
    .select([
      'r.id',
      'c.case_number',
      'r.reporter_type',
      'r.reason',
      'r.description',
      'r.status',
      'r.resolution_note',
      'r.resolved_at',
      'r.created_at',
      'r.updated_at',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'ru.id as reporter_user_id',
      'ru.username as reporter_username',
      'rp.id_type as reporter_player_id_type',
      'rp.external_id as reporter_player_external_id',
      'rp.display_name as reporter_player_display_name',
      'resolver.reviewer_number as resolver_reviewer_number',
    ])
    .select((eb) =>
      eb
        .selectFrom('evidence as e')
        .whereRef('e.report_id', '=', 'r.id')
        .select((qb) => qb.fn.countAll<number>().as('n'))
        .as('evidence_count'),
    )
    .where('r.player_id', '=', playerId)
    .orderBy('r.created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map((row) => ({ ...row, evidence_count: Number(row.evidence_count ?? 0) })) as RecentReportRow[];
}

export interface BypassViewRow {
  id: string;
  scope: 'server' | 'global';
  type: 'vpn_whitelist' | 'account_age_whitelist' | 'alt_account_whitelist' | 'verdict_override';
  reason: string;
  whitelist_request_id: string | null;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
  server_public_id: string | null;
  server_name: string | null;
  server_is_trusted: boolean | null;
  granted_by_id: string;
  granted_by_username: string;
  revoked_by_id: string | null;
  revoked_by_username: string | null;
}

/** Active bypasses of a player across all scopes/servers (staff view). */
export async function activeBypassViews(db: DbExecutor, playerId: string, now: Date): Promise<BypassViewRow[]> {
  return db
    .selectFrom('bypasses as b')
    .leftJoin('servers as s', 's.id', 'b.server_id')
    .innerJoin('users as g', 'g.id', 'b.granted_by_user_id')
    .leftJoin('users as rv', 'rv.id', 'b.revoked_by')
    .select([
      'b.id',
      'b.scope',
      'b.type',
      'b.reason',
      'b.whitelist_request_id',
      'b.created_at',
      'b.expires_at',
      'b.revoked_at',
      'b.revoke_reason',
      's.server_id as server_public_id',
      's.name as server_name',
      's.is_trusted as server_is_trusted',
      'g.id as granted_by_id',
      'g.username as granted_by_username',
      'rv.id as revoked_by_id',
      'rv.username as revoked_by_username',
    ])
    .where('b.player_id', '=', playerId)
    .where('b.revoked_at', 'is', null)
    .where((eb) => eb.or([eb('b.expires_at', 'is', null), eb('b.expires_at', '>', now)]))
    .orderBy('b.created_at', 'desc')
    .execute() as Promise<BypassViewRow[]>;
}
