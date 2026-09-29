/**
 * Player search (`GET /players?q=`, player:view_staff): identity, global status and case counts.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { GLOBAL_STATUSES, PLAYER_ID_TYPES, type PlayerSearchItem, type PlayerSearchQuery } from '@scpsl-trust/shared';

import { playerKeys, searchPlayers } from '../../api/players';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { UserIdLink, playerPath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { emptyToUndefined, enumFilter } from '../cases/formHelpers';

const FILTER_DEFAULTS = { q: '', type: '', global_status: '' } as const;

const TYPE_OPTIONS = PLAYER_ID_TYPES.map((value) => ({ value, label: humanizeEnum(value) }));
const GLOBAL_STATUS_OPTIONS = GLOBAL_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));

const columns: readonly Column<PlayerSearchItem>[] = [
  { key: 'player', header: 'Player', render: (row) => <UserIdLink userId={row.user_id} displayName={row.display_name} /> },
  { key: 'type', header: 'Identity', render: (row) => <StatusBadge kind="playerIdType" value={row.type} /> },
  { key: 'status', header: 'Global status', render: (row) => <StatusBadge kind="globalStatus" value={row.global_status} dot />, sortValue: (row) => row.global_status },
  {
    key: 'cases',
    header: 'Cases',
    align: 'right',
    render: (row) => (
      <span>
        {row.case_count}
        {row.open_case_count > 0 && <span className="text-muted text-xs"> ({row.open_case_count} open)</span>}
      </span>
    ),
    sortValue: (row) => row.case_count,
  },
  { key: 'first', header: 'First seen', render: (row) => <DateTime value={row.first_seen_at} />, sortValue: (row) => row.first_seen_at },
  { key: 'last', header: 'Last seen', render: (row) => <DateTime value={row.last_seen_at} />, sortValue: (row) => row.last_seen_at },
];

export function PlayerSearchPage() {
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);

  const query: Partial<PlayerSearchQuery> = {
    page: filters.page,
    page_size: filters.pageSize,
    q: emptyToUndefined(filters.values.q),
    type: enumFilter(filters.values.type, PLAYER_ID_TYPES),
    global_status: enumFilter(filters.values.global_status, GLOBAL_STATUSES),
  };
  const players = useQuery({
    queryKey: playerKeys.list(query),
    queryFn: () => searchPlayers(query),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title="Players" subtitle="Search by user id or display name. The global status reflects the player's most significant case; it is information, never an enforcement decision." />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <SearchField id="players-q" label="Search" placeholder="76561198000000001@steam or a name" value={filters.values.q} onChange={(value) => filters.set('q', value)} />
          <FilterSelect id="players-type" label="Identity type" value={filters.values.type} onChange={(value) => filters.set('type', value)} options={TYPE_OPTIONS} />
          <FilterSelect id="players-status" label="Global status" value={filters.values.global_status} onChange={(value) => filters.set('global_status', value)} options={GLOBAL_STATUS_OPTIONS} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={players.data?.items ?? []}
          rowKey={(row) => row.user_id}
          onRowClick={(row) => void navigate(playerPath(row.user_id))}
          rowClickLabel="Open player"
          loading={players.isPending}
          error={players.isError ? <ErrorState error={players.error} onRetry={() => void players.refetch()} compact /> : undefined}
          emptyState={<EmptyState title="No players match" description={filters.isFiltered ? 'Try a different search.' : 'Players appear once a server has seen them or a report names them.'} />}
          caption="Players"
        />
        {players.data !== undefined && (
          <Pagination
            page={players.data.page}
            pageSize={players.data.page_size}
            total={players.data.total}
            loaded={players.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default PlayerSearchPage;
