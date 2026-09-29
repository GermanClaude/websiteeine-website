/**
 * Reports list (`GET /reports`): report:review sees every report with filters; everyone
 * else implicitly sees only their own reports. Deep-linked from the dashboard (`?status=open`).
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { Permission, REPORT_STATUSES, type ReportListQuery, type ReportView } from '@scpsl-trust/shared';

import { listReports, reportKeys } from '../../api/reports';
import { useAuth } from '../../auth/useAuth';
import { LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { CaseLink, ServerLink, UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { ReporterCell, reportPath } from '../cases/CaseSections';
import { emptyToUndefined, enumFilter } from '../cases/formHelpers';

const FILTER_DEFAULTS = { status: '', case: '', player: '', server_id: '', mine: '' } as const;

const STATUS_OPTIONS = REPORT_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));
const MINE_OPTIONS = [{ value: 'true', label: 'Only my reports' }] as const;

const columns: readonly Column<ReportView>[] = [
  { key: 'created', header: 'Submitted', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} /> },
  { key: 'player', header: 'Player', render: (row) => <UserIdLink userId={row.player.user_id} displayName={row.player.display_name} /> },
  { key: 'reporter', header: 'Reporter', render: (row) => <ReporterCell report={row} /> },
  { key: 'server', header: 'Server', render: (row) => (row.server === null ? <span className="text-faint">—</span> : <ServerLink serverId={row.server.server_id} name={row.server.name} />) },
  { key: 'reason', header: 'Reason', render: (row) => row.reason, wrap: true },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="reportStatus" value={row.status} dot />, sortValue: (row) => row.status },
  { key: 'evidence', header: 'Evidence', align: 'right', render: (row) => row.evidence_count },
];

export function ReportListPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const seesAll = auth.hasPermission(Permission.REPORT_REVIEW);

  const query: Partial<ReportListQuery> = {
    page: filters.page,
    page_size: filters.pageSize,
    status: enumFilter(filters.values.status, REPORT_STATUSES),
    case: emptyToUndefined(filters.values.case)?.toUpperCase(),
    player: emptyToUndefined(filters.values.player),
    server_id: emptyToUndefined(filters.values.server_id),
    mine: seesAll && filters.values.mine === 'true' ? true : undefined,
  };
  const reports = useQuery({
    queryKey: reportKeys.list(query),
    queryFn: () => listReports(query),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          seesAll
            ? 'All reports. Reports are claims, not findings: report counts never change a verdict.'
            : 'Reports you submitted. A report attaches to the player’s open case or opens a new one; reviewers decide the verdict.'
        }
        actions={
          auth.hasPermission(Permission.REPORT_CREATE) ? (
            <LinkButton to="/reports/new" variant="primary">
              New report
            </LinkButton>
          ) : undefined
        }
      />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <FilterSelect id="reports-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
          <SearchField id="reports-case" label="Case number" placeholder="CASE-2026-000001" value={filters.values.case} onChange={(value) => filters.set('case', value)} />
          {seesAll && (
            <>
              <SearchField id="reports-player" label="Player user id" placeholder="76561198000000001@steam" value={filters.values.player} onChange={(value) => filters.set('player', value)} />
              <SearchField id="reports-server" label="Server id" placeholder="srv_…" value={filters.values.server_id} onChange={(value) => filters.set('server_id', value)} />
              <FilterSelect id="reports-mine" label="Scope" value={filters.values.mine} onChange={(value) => filters.set('mine', value)} options={MINE_OPTIONS} allLabel="All reports" />
            </>
          )}
        </FilterBar>
        <DataTable
          columns={columns}
          rows={reports.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => void navigate(reportPath(row.id))}
          rowClickLabel="Open report"
          loading={reports.isPending}
          error={reports.isError ? <ErrorState error={reports.error} onRetry={() => void reports.refetch()} compact /> : undefined}
          emptyState={<EmptyState title="No reports" description={filters.isFiltered ? 'Try clearing a filter.' : seesAll ? 'Nothing has been reported yet.' : 'You have not submitted a report yet.'} />}
          caption="Reports"
        />
        {reports.data !== undefined && (
          <Pagination
            page={reports.data.page}
            pageSize={reports.data.page_size}
            total={reports.data.total}
            loaded={reports.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default ReportListPage;
