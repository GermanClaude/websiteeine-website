/**
 * Whitelist & bypasses tab (§11.6): active bypasses (revoke), direct grants, and the whitelist
 * request queue of this server (approve with days / reject with note / revoke).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { BYPASS_TYPES, WHITELIST_REQUEST_STATUSES, type BypassCreateRequest, type ServerView } from '@scpsl-trust/shared';

import { bypassKeys } from '../../../api/bypasses';
import { createServerBypass, listServerBypasses, serverKeys } from '../../../api/servers';
import { listWhitelistRequests, whitelistKeys } from '../../../api/whitelist';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../../components/FilterBar';
import { Pagination } from '../../../components/Pagination';
import { humanizeEnum } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { WhitelistRequestTable } from '../../whitelist/WhitelistRequestTable';
import { BypassGrantForm } from '../bypasses/BypassGrantForm';
import { BypassTable } from '../bypasses/BypassTable';
import { pickEnum } from '../lib/forms';
import type { ServerAbilities } from '../serverUtils';

export interface ServerWhitelistTabProps {
  server: ServerView;
  abilities: ServerAbilities;
}

const BYPASS_TYPE_OPTIONS = BYPASS_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));
const REQUEST_STATUS_OPTIONS = WHITELIST_REQUEST_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }));
const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active only' },
  { value: 'false', label: 'Inactive only' },
];

export function ServerWhitelistTab({ server, abilities }: ServerWhitelistTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [bypassActive, setBypassActive] = useState('true');
  const [bypassType, setBypassType] = useState('');
  const [bypassPage, setBypassPage] = useState(1);
  const [requestStatus, setRequestStatus] = useState('pending');
  const [requestPage, setRequestPage] = useState(1);

  const bypassQuery = {
    page: bypassPage,
    page_size: 25,
    active: bypassActive === '' ? undefined : bypassActive === 'true',
    type: pickEnum(BYPASS_TYPES, bypassType),
  };
  const bypasses = useQuery({
    queryKey: bypassKeys.sub(server.server_id, 'server-list', bypassQuery),
    queryFn: () => listServerBypasses(server.server_id, bypassQuery),
    placeholderData: (previous) => previous,
  });

  const requestQuery = { page: requestPage, page_size: 25, server_id: server.server_id, status: pickEnum(WHITELIST_REQUEST_STATUSES, requestStatus) };
  const requests = useQuery({
    queryKey: whitelistKeys.list(requestQuery),
    queryFn: () => listWhitelistRequests(requestQuery),
    placeholderData: (previous) => previous,
  });

  const grant = useMutation({
    mutationFn: (body: BypassCreateRequest) => createServerBypass(server.server_id, body),
    onSuccess: async (bypass) => {
      toast.success(`Bypass granted to ${bypass.player.user_id}.`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: bypassKeys.all }), queryClient.invalidateQueries({ queryKey: serverKeys.all })]);
    },
  });

  return (
    <div className="stack">
      <div className="alert alert-info">
        <div className="alert-title">Bypasses exempt a player from matching policy rules of this server.</div>
        They never change a verdict. Global bypasses granted by network administrators only count when the policy option &quot;Honor global bypasses&quot; is on.
      </div>

      <Card title="Whitelist requests" flush>
        <FilterBar>
          <FilterSelect id="server-wl-status" label="Status" value={requestStatus} onChange={(value) => { setRequestStatus(value); setRequestPage(1); }} options={REQUEST_STATUS_OPTIONS} />
        </FilterBar>
        <WhitelistRequestTable
          rows={requests.data?.items ?? []}
          loading={requests.isPending}
          error={requests.isError ? <ErrorState error={requests.error} compact onRetry={() => void requests.refetch()} /> : undefined}
          canDecide={abilities.whitelistDecide}
          hideServer
        />
        {requests.data !== undefined && requests.data.total > requests.data.page_size && (
          <Pagination page={requests.data.page} pageSize={requests.data.page_size} total={requests.data.total} loaded={requests.data.items.length} onPageChange={setRequestPage} />
        )}
      </Card>

      <Card title="Bypasses" flush>
        <FilterBar>
          <FilterSelect id="server-bypass-active" label="State" value={bypassActive} onChange={(value) => { setBypassActive(value); setBypassPage(1); }} options={ACTIVE_OPTIONS} allLabel="All" />
          <FilterSelect id="server-bypass-type" label="Type" value={bypassType} onChange={(value) => { setBypassType(value); setBypassPage(1); }} options={BYPASS_TYPE_OPTIONS} />
        </FilterBar>
        <BypassTable
          rows={bypasses.data?.items ?? []}
          loading={bypasses.isPending}
          error={bypasses.isError ? <ErrorState error={bypasses.error} compact onRetry={() => void bypasses.refetch()} /> : undefined}
          canRevoke={abilities.bypass}
          emptyTitle={bypassActive === 'true' ? 'No active bypasses' : 'No bypasses'}
        />
        {bypasses.data !== undefined && bypasses.data.total > bypasses.data.page_size && (
          <Pagination page={bypasses.data.page} pageSize={bypasses.data.page_size} total={bypasses.data.total} loaded={bypasses.data.items.length} onPageChange={setBypassPage} />
        )}
      </Card>

      {abilities.bypass && (
        <Card title="Grant a bypass">
          <BypassGrantForm scopeLabel="server" onSubmit={(body) => grant.mutateAsync(body).then(() => undefined)} />
        </Card>
      )}
    </div>
  );
}
