/**
 * Players service: the §6.1 check pipeline, §6.2 bypass check and the web views
 * (§13 "Players"). Controllers stay thin; everything here is stateless and built
 * from Deps plus the vpn/account-age/alt sub-services.
 *
 * R1: the check response carries information only — no action is ever computed.
 * §8.1: the raw IP is used transiently; only HMAC hashes are persisted.
 */
import {
  toUserId,
  formatReviewerPseudonym,
  type BypassCheckRequest,
  type BypassCheckResponse,
  type BypassSummary,
  type PlayerCheckRequest,
  type PlayerCheckResponse,
  type PlayerPublicView,
  type PlayerRef,
  type PlayerSearchQuery,
  type PlayerSearchResponse,
  type PlayerStaffView,
  type PlayerViewResponse,
  type ServerRef,
} from '@scpsl-trust/shared';

import type { AuthenticatedServer } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction, type DbExecutor } from '../../db';
import { AppError, notFound } from '../../lib/errors';
import { isPublicIp, networkHashes, type NetworkHashes } from '../../lib/ip';
import { toOffset, paginatedResult } from '../../lib/pagination';
import { toIsoOrNull } from '../../lib/time';
import type { AccountAgeService } from '../account-age';
import type { AltService } from '../alt';
import type { VpnService } from '../vpn';
import type { VpnLookupResult } from '../vpn/types';
import * as repo from './repository';

export interface PlayersServiceDeps {
  deps: Deps;
  vpn: VpnService;
  accountAge: AccountAgeService;
  alt: AltService;
}

function toServerRef(publicId: string | null, name: string | null, isTrusted: boolean | null): ServerRef | null {
  if (publicId === null || name === null) return null;
  return { server_id: publicId, name, is_trusted: isTrusted === true };
}

function bypassSummary(row: repo.ActiveBypassRow): BypassSummary {
  return { id: row.id, type: row.type, scope: row.scope, expires_at: toIsoOrNull(row.expires_at) };
}

export class PlayersService {
  private readonly deps: Deps;
  private readonly vpn: VpnService;
  private readonly accountAge: AccountAgeService;
  private readonly alt: AltService;

  constructor(options: PlayersServiceDeps) {
    this.deps = options.deps;
    this.vpn = options.vpn;
    this.accountAge = options.accountAge;
    this.alt = options.alt;
  }

  /** Hashes only for public addresses — private ranges are shared by everyone. */
  private hashesFor(ip: string | null | undefined): NetworkHashes | null {
    if (ip === null || ip === undefined || !isPublicIp(ip)) return null;
    return networkHashes(ip, this.deps.config.secrets.ipHashSecret);
  }

  // -------------------------------------------------------------------------
  // POST /player/check (§6.1)
  // -------------------------------------------------------------------------

  async check(server: AuthenticatedServer, body: PlayerCheckRequest): Promise<PlayerCheckResponse> {
    const now = this.deps.clock.now();
    const ref: PlayerRef = body.player;
    // VPN lookup first (cached, outside the transaction — it may hit the network).
    const vpnResult = await this.vpn.check(body.ip ?? null);
    const hashes = this.hashesFor(body.ip);

    return withTransaction(this.deps.db, async (tx) => {
      const player = await repo.upsertPlayer(tx, ref, body.nickname ?? null, now);
      await repo.upsertSighting(tx, player.id, server.id, now);
      const age = await this.accountAge.resolve(tx, player, body.account_created_at ?? null);
      const altAnalysis = await this.alt.analyze(tx, {
        playerId: player.id,
        serverId: server.id,
        networkHashes: hashes,
        vpnResult,
        accountAgeDays: age.days,
        now,
      });

      const cases = await repo.playerCases(tx, player.id);
      const { global_status, producingCase } = repo.computeGlobalStatus(cases);
      const policy = await repo.activePolicyInfo(tx, server.id);
      const bypasses = await repo.activeBypasses(tx, player.id, server.id, policy?.honor_global_bypasses === true, now);

      const vpn: PlayerCheckResponse['vpn'] = {
        detected: vpnResult.detected,
        confidence: vpnResult.confidence,
        type: vpnResult.type,
        checked: vpnResult.checked,
      };
      if (vpnResult.error !== undefined) vpn.error = vpnResult.error;

      return {
        player: {
          type: ref.type,
          id: ref.id,
          user_id: toUserId(ref),
          first_seen_at: toIsoOrNull(player.first_seen_at),
        },
        global_status,
        case_id: producingCase?.case_number ?? null,
        cases: cases.map((c) => ({
          case_id: c.case_number,
          verdict: c.verdict,
          status: c.status,
          confirmed_servers: c.confirmed_servers,
        })),
        reports: cases.reduce((sum, c) => sum + c.report_count, 0),
        open_reports: cases.reduce((sum, c) => sum + c.open_report_count, 0),
        confirmed_servers: producingCase?.confirmed_servers ?? 0,
        independent_confirmed_servers: producingCase?.independent_confirmed_servers ?? 0,
        account_age: {
          days: age.days,
          created_at: toIsoOrNull(age.created_at),
          source: age.source,
        },
        vpn,
        bypass: {
          active: bypasses.length > 0,
          types: [...new Set(bypasses.map((b) => b.type))],
          bypasses: bypasses.map(bypassSummary),
        },
        alt_account: altAnalysis,
        policy_version: policy?.version ?? 1,
        checked_at: now.toISOString(),
      } satisfies PlayerCheckResponse;
    });
  }

  // -------------------------------------------------------------------------
  // POST /player/bypass/check (§6.2)
  // -------------------------------------------------------------------------

  async bypassCheck(server: AuthenticatedServer, body: BypassCheckRequest): Promise<BypassCheckResponse> {
    const now = this.deps.clock.now();
    const vpnResult: VpnLookupResult = await this.vpn.check(body.ip ?? null);
    const player = await repo.findPlayer(this.deps.db, body.player);
    let bypasses: repo.ActiveBypassRow[] = [];
    if (player !== undefined) {
      const policy = await repo.activePolicyInfo(this.deps.db, server.id);
      bypasses = await repo.activeBypasses(
        this.deps.db,
        player.id,
        server.id,
        policy?.honor_global_bypasses === true,
        now,
        body.types,
      );
    }
    // The winning bypass is the one with the latest expiry; no expiry wins outright.
    let winner: repo.ActiveBypassRow | null = null;
    for (const bypass of bypasses) {
      if (winner === null) winner = bypass;
      else if (bypass.expires_at === null && winner.expires_at !== null) winner = bypass;
      else if (bypass.expires_at !== null && winner.expires_at !== null && bypass.expires_at > winner.expires_at) winner = bypass;
    }
    return {
      vpn: vpnResult.detected,
      bypass: winner !== null,
      bypass_type: winner?.type ?? null,
      expires_at: winner === null ? null : toIsoOrNull(winner.expires_at),
      bypasses: bypasses.map(bypassSummary),
    };
  }

  // -------------------------------------------------------------------------
  // GET /players (player:view_staff)
  // -------------------------------------------------------------------------

  async search(query: PlayerSearchQuery): Promise<PlayerSearchResponse> {
    const page = { page: query.page, page_size: query.page_size };
    const { rows, total } = await repo.searchPlayers(this.deps.db, query, toOffset(page));
    return paginatedResult(
      rows.map((row) => ({
        user_id: toUserId({ type: row.id_type, id: row.external_id }),
        type: row.id_type,
        id: row.external_id,
        display_name: row.display_name,
        global_status: row.global_status,
        case_count: row.case_count,
        open_case_count: row.open_case_count,
        first_seen_at: toIsoOrNull(row.first_seen_at),
        last_seen_at: toIsoOrNull(row.last_seen_at),
      })),
      total,
      page,
    );
  }

  // -------------------------------------------------------------------------
  // GET /players/{userId}
  // -------------------------------------------------------------------------

  async view(ref: PlayerRef, viewer: { staff: boolean; linkedPlayerId: string | null }): Promise<PlayerViewResponse> {
    const player = await repo.findPlayer(this.deps.db, ref);
    if (player === undefined) throw notFound('Player not found');
    const cases = await repo.playerCases(this.deps.db, player.id);
    const { global_status, producingCase } = repo.computeGlobalStatus(cases);
    const isLinkedViewer = viewer.linkedPlayerId !== null && viewer.linkedPlayerId === player.id;

    const base = {
      global_status,
      case_id: producingCase?.case_number ?? null,
      reports: cases.reduce((sum, c) => sum + c.report_count, 0),
      confirmed_servers: producingCase?.confirmed_servers ?? 0,
    };
    const publicPlayer = {
      user_id: toUserId(ref),
      type: player.id_type,
      id: player.external_id,
      display_name: player.display_name,
      first_seen_at: toIsoOrNull(player.first_seen_at),
    };

    if (!viewer.staff) {
      return {
        view: 'public',
        player: publicPlayer,
        ...base,
        cases: cases.map((c) => ({
          case_number: c.case_number,
          verdict: c.verdict,
          status: c.status,
          public_summary: c.public_summary,
          report_count: c.report_count,
          confirmed_servers: c.confirmed_servers,
          // Appeal status is only shown to the player the case is about.
          appeal_status: isLinkedViewer ? c.latest_appeal_status : null,
          created_at: c.created_at.toISOString(),
          updated_at: c.updated_at.toISOString(),
        })),
      } satisfies PlayerPublicView;
    }

    const now = this.deps.clock.now();
    const [linked, signals, linkData, sightings, reports, bypassRows] = await Promise.all([
      repo.linkedUser(this.deps.db, player.id),
      repo.recentSignals(this.deps.db, player.id),
      repo.playerLinks(this.deps.db, player.id),
      repo.playerSightings(this.deps.db, player.id),
      repo.recentReports(this.deps.db, player.id),
      repo.activeBypassViews(this.deps.db, player.id, now),
    ]);

    return {
      view: 'staff',
      player: {
        ...publicPlayer,
        last_seen_at: toIsoOrNull(player.last_seen_at),
        account_created_at: toIsoOrNull(player.account_created_at),
        account_age_days: this.accountAge.daysSince(player.account_created_at, now),
        account_age_source: player.account_age_source,
        account_age_checked_at: toIsoOrNull(player.account_age_checked_at),
      },
      ...base,
      cases: cases.map((c) => ({
        case_number: c.case_number,
        verdict: c.verdict,
        status: c.status,
        public_summary: c.public_summary,
        report_count: c.report_count,
        confirmed_servers: c.confirmed_servers,
        appeal_status: c.latest_appeal_status,
        created_at: c.created_at.toISOString(),
        updated_at: c.updated_at.toISOString(),
        reason: c.reason,
        open_report_count: c.open_report_count,
        evidence_count: c.evidence_count,
      })),
      linked_user: linked,
      recent_reports: reports.map((r) => ({
        id: r.id,
        case_number: r.case_number,
        player: {
          user_id: toUserId(ref),
          type: player.id_type,
          id: player.external_id,
          display_name: player.display_name,
        },
        server: toServerRef(r.server_public_id, r.server_name, r.server_is_trusted),
        reporter_type: r.reporter_type,
        reporter_user: r.reporter_user_id === null || r.reporter_username === null ? null : { id: r.reporter_user_id, username: r.reporter_username },
        reporter_player:
          r.reporter_player_id_type === null || r.reporter_player_external_id === null
            ? null
            : {
                user_id: toUserId({ type: r.reporter_player_id_type, id: r.reporter_player_external_id }),
                type: r.reporter_player_id_type,
                id: r.reporter_player_external_id,
                display_name: r.reporter_player_display_name,
              },
        reason: r.reason,
        description: r.description,
        status: r.status,
        resolution_note: r.resolution_note,
        resolved_by:
          r.resolved_at === null
            ? null
            : {
                reviewer_number: r.resolver_reviewer_number,
                pseudonym: r.resolver_reviewer_number === null ? 'Reviewer' : formatReviewerPseudonym(r.resolver_reviewer_number),
              },
        resolved_at: toIsoOrNull(r.resolved_at),
        evidence_count: r.evidence_count,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
      })),
      signals: signals.map((s) => ({
        id: s.id,
        signal: s.signal,
        confidence: (s.confidence ?? null) as PlayerStaffView['signals'][number]['confidence'],
        source: s.source,
        detail_codes: s.detail_codes,
        server: toServerRef(s.server_public_id, s.server_name, s.server_is_trusted),
        created_at: s.created_at.toISOString(),
        expires_at: toIsoOrNull(s.expires_at),
      })),
      links: linkData.links.map((l) => ({
        linked_player: {
          user_id: toUserId({ type: l.linked_id_type, id: l.linked_external_id }),
          type: l.linked_id_type,
          id: l.linked_external_id,
          display_name: l.linked_display_name,
        },
        signal: l.signal,
        first_detected_at: l.first_detected_at.toISOString(),
        last_detected_at: l.last_detected_at.toISOString(),
        occurrences: l.occurrences,
        linked_confirmed_cases: linkData.confirmedCasesByPlayer.get(l.linked_player_id) ?? [],
      })),
      sightings: sightings.map((s) => ({
        server: { server_id: s.server_public_id, name: s.server_name, is_trusted: s.server_is_trusted },
        first_seen_at: s.first_seen_at.toISOString(),
        last_seen_at: s.last_seen_at.toISOString(),
        join_count: s.join_count,
      })),
      bypasses: bypassRows.map((b) => ({
        id: b.id,
        player: {
          user_id: toUserId(ref),
          type: player.id_type,
          id: player.external_id,
          display_name: player.display_name,
        },
        scope: b.scope,
        server: toServerRef(b.server_public_id, b.server_name, b.server_is_trusted),
        type: b.type,
        reason: b.reason,
        granted_by: { id: b.granted_by_id, username: b.granted_by_username },
        whitelist_request_id: b.whitelist_request_id,
        created_at: b.created_at.toISOString(),
        expires_at: toIsoOrNull(b.expires_at),
        revoked_at: null,
        revoked_by: null,
        revoke_reason: null,
        active: true,
      })),
    } satisfies PlayerStaffView;
  }
}
