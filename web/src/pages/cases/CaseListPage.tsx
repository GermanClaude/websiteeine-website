import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { CASE_STATUSES, CASE_VERDICTS, Permission, type CaseSummary } from '@scpsl-trust/shared';

import { caseKeys, listCases } from '../../api/cases';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { CaseLink, UserIdLink, casePath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { NewCaseModal } from './NewCaseModal';

const FILTER_DEFAULTS = { status: '', verdict: '', player: '', q: '', server_id: '' } as const;

const STATUS_OPTIONS = CASE_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));
const VERDICT_OPTIONS = CASE_VERDICTS.map((value) => ({ value, label: humanizeEnum(value) }));

const columns: readonly Column<CaseSummary>[] = [
  { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} /> },
  { key: 'player', header: 'Player', render: (row) => <UserIdLink userId={row.player.user_id} displayName={row.player.display_name} /> },
  { key: 'verdict', header: 'Verdict', render: (row) => <StatusBadge kind="verdict" value={row.verdict} dot />, sortValue: (row) => row.verdict },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="caseStatus" value={row.status} />, sortValue: (row) => row.status },
  { key: 'reason', header: 'Reason', render: (row) => <span className="truncate" style={{ display: 'inline-block', maxWidth: 320 }} title={row.reason}>{row.reason}</span>, wrap: true },
  {
    key: 'reports',
    header: 'Reports',
    align: 'right',
    render: (row) => (
      <span title={`${row.open_report_count} open of ${row.report_count}`}>
        {row.report_count}
        {row.open_report_count > 0 && <span className="text-muted text-xs"> ({row.open_report_count} open)</span>}
      </span>
    ),
    sortValue: (row) => row.report_count,
  },
  { key: 'evidence', header: 'Evidence', align: 'right', render: (row) => row.evidence_count, sortValue: (row) => row.evidence_count },
  { key: 'confirmations', header: 'Confirmed by', align: 'right', render: (row) => `${row.confirmed_servers} server${row.confirmed_servers === 1 ? '' : 's'}`, sortValue: (row) => row.confirmed_servers },
  { key: 'updated', header: 'Updated', render: (row) => <RelativeTime value={row.updated_at} />, sortValue: (row) => row.updated_at },
];

export function CaseListPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const [createOpen, setCreateOpen] = useState(false);

  const cases = useQuery({
    queryKey: caseKeys.list(filters.query),
    queryFn: () => listCases(filters.query),
    placeholderData: (previous) => previous,
  });

  const canCreate = auth.hasPermission(Permission.CASE_CREATE);
  const seesAll = auth.hasPermission(Permission.CASE_REVIEW);

  return (
    <>
      <PageHeader
        title="Cases"
        subtitle={seesAll ? 'All cases. Report counts and server confirmations never change a verdict.' : 'Cases that your server teams reported or confirmed.'}
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New case
            </Button>
          ) : undefined
        }
      />

      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <SearchField id="cases-q" label="Search" placeholder="Reason, summary…" value={filters.values.q} onChange={(value) => filters.set('q', value)} />
          <FilterSelect id="cases-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
          <FilterSelect id="cases-verdict" label="Verdict" value={filters.values.verdict} onChange={(value) => filters.set('verdict', value)} options={VERDICT_OPTIONS} />
          <SearchField id="cases-player" label="Player user id" placeholder="76561198000000001@steam" value={filters.values.player} onChange={(value) => filters.set('player', value)} />
          <SearchField id="cases-server" label="Server id" placeholder="srv_…" value={filters.values.server_id} onChange={(value) => filters.set('server_id', value)} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={cases.data?.items ?? []}
          rowKey={(row) => row.case_number}
          onRowClick={(row) => void navigate(casePath(row.case_number))}
          rowClickLabel="Open case"
          loading={cases.isPending}
          error={cases.isError ? <ErrorState error={cases.error} onRetry={() => void cases.refetch()} compact /> : undefined}
          emptyState={<EmptyState title="No cases match" description={filters.isFiltered ? 'Try clearing a filter.' : 'Cases are created from reports or by moderators.'} />}
          caption="Cases"
        />
        {cases.data !== undefined && (
          <Pagination
            page={cases.data.page}
            pageSize={cases.data.page_size}
            total={cases.data.total}
            loaded={cases.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>

      {canCreate && <NewCaseModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </>
  );
}

export default CaseListPage;
