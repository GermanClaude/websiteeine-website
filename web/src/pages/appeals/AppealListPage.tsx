/**
 * /appeals — reviewers (appeal:decide) see every appeal with filters; everyone else sees their own.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { APPEAL_STATUSES, Permission, type AppealView } from '@scpsl-trust/shared';

import { appealKeys, listAppeals } from '../../api/appeals';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../components/FilterBar';
import { CaseLink, UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { pickEnum } from '../servers/lib/forms';
import { appealPath } from './appealUtils';

const FILTER_DEFAULTS = { status: '', case: '', assigned_to_me: '' };
const STATUS_OPTIONS = APPEAL_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }));

function columnsFor(staff: boolean): readonly Column<AppealView>[] {
  const columns: Column<AppealView>[] = [
    { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} />, sortValue: (row) => row.case_number },
  ];
  if (staff) {
    columns.push({ key: 'player', header: 'Player', render: (row) => <UserIdLink userId={row.player.user_id} displayName={row.player.display_name} /> });
  }
  columns.push(
    { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="appealStatus" value={row.status} dot />, sortValue: (row) => row.status },
    {
      key: 'decision',
      header: 'Decision',
      render: (row) =>
        row.decision === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="row" style={{ gap: 6 }}>
            <StatusBadge kind="appealDecision" value={row.decision} />
            {row.conflict_override && <Badge tone="warning">conflict override</Badge>}
          </span>
        ),
    },
    {
      key: 'assigned',
      header: 'Assigned to',
      render: (row) => (row.assigned_reviewer === null ? <span className="text-faint">unassigned</span> : row.assigned_reviewer.pseudonym),
    },
    {
      key: 'statement',
      header: 'Statement',
      wrap: true,
      render: (row) => (
        <span className="truncate" style={{ display: 'inline-block', maxWidth: 360 }} title={row.statement}>
          {row.statement}
        </span>
      ),
    },
    { key: 'created', header: 'Submitted', render: (row) => <RelativeTime value={row.created_at} />, sortValue: (row) => row.created_at },
    { key: 'updated', header: 'Updated', render: (row) => <RelativeTime value={row.updated_at} />, sortValue: (row) => row.updated_at },
  );
  return columns;
}

export function AppealListPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const staff = auth.hasPermission(Permission.APPEAL_DECIDE);

  const query = {
    ...filters.query,
    status: pickEnum(APPEAL_STATUSES, filters.values.status),
    case: filters.values.case === '' ? undefined : filters.values.case,
    assigned_to_me: filters.values.assigned_to_me === 'true' ? true : undefined,
  };
  const appeals = useQuery({ queryKey: appealKeys.list(query), queryFn: () => listAppeals(query), placeholderData: (previous) => previous });

  return (
    <>
      <PageHeader
        title="Appeals"
        subtitle={staff ? 'All appeals. A decision needs an independent reviewer (§11.5); the backend rejects conflicts of interest.' : 'Appeals you submitted for cases against your linked in-game account.'}
        actions={
          auth.hasPermission(Permission.APPEAL_CREATE) ? (
            <LinkButton to="/appeals/new" variant="primary">
              New appeal
            </LinkButton>
          ) : undefined
        }
      />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <FilterSelect id="appeal-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
          <div className="field">
            <label className="field-label" htmlFor="appeal-case">
              Case number
            </label>
            <input
              id="appeal-case"
              className="input input-mono"
              placeholder="CASE-2026-000001"
              value={filters.values.case}
              onChange={(event) => filters.set('case', event.target.value.trim().toUpperCase())}
            />
          </div>
          {staff && (
            <FilterSelect
              id="appeal-mine"
              label="Assignment"
              value={filters.values.assigned_to_me}
              onChange={(value) => filters.set('assigned_to_me', value)}
              options={[{ value: 'true', label: 'Assigned to me' }]}
              allLabel="Anyone"
            />
          )}
        </FilterBar>
        <DataTable
          columns={columnsFor(staff)}
          rows={appeals.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={appeals.isPending}
          error={appeals.isError ? <ErrorState error={appeals.error} compact onRetry={() => void appeals.refetch()} /> : undefined}
          onRowClick={(row) => void navigate(appealPath(row.id))}
          rowClickLabel="Open appeal"
          emptyState={
            <EmptyState
              title="No appeals"
              description={staff ? 'No appeal matches the filters.' : 'You can appeal a confirmed or inconclusive case against your linked account.'}
              action={!staff && auth.hasPermission(Permission.APPEAL_CREATE) ? <LinkButton to="/appeals/new">Submit an appeal</LinkButton> : undefined}
            />
          }
        />
        {appeals.data !== undefined && (
          <Pagination
            page={appeals.data.page}
            pageSize={appeals.data.page_size}
            total={appeals.data.total}
            loaded={appeals.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default AppealListPage;
