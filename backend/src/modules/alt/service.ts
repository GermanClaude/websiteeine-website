/**
 * Alt-account analysis (§8.2) — a signal, never an identity claim (R5).
 *
 * Within ALT_LOOKBACK_DAYS other players sharing the same network_hash (exact,
 * strong) or prefix_hash (weak) are correlated:
 * - no other players → possible:false, confidence none;
 * - only prefix matches → low (`same_network_prefix`);
 * - exact match → medium when at most ALT_MAX_SHARED_ACCOUNTS distinct accounts
 *   share the network, else low + `shared_network_many_accounts`;
 * - network detected as VPN/hosting → capped at low (+ `network_is_vpn`);
 * - high only when: exact match AND a linked account has a confirmed case AND
 *   that linked account was seen within 24 h AND this account is younger than
 *   7 days (or of unknown age) — and the VPN cap did not apply.
 *
 * It also records the privacy-preserving artifacts: player_network_observations
 * (hashes only), player_links (both directions) and player_signals rows for
 * possible_alt_account / vpn_detected / young_account. Detail codes are short
 * lowercase codes — never IPs (the DB check enforces the alphabet).
 */
import { AltSignal, type AltConfidence } from '@scpsl-trust/shared';

import type { DbTransaction } from '../../db';
import type { NetworkHashes } from '../../lib/ip';
import type { VpnLookupResult } from '../vpn/types';

export const HIGH_CONFIDENCE_MAX_ACCOUNT_AGE_DAYS = 7;
export const YOUNG_ACCOUNT_DAYS = 7;
export const RECENTLY_SEEN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface AltAnalyzeInput {
  playerId: string;
  /** Server (uuid) that performed the check; recorded on observations/signals. */
  serverId: string;
  networkHashes: NetworkHashes | null;
  vpnResult: VpnLookupResult | null;
  accountAgeDays: number | null;
  now: Date;
}

export interface AltAnalysis {
  possible: boolean;
  confidence: AltConfidence;
  signals: AltSignal[];
  linked_confirmed_cases: string[];
}

export interface AltServiceOptions {
  /** ALT_LOOKBACK_DAYS. */
  lookbackDays: number;
  /** ALT_MAX_SHARED_ACCOUNTS. */
  maxSharedAccounts: number;
}

export class AltService {
  private readonly lookbackDays: number;
  private readonly maxSharedAccounts: number;

  constructor(options: AltServiceOptions) {
    this.lookbackDays = options.lookbackDays;
    this.maxSharedAccounts = options.maxSharedAccounts;
  }

  async analyze(tx: DbTransaction, input: AltAnalyzeInput): Promise<AltAnalysis> {
    const { playerId, serverId, networkHashes, vpnResult, accountAgeDays, now } = input;
    const vpnDetected = vpnResult?.detected === true;
    const analysis = networkHashes === null
      ? { possible: false, confidence: 'none' as AltConfidence, signals: [] as AltSignal[], linked_confirmed_cases: [] as string[] }
      : await this.correlate(tx, playerId, serverId, networkHashes, vpnDetected, accountAgeDays, now);

    await this.recordSignals(tx, input, analysis);
    return analysis;
  }

  private async correlate(
    tx: DbTransaction,
    playerId: string,
    serverId: string,
    hashes: NetworkHashes,
    vpnDetected: boolean,
    accountAgeDays: number | null,
    now: Date,
  ): Promise<AltAnalysis> {
    // 1. Record this observation (hashes only, never the address).
    await tx
      .insertInto('player_network_observations')
      .values({
        player_id: playerId,
        network_hash: hashes.network_hash,
        prefix_hash: hashes.prefix_hash,
        server_id: serverId,
        first_seen_at: now,
        last_seen_at: now,
        seen_count: 1,
      })
      .onConflict((oc) =>
        oc.columns(['player_id', 'network_hash', 'server_id']).doUpdateSet((eb) => ({
          last_seen_at: now,
          seen_count: eb('player_network_observations.seen_count', '+', 1),
          prefix_hash: hashes.prefix_hash,
        })),
      )
      .execute();

    const cutoff = new Date(now.getTime() - this.lookbackDays * DAY_MS);

    // 2. Exact matches: other players seen on the very same network.
    const exactRows = await tx
      .selectFrom('player_network_observations')
      .select(['player_id'])
      .select((eb) => eb.fn.max('last_seen_at').as('last_seen_at'))
      .where('network_hash', '=', hashes.network_hash)
      .where('player_id', '!=', playerId)
      .where('last_seen_at', '>=', cutoff)
      .groupBy('player_id')
      .execute();
    const exactIds = exactRows.map((row) => row.player_id);

    // 3. Weak matches: same /24 (v4) / /48 (v6) prefix, not already exact.
    const prefixRows = await tx
      .selectFrom('player_network_observations')
      .select(['player_id'])
      .distinct()
      .where('prefix_hash', '=', hashes.prefix_hash)
      .where('player_id', '!=', playerId)
      .where('last_seen_at', '>=', cutoff)
      .$if(exactIds.length > 0, (qb) => qb.where('player_id', 'not in', exactIds))
      .execute();
    const prefixIds = prefixRows.map((row) => row.player_id);

    if (exactIds.length === 0 && prefixIds.length === 0) {
      return { possible: false, confidence: 'none', signals: [], linked_confirmed_cases: [] };
    }

    // 4. How many distinct accounts (including this one) share the exact network?
    const shared = await tx
      .selectFrom('player_network_observations')
      .select((eb) => eb.fn.count<number>(eb.ref('player_id')).distinct().as('accounts'))
      .where('network_hash', '=', hashes.network_hash)
      .where('last_seen_at', '>=', cutoff)
      .executeTakeFirst();
    const sharedAccounts = Number(shared?.accounts ?? 0);

    // 5. Confirmed cases of linked accounts (case numbers are public information).
    const linkedIds = [...exactIds, ...prefixIds];
    const confirmedCases = await tx
      .selectFrom('cases')
      .select(['case_number', 'player_id'])
      .where('player_id', 'in', linkedIds)
      .where('current_verdict', '=', 'confirmed')
      .orderBy('case_number')
      .execute();
    const exactIdSet = new Set(exactIds);
    const exactHasConfirmedCase = confirmedCases.some((row) => exactIdSet.has(row.player_id));
    const recentCutoffMs = now.getTime() - RECENTLY_SEEN_MS;
    const exactRecentlySeen = exactRows.some((row) => row.last_seen_at.getTime() >= recentCutoffMs);

    // 6. Confidence.
    const signals = new Set<AltSignal>();
    if (exactIds.length > 0) signals.add(AltSignal.SAME_NETWORK_IDENTIFIER);
    if (prefixIds.length > 0) signals.add(AltSignal.SAME_NETWORK_PREFIX);
    let confidence: AltConfidence;
    if (exactIds.length === 0) {
      confidence = 'low';
    } else if (sharedAccounts > this.maxSharedAccounts) {
      confidence = 'low';
      signals.add(AltSignal.SHARED_NETWORK_MANY_ACCOUNTS);
    } else {
      confidence = 'medium';
    }
    if (exactHasConfirmedCase) signals.add(AltSignal.LINKED_ACCOUNT_CONFIRMED_CASE);
    if (exactIds.length > 0 && exactRecentlySeen) signals.add(AltSignal.LINKED_ACCOUNT_RECENTLY_SEEN);
    if (vpnDetected) {
      // A shared VPN egress is weak evidence: cap at low (R5).
      signals.add(AltSignal.NETWORK_IS_VPN);
      confidence = 'low';
    } else if (
      exactIds.length > 0 &&
      sharedAccounts <= this.maxSharedAccounts &&
      exactHasConfirmedCase &&
      exactRecentlySeen &&
      (accountAgeDays === null || accountAgeDays < HIGH_CONFIDENCE_MAX_ACCOUNT_AGE_DAYS)
    ) {
      confidence = 'high';
    }

    // 7. Record links (both directions so either player's staff page shows them).
    const linkValues = [] as {
      player_id: string;
      linked_player_id: string;
      signal: AltSignal;
      first_detected_at: Date;
      last_detected_at: Date;
      occurrences: number;
    }[];
    for (const [ids, signal] of [
      [exactIds, AltSignal.SAME_NETWORK_IDENTIFIER],
      [prefixIds, AltSignal.SAME_NETWORK_PREFIX],
    ] as const) {
      for (const otherId of ids) {
        for (const [a, b] of [
          [playerId, otherId],
          [otherId, playerId],
        ]) {
          linkValues.push({
            player_id: a!,
            linked_player_id: b!,
            signal,
            first_detected_at: now,
            last_detected_at: now,
            occurrences: 1,
          });
        }
      }
    }
    if (linkValues.length > 0) {
      await tx
        .insertInto('player_links')
        .values(linkValues)
        .onConflict((oc) =>
          oc.columns(['player_id', 'linked_player_id', 'signal']).doUpdateSet((eb) => ({
            last_detected_at: now,
            occurrences: eb('player_links.occurrences', '+', 1),
          })),
        )
        .execute();
    }

    return {
      possible: true,
      confidence,
      signals: [...signals],
      linked_confirmed_cases: [...new Set(confirmedCases.map((row) => row.case_number))],
    };
  }

  /** player_signals history rows (detail codes only — the alphabet excludes IPs). */
  private async recordSignals(tx: DbTransaction, input: AltAnalyzeInput, analysis: AltAnalysis): Promise<void> {
    const { playerId, serverId, vpnResult, accountAgeDays, now } = input;
    const rows: {
      player_id: string;
      server_id: string;
      signal: 'possible_alt_account' | 'vpn_detected' | 'young_account';
      confidence: string | null;
      source: string;
      detail_codes: string[];
      created_at: Date;
    }[] = [];
    if (analysis.possible) {
      rows.push({
        player_id: playerId,
        server_id: serverId,
        signal: 'possible_alt_account',
        confidence: analysis.confidence,
        source: 'alt',
        detail_codes: [...analysis.signals],
        created_at: now,
      });
    }
    if (vpnResult?.detected === true) {
      rows.push({
        player_id: playerId,
        server_id: serverId,
        signal: 'vpn_detected',
        confidence: vpnResult.confidence,
        source: /^[a-z][a-z0-9_-]{0,63}$/.test(vpnResult.provider) ? vpnResult.provider : 'vpn',
        detail_codes: vpnResult.type === null ? [] : [vpnResult.type],
        created_at: now,
      });
    }
    if (accountAgeDays !== null && accountAgeDays < YOUNG_ACCOUNT_DAYS) {
      rows.push({
        player_id: playerId,
        server_id: serverId,
        signal: 'young_account',
        confidence: null,
        source: 'account-age',
        detail_codes: [`under_${YOUNG_ACCOUNT_DAYS}_days`],
        created_at: now,
      });
    }
    if (rows.length > 0) {
      await tx
        .insertInto('player_signals')
        .values(rows.map((row) => ({ ...row, confidence: row.confidence as never })))
        .execute();
    }
  }
}
