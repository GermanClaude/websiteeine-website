import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { Permission, SERVER_STATUSES, type ServerSummary } from '@scpsl-trust/shared';

import { listServers, serverKeys } from '../../api/servers';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { ServerLink, serverPath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { shortFingerprint } from '../../lib/format';
import { isServerOnline } from './serverUtils';

const FILTER_DEFAULTS = { q: '', status: '' };
const STATUS_OPTIONS = SERVER_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }));

export function OnlineIndicator({ lastSeenAt, status }: { lastSeenAt: string | null; status: ServerSummary['status'] }) {
  if (status !== 'active') return null;
  const online = isServerOnline(lastSeenAt);
  return (
    <Badge tone={online ? 'success' : 'muted'} dot title={online ? 'Heartbeat received recently' : 'No recent heartbeat'}>
      {online ? 'Online' : 'Offline'}
    </Badge>
  );
}

const columns: readonly Column<ServerSummary>[] = [
  { key: 'name', header: 'Server', render: (row) => <ServerLink serverId={row.server_id} name={row.name} />, sortValue: (row) => row.name },
  { key: 'id', header: 'Server id', render: (row) => <span className="mono text-xs">{row.server_id}</span> },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <span className="row" style={{ gap: 6 }}>
        <StatusBadge kind="serverStatus" value={row.status} dot />
        <OnlineIndicator lastSeenAt={row.last_seen_at} status={row.status} />
      </span>
    ),
    sortValue: (row) => row.status,
  },
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

export function ServerListPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const servers = useQuery({ queryKey: serverKeys.list(filters.query), queryFn: () => listServers(filters.query), placeholderData: (previous) => previous });
  const canCreate = auth.hasPermission(Permission.SERVER_CREATE);
  const seesAll = auth.hasPermission(Permission.SERVER_MANAGE_ANY);

  return (
    <>
      <PageHeader
        title={seesAll ? 'Servers' : 'My servers'}
        subtitle={seesAll ? 'Every registered server (server:manage_any).' : 'Servers where you are a team member.'}
        actions={
          canCreate ? (
            <LinkButton to="/servers/new" variant="primary">
              Register new server
            </LinkButton>
          ) : undefined
        }
      />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <SearchField value={filters.values.q} onChange={(value) => filters.set('q', value)} placeholder="Name or server id" />
          <FilterSelect id="server-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={servers.data?.items ?? []}
          rowKey={(row) => row.server_id}
          loading={servers.isPending}
          error={servers.isError ? <ErrorState error={servers.error} compact onRetry={() => void servers.refetch()} /> : undefined}
          onRowClick={(row) => void navigate(serverPath(row.server_id))}
          rowClickLabel="Open server"
          emptyState={
            <EmptyState
              title="No servers"
              description={canCreate ? 'Register a server to get a registration token for the plugin.' : 'Ask a server owner to add you to their team.'}
              action={canCreate ? <LinkButton to="/servers/new">Register new server</LinkButton> : undefined}
            />
          }
        />
        {servers.data !== undefined && (
          <Pagination
            page={servers.data.page}
            pageSize={servers.data.page_size}
            total={servers.data.total}
            loaded={servers.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default ServerListPage;
