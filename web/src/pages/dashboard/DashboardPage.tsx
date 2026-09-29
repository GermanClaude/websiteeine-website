import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import { AuditTargetType, Permission, isCaseNumber, type AuditEventSummary, type DashboardCounts, type ServerSummary } from '@scpsl-trust/shared';

import { getDashboard } from '../../api/dashboard';
import { dashboardKeys } from '../../api/keys';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, StatCard } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { CaseLink, ServerLink, serverPath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { shortFingerprint } from '../../lib/format';

interface StatDefinition {
  key: keyof DashboardCounts;
  label: string;
  to: string;
}

/** Each tile deep-links into the matching filtered list (filters live in the query string). */
const STATS: readonly StatDefinition[] = [
  { key: 'open_cases', label: 'Open cases', to: '/cases?status=open' },
  { key: 'cases_under_review', label: 'Cases under review', to: '/cases?status=under_review' },
  { key: 'pending_reports', label: 'Pending reports', to: '/reports?status=open' },
  { key: 'pending_appeals', label: 'Pending appeals', to: '/appeals?status=open' },
  { key: 'evidence_awaiting_review', label: 'Evidence awaiting review', to: '/evidence?status=unverified' },
  { key: 'pending_whitelist_requests', label: 'Whitelist requests', to: '/whitelist-requests?status=pending' },
];

const serverColumns: readonly Column<ServerSummary>[] = [
  { key: 'name', header: 'Server', render: (row) => <ServerLink serverId={row.server_id} name={row.name} />, sortValue: (row) => row.name },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="serverStatus" value={row.status} dot />, sortValue: (row) => row.status },
  { key: 'trusted', header: 'Trusted', render: (row) => (row.is_trusted ? <Badge tone="success">Trusted</Badge> : <span className="text-faint">—</span>) },
  {
    key: 'fingerprint',
    header: 'Key fingerprint',
    render: (row) => (
      <span className="mono" title={row.key_fingerprint ?? undefined}>
        {shortFingerprint(row.key_fingerprint)}
      </span>
    ),
  },
  { key: 'plugin', header: 'Plugin', render: (row) => row.plugin_version ?? <span className="text-faint">—</span> },
  { key: 'seen', header: 'Last seen', render: (row) => <RelativeTime value={row.last_seen_at} empty="never" />, sortValue: (row) => row.last_seen_at },
  {
    key: 'role',
    header: 'Your role',
    render: (row) => (row.member_role === null ? <span className="text-faint">admin access</span> : <StatusBadge kind="serverMemberRole" value={row.member_role} />),
  },
];

function AuditTarget({ event }: { event: AuditEventSummary }) {
  if (event.target_id === null) return <span className="text-muted">{humanizeEnum(event.target_type)}</span>;
  if (event.target_type === AuditTargetType.CASE && isCaseNumber(event.target_id)) return <CaseLink caseNumber={event.target_id} />;
  return (
    <span>
      <span className="text-muted">{humanizeEnum(event.target_type)}</span> <span className="mono text-xs">{event.target_id}</span>
    </span>
  );
}

const auditColumns: readonly Column<AuditEventSummary>[] = [
  { key: 'time', header: 'When', render: (row) => <RelativeTime value={row.created_at} /> },
  { key: 'action', header: 'Event', render: (row) => <StatusBadge kind="auditAction" value={row.action} /> },
  {
    key: 'actor',
    header: 'Actor',
    render: (row) => (
      <span className="row" style={{ gap: 6 }}>
        <StatusBadge kind="actorType" value={row.actor_type} />
        {row.actor_label !== null && <span>{row.actor_label}</span>}
      </span>
    ),
  },
  { key: 'target', header: 'Target', render: (row) => <AuditTarget event={row} /> },
];

export function DashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const dashboard = useQuery({ queryKey: dashboardKeys.summary, queryFn: getDashboard, refetchInterval: 60_000 });

  if (dashboard.isPending) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <LoadingState />
      </>
    );
  }
  if (dashboard.isError) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
      </>
    );
  }

  const data = dashboard.data;
  const stats = STATS.filter((stat) => data.counts[stat.key] !== null);
  const showServers =
    data.servers.length > 0 || auth.hasServerMembership || auth.hasAnyPermission([Permission.SERVER_CREATE, Permission.SERVER_MANAGE_ANY]);
  const canViewAudit = auth.hasPermission(Permission.AUDIT_VIEW);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          <>
            Updated <RelativeTime value={data.generated_at} />
          </>
        }
        actions={
          <Button size="sm" onClick={() => void dashboard.refetch()} loading={dashboard.isFetching}>
            Refresh
          </Button>
        }
      />

      <div className="stack">
        {stats.length > 0 ? (
          <div className="stat-grid">
            {stats.map((stat) => (
              <StatCard key={stat.key} label={stat.label} value={data.counts[stat.key]} to={stat.to} />
            ))}
          </div>
        ) : (
          <Card title="Welcome">
            <p className="text-sm">
              Link your in-game account under <Link to="/account">Profile</Link> to submit appeals and whitelist requests, or view a public case under{' '}
              <Link to="/tools/case-lookup">Public case lookup</Link>.
            </p>
          </Card>
        )}

        {showServers && (
          <Card
            title="Servers"
            flush
            actions={
              auth.hasAnyPermission([Permission.SERVER_CREATE, Permission.SERVER_MANAGE_ANY]) || auth.hasServerMembership ? (
                <Link to="/servers" className="btn btn-sm">
                  Manage servers
                </Link>
              ) : undefined
            }
          >
            <DataTable
              columns={serverColumns}
              rows={data.servers}
              rowKey={(row) => row.server_id}
              onRowClick={(row) => void navigate(serverPath(row.server_id))}
              rowClickLabel="Open server"
              emptyState={<EmptyState title="No servers" description="Create a server to get a registration token for the plugin." />}
            />
          </Card>
        )}

        {(data.recent_audit_events.length > 0 || canViewAudit) && (
          <Card
            title="Recent activity"
            flush
            actions={
              canViewAudit ? (
                <Link to="/admin/audit" className="btn btn-sm">
                  Full audit log
                </Link>
              ) : undefined
            }
          >
            <DataTable
              columns={auditColumns}
              rows={data.recent_audit_events}
              rowKey={(row) => row.event_id}
              emptyState={<EmptyState title="No recent events" />}
            />
          </Card>
        )}
      </div>
    </>
  );
}

export default DashboardPage;
