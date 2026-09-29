/**
 * Overwatch proof sessions (`GET /overwatch/sessions`, overwatch:view). Sessions never carry a
 * secret; a session only proves who spectated whom and when.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { OVERWATCH_SESSION_STATUSES, type OverwatchSessionListQuery, type OverwatchSessionView } from '@scpsl-trust/shared';

import { listOverwatchSessions, overwatchKeys } from '../../api/overwatch';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { ServerLink, UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { emptyToUndefined, enumFilter } from '../cases/formHelpers';

const FILTER_DEFAULTS = { status: '', server_id: '', target: '', spectator: '' } as const;
const STATUS_OPTIONS = OVERWATCH_SESSION_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));

export function overwatchPath(id: string): string {
  return `/overwatch/${encodeURIComponent(id)}`;
}

const columns: readonly Column<OverwatchSessionView>[] = [
  { key: 'started', header: 'Started', render: (row) => <DateTime value={row.started_at} />, sortValue: (row) => row.started_at },
  { key: 'server', header: 'Server', render: (row) => <ServerLink serverId={row.server.server_id} name={row.server.name} /> },
  { key: 'target', header: 'Target', render: (row) => <UserIdLink userId={row.target.user_id} displayName={row.target.display_name} /> },
  { key: 'spectator', header: 'Spectator', render: (row) => <UserIdLink userId={row.spectator.user_id} displayName={row.spectator.display_name} /> },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="overwatchStatus" value={row.status} dot />, sortValue: (row) => row.status },
  { key: 'end', header: 'Ended', render: (row) => <DateTime value={row.effective_end_at} empty="running" /> },
  { key: 'reason', header: 'End reason', render: (row) => (row.end_reason === null ? <span className="text-faint">—</span> : <StatusBadge kind="overwatchEndReason" value={row.end_reason} />) },
  { key: 'verifiable', header: 'Proofs', render: (row) => (row.proof_verifiable ? <Badge tone="success">verifiable</Badge> : <Badge tone="muted" title="The secret was wiped by retention">no longer verifiable</Badge>) },
  { key: 'id', header: 'Session', render: (row) => <span className="mono text-xs">{row.id.slice(0, 8)}</span> },
];

export function OverwatchListPage() {
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);

  const query: Partial<OverwatchSessionListQuery> = {
    page: filters.page,
    page_size: filters.pageSize,
    status: enumFilter(filters.values.status, OVERWATCH_SESSION_STATUSES),
    server_id: emptyToUndefined(filters.values.server_id),
    target: emptyToUndefined(filters.values.target),
    spectator: emptyToUndefined(filters.values.spectator),
  };
  const sessions = useQuery({
    queryKey: overwatchKeys.list(query),
    queryFn: () => listOverwatchSessions(query),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Overwatch sessions"
        subtitle="Proof sessions started by spectating staff. A verified session proves recording identity, never guilt (R6). Secrets are never shown."
      />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <FilterSelect id="overwatch-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
          <SearchField id="overwatch-server" label="Server id" placeholder="srv_…" value={filters.values.server_id} onChange={(value) => filters.set('server_id', value)} />
          <SearchField id="overwatch-target" label="Target user id" placeholder="76561198000000001@steam" value={filters.values.target} onChange={(value) => filters.set('target', value)} />
          <SearchField id="overwatch-spectator" label="Spectator user id" placeholder="76561198000000002@steam" value={filters.values.spectator} onChange={(value) => filters.set('spectator', value)} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={sessions.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => void navigate(overwatchPath(row.id))}
          rowClickLabel="Open session"
          loading={sessions.isPending}
          error={sessions.isError ? <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} compact /> : undefined}
          emptyState={<EmptyState title="No sessions" description={filters.isFiltered ? 'Try clearing a filter.' : 'Sessions are created by the plugin when staff spectate in Overwatch mode.'} />}
          caption="Overwatch sessions"
        />
        {sessions.data !== undefined && (
          <Pagination
            page={sessions.data.page}
            pageSize={sessions.data.page_size}
            total={sessions.data.total}
            loaded={sessions.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default OverwatchListPage;
