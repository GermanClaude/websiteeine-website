/**
 * /admin/bypasses (bypass:manage_global): global bypasses list + grant form. Global bypasses only
 * apply on servers whose policy honors them (§7.1 honor_global_bypasses).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { BYPASS_TYPES, type BypassCreateRequest } from '@scpsl-trust/shared';

import { bypassKeys, createGlobalBypass, listGlobalBypasses } from '../../api/bypasses';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../components/FilterBar';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useUrlFilters } from '../../components/useUrlFilters';
import { BypassGrantForm } from '../servers/bypasses/BypassGrantForm';
import { BypassTable } from '../servers/bypasses/BypassTable';
import { pickEnum } from '../servers/lib/forms';

/** `active` in the URL: '' (default) = active only, 'false' = inactive only, 'all' = everything. */
const FILTER_DEFAULTS = { active: '', type: '', player: '' };
const TYPE_OPTIONS = BYPASS_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));
const ACTIVE_OPTIONS = [
  { value: 'false', label: 'Inactive only' },
  { value: 'all', label: 'All' },
];

export function AdminBypassesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const filters = useUrlFilters(FILTER_DEFAULTS);

  const query = {
    ...filters.query,
    active: filters.values.active === 'all' ? undefined : filters.values.active !== 'false',
    type: pickEnum(BYPASS_TYPES, filters.values.type),
    player: filters.values.player === '' ? undefined : filters.values.player,
  };
  const bypasses = useQuery({ queryKey: bypassKeys.list({ scope: 'global', ...query }), queryFn: () => listGlobalBypasses(query), placeholderData: (previous) => previous });

  const grant = useMutation({
    mutationFn: (body: BypassCreateRequest) => createGlobalBypass(body),
    onSuccess: async (bypass) => {
      toast.success(`Global bypass granted to ${bypass.player.user_id}.`);
      await queryClient.invalidateQueries({ queryKey: bypassKeys.all });
    },
  });

  return (
    <>
      <PageHeader title="Global bypasses" subtitle="Network-wide exemptions. A server only honors them when its policy option “Honor global bypasses” is enabled; they never change a verdict." />
      <div className="stack">
        <Card flush>
          <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
            <FilterSelect id="gb-active" label="State" value={filters.values.active} onChange={(value) => filters.set('active', value)} options={ACTIVE_OPTIONS} allLabel="Active only" />
            <FilterSelect id="gb-type" label="Type" value={filters.values.type} onChange={(value) => filters.set('type', value)} options={TYPE_OPTIONS} />
            <div className="field">
              <label className="field-label" htmlFor="gb-player">
                Player
              </label>
              <input id="gb-player" className="input input-mono" placeholder="76561198000000001@steam" value={filters.values.player} onChange={(event) => filters.set('player', event.target.value.trim())} />
            </div>
          </FilterBar>
          <BypassTable
            rows={bypasses.data?.items ?? []}
            loading={bypasses.isPending}
            error={bypasses.isError ? <ErrorState error={bypasses.error} compact onRetry={() => void bypasses.refetch()} /> : undefined}
            canRevoke
            showScope
            emptyTitle={filters.values.active === '' ? 'No active global bypasses' : 'No global bypasses'}
          />
          {bypasses.data !== undefined && (
            <Pagination
              page={bypasses.data.page}
              pageSize={bypasses.data.page_size}
              total={bypasses.data.total}
              loaded={bypasses.data.items.length}
              onPageChange={filters.setPage}
              onPageSizeChange={filters.setPageSize}
            />
          )}
        </Card>
        <Card title="Grant a global bypass">
          <BypassGrantForm scopeLabel="global" onSubmit={(body) => grant.mutateAsync(body).then(() => undefined)} />
        </Card>
      </div>
    </>
  );
}

export default AdminBypassesPage;
