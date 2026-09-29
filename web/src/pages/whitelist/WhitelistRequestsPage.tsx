/**
 * /whitelist-requests — players: request form + "My requests"; server teams and
 * whitelist:decide_any: the decision queue with filters (§11.6).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import { Permission, WHITELIST_REQUEST_STATUSES, WHITELIST_REQUEST_TYPES, type WhitelistRequestCreateRequest } from '@scpsl-trust/shared';

import { createWhitelistRequest, listWhitelistRequests, whitelistKeys } from '../../api/whitelist';
import { useAuth } from '../../auth/useAuth';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useUrlFilters } from '../../components/useUrlFilters';
import { pickEnum } from '../servers/lib/forms';
import { WhitelistRequestForm } from './WhitelistRequestForm';
import { WhitelistRequestTable } from './WhitelistRequestTable';

const FILTER_DEFAULTS = { status: '', type: '', server_id: '' };
const STATUS_OPTIONS = WHITELIST_REQUEST_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }));
const TYPE_OPTIONS = WHITELIST_REQUEST_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));

function MyRequests({ highlightId }: { highlightId: string | null }) {
  const mine = useQuery({
    queryKey: whitelistKeys.list({ mine: true }),
    queryFn: () => listWhitelistRequests({ mine: true, page_size: 100 }),
  });
  return (
    <Card title="My requests" flush>
      <WhitelistRequestTable
        rows={mine.data?.items ?? []}
        loading={mine.isPending}
        error={mine.isError ? <ErrorState error={mine.error} compact onRetry={() => void mine.refetch()} /> : undefined}
        canDecide={false}
        mine
        highlightId={highlightId}
        emptyState={<EmptyState title="No requests yet" description="Requests you submit appear here with their status and expiry." />}
      />
    </Card>
  );
}

export function WhitelistRequestsPage() {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const highlightId = searchParams.get('id');
  const isStaff = auth.hasServerMembership || auth.hasPermission(Permission.WHITELIST_DECIDE_ANY);
  const decidesAll = auth.hasPermission(Permission.WHITELIST_DECIDE_ANY);

  const query = {
    ...filters.query,
    status: pickEnum(WHITELIST_REQUEST_STATUSES, filters.values.status),
    type: pickEnum(WHITELIST_REQUEST_TYPES, filters.values.type),
    server_id: filters.values.server_id === '' ? undefined : filters.values.server_id,
  };
  const queue = useQuery({
    queryKey: whitelistKeys.list(query),
    queryFn: () => listWhitelistRequests(query),
    enabled: isStaff,
    placeholderData: (previous) => previous,
  });

  const create = useMutation({
    mutationFn: (body: WhitelistRequestCreateRequest) => createWhitelistRequest(body),
    onSuccess: async (request) => {
      toast.success(`Request submitted to ${request.server.name}. You will see the decision here.`);
      await queryClient.invalidateQueries({ queryKey: whitelistKeys.all });
    },
  });

  return (
    <>
      <PageHeader
        title="Whitelist requests"
        subtitle={
          isStaff
            ? decidesAll
              ? 'All requests (whitelist:decide_any) and your own.'
              : 'Requests for servers where you are a team member, and your own.'
            : 'Ask a server team for a VPN or account-age exemption. Decisions are made by that server, never by the network.'
        }
      />
      <div className="stack">
        {isStaff && (
          <Card title="Decision queue" flush>
            <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
              <FilterSelect id="wl-status" label="Status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
              <FilterSelect id="wl-type" label="Type" value={filters.values.type} onChange={(value) => filters.set('type', value)} options={TYPE_OPTIONS} />
              <div className="field">
                <label className="field-label" htmlFor="wl-server">
                  Server id
                </label>
                <input
                  id="wl-server"
                  className="input input-mono"
                  placeholder="srv_…"
                  value={filters.values.server_id}
                  onChange={(event) => filters.set('server_id', event.target.value.trim())}
                />
              </div>
            </FilterBar>
            <WhitelistRequestTable
              rows={queue.data?.items ?? []}
              loading={queue.isPending}
              error={queue.isError ? <ErrorState error={queue.error} compact onRetry={() => void queue.refetch()} /> : undefined}
              canDecide
              highlightId={highlightId}
              emptyState={<EmptyState title="No requests" description={filters.isFiltered ? 'No request matches the filters.' : 'Nothing to decide right now.'} />}
            />
            {queue.data !== undefined && (
              <Pagination
                page={queue.data.page}
                pageSize={queue.data.page_size}
                total={queue.data.total}
                loaded={queue.data.items.length}
                onPageChange={filters.setPage}
                onPageSizeChange={filters.setPageSize}
              />
            )}
          </Card>
        )}

        <div className="grid-2">
          <Card title="Request a whitelist">
            <WhitelistRequestForm onSubmit={(body) => create.mutateAsync(body)} initialServerId={searchParams.get('server_id') ?? ''} />
          </Card>
          <MyRequests highlightId={highlightId} />
        </div>
      </div>
    </>
  );
}

export default WhitelistRequestsPage;
