/**
 * Dashboard aggregation (§13 "Dashboard"). Every area is scoped independently:
 * counts are null when the caller has no access to that area, staff see global
 * numbers, server teams their servers, players their own submissions.
 */
import { Permission, type AuditEventSummary, type DashboardResponse, type ServerSummary } from '@scpsl-trust/shared';

import { userHasPermission } from '../../auth/rbac';
import type { AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { memberServerUuids } from '../cases/repository';
import * as repo from './repository';

const RECENT_AUDIT_LIMIT = 20;

function toServerSummary(row: repo.DashboardServerRow): ServerSummary {
  return {
    server_id: row.server_id,
    name: row.name,
    status: row.status,
    is_trusted: row.is_trusted,
    key_fingerprint: row.key_fingerprint,
    plugin_version: row.plugin_version,
    last_seen_at: row.last_seen_at?.toISOString() ?? null,
    member_role: row.member_role,
  };
}

function toAuditSummary(row: repo.RecentAuditRow): AuditEventSummary {
  return {
    seq: row.seq,
    event_id: row.event_id,
    created_at: row.created_at.toISOString(),
    action: row.action,
    actor_type: row.actor_type,
    actor_label: row.actor_type === 'user' ? row.actor_username : row.actor_id,
    target_type: row.target_type,
    target_id: row.target_id,
  };
}

export class DashboardService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  async build(user: AuthenticatedUser): Promise<DashboardResponse> {
    const staff = userHasPermission(user, Permission.DASHBOARD_STAFF);
    const serverUuids = await memberServerUuids(this.db, user.id);
    const hasMemberships = serverUuids.length > 0;

    const [
      openCases,
      casesUnderReview,
      pendingReports,
      pendingAppeals,
      evidenceAwaitingReview,
      pendingWhitelistRequests,
      servers,
      recentAuditEvents,
    ] = await Promise.all([
      this.caseCount(user, 'open', staff, serverUuids),
      this.caseCount(user, 'under_review', staff, serverUuids),
      this.reportsCount(user, serverUuids),
      this.appealsCount(user),
      userHasPermission(user, Permission.EVIDENCE_REVIEW) ? repo.countEvidenceAwaitingReview(this.db) : null,
      this.whitelistCount(user, serverUuids),
      this.servers(user, hasMemberships),
      this.recentAuditEvents(user, serverUuids),
    ]);

    return {
      counts: {
        open_cases: openCases,
        cases_under_review: casesUnderReview,
        pending_reports: pendingReports,
        pending_appeals: pendingAppeals,
        evidence_awaiting_review: evidenceAwaitingReview,
        pending_whitelist_requests: pendingWhitelistRequests,
      },
      servers,
      recent_audit_events: recentAuditEvents,
      generated_at: this.deps.clock.now().toISOString(),
    };
  }

  private caseCount(
    _user: AuthenticatedUser,
    status: 'open' | 'under_review',
    staff: boolean,
    serverUuids: string[],
  ): Promise<number> | null {
    if (staff) return repo.countCasesByStatus(this.db, status);
    if (serverUuids.length > 0) return repo.countCasesByStatus(this.db, status, serverUuids);
    return null;
  }

  private reportsCount(user: AuthenticatedUser, serverUuids: string[]): Promise<number> | null {
    if (userHasPermission(user, Permission.REPORT_REVIEW)) return repo.countPendingReports(this.db, { all: true });
    if (serverUuids.length > 0) return repo.countPendingReports(this.db, { serverUuids });
    return repo.countPendingReports(this.db, { reporterUserId: user.id });
  }

  private appealsCount(user: AuthenticatedUser): Promise<number> {
    if (userHasPermission(user, Permission.APPEAL_DECIDE)) return repo.countPendingAppeals(this.db, { all: true });
    return repo.countPendingAppeals(this.db, { submittedById: user.id });
  }

  private whitelistCount(user: AuthenticatedUser, serverUuids: string[]): Promise<number> {
    if (userHasPermission(user, Permission.WHITELIST_DECIDE_ANY)) {
      return repo.countPendingWhitelistRequests(this.db, { all: true });
    }
    if (serverUuids.length > 0) return repo.countPendingWhitelistRequests(this.db, { serverUuids });
    return repo.countPendingWhitelistRequests(this.db, { requesterUserId: user.id });
  }

  private async servers(user: AuthenticatedUser, hasMemberships: boolean): Promise<ServerSummary[]> {
    const all = userHasPermission(user, Permission.SERVER_MANAGE_ANY);
    if (!all && !hasMemberships) return [];
    const rows = await repo.listDashboardServers(this.db, user.id, { all });
    return rows.map(toServerSummary);
  }

  private async recentAuditEvents(user: AuthenticatedUser, serverUuids: string[]): Promise<AuditEventSummary[]> {
    if (userHasPermission(user, Permission.AUDIT_VIEW)) {
      const { items } = await this.deps.audit.list({}, { page: 1, page_size: RECENT_AUDIT_LIMIT });
      return items.map((e) => ({
        seq: e.seq,
        event_id: e.event_id,
        created_at: e.created_at instanceof Date ? e.created_at.toISOString() : String(e.created_at),
        action: e.action,
        actor_type: e.actor_type,
        actor_label: e.actor_label ?? null,
        target_type: e.target_type,
        target_id: e.target_id,
      }));
    }
    if (serverUuids.length > 0) {
      const rows = await repo.recentAuditEventsForServers(this.db, serverUuids, RECENT_AUDIT_LIMIT);
      return rows.map(toAuditSummary);
    }
    return [];
  }
}
