/**
 * Server dashboard (Requirements §22): overview, keys, policy, whitelist & bypasses, members.
 * Per-server buttons are gated by the member role returned in the server view (shared
 * canActOnServer); the backend enforces everything (R10).
 */
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router';

import { Permission } from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { getServer, serverKeys } from '../../api/servers';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { ErrorState } from '../../components/ErrorState';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { TabPanel, Tabs, type TabItem } from '../../components/Tabs';
import { ForbiddenPage } from '../errors/ForbiddenPage';
import { NotFoundPage } from '../errors/NotFoundPage';
import { OnlineIndicator } from './OnlineIndicator';
import { ServerKeysTab } from './detail/ServerKeysTab';
import { ServerMembersTab } from './detail/ServerMembersTab';
import { ServerOverviewTab } from './detail/ServerOverviewTab';
import { ServerPolicyTab } from './detail/ServerPolicyTab';
import { ServerWhitelistTab } from './detail/ServerWhitelistTab';
import { serverAbilities } from './serverUtils';

export type ServerTabId = 'overview' | 'keys' | 'policy' | 'whitelist' | 'members';

const TAB_IDS: readonly ServerTabId[] = ['overview', 'keys', 'policy', 'whitelist', 'members'];

function isTabId(value: string | null): value is ServerTabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

export function ServerDetailPage() {
  const { serverId = '' } = useParams<{ serverId: string }>();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const tab: ServerTabId = isTabId(rawTab) ? rawTab : 'overview';

  const server = useQuery({
    queryKey: serverKeys.detail(serverId),
    queryFn: () => getServer(serverId),
    enabled: serverId !== '',
    refetchInterval: 60_000,
  });

  const setTab = (next: ServerTabId) => {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'overview') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true },
    );
  };

  if (serverId === '') return <NotFoundPage />;

  if (server.isPending) {
    return (
      <>
        <PageHeader title="Server" breadcrumbs={[{ label: 'Servers', to: '/servers' }, { label: serverId }]} />
        <LoadingState />
      </>
    );
  }
  if (server.isError) {
    if (ApiError.is(server.error) && server.error.isForbidden) return <ForbiddenPage message="You are not a member of this server team." />;
    if (ApiError.is(server.error) && server.error.isNotFound) return <NotFoundPage />;
    return (
      <>
        <PageHeader title="Server" breadcrumbs={[{ label: 'Servers', to: '/servers' }, { label: serverId }]} />
        <ErrorState error={server.error} onRetry={() => void server.refetch()} />
      </>
    );
  }

  const data = server.data;
  const abilities = serverAbilities(auth.user?.role, data.member_role);
  const canChangeStatus = auth.hasPermission(Permission.SERVER_MANAGE_ANY);
  const canTrust = auth.hasPermission(Permission.SERVER_TRUST);

  const tabs: readonly TabItem<ServerTabId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'keys', label: 'Keys' },
    { id: 'policy', label: 'Policy' },
    { id: 'whitelist', label: 'Whitelist & bypasses' },
    { id: 'members', label: 'Members' },
  ];

  return (
    <>
      <PageHeader
        title={data.name}
        documentTitle={data.name}
        breadcrumbs={[{ label: 'Servers', to: '/servers' }, { label: data.name }]}
        badges={
          <>
            <StatusBadge kind="serverStatus" value={data.status} dot />
            <OnlineIndicator lastSeenAt={data.last_seen_at} status={data.status} />
            {data.is_trusted && <Badge tone="success">Trusted</Badge>}
            {data.member_role !== null ? <StatusBadge kind="serverMemberRole" value={data.member_role} /> : <Badge tone="muted">admin access</Badge>}
          </>
        }
        subtitle={
          <span className="mono">
            {data.server_id}
          </span>
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Server sections" idPrefix="server" />

      {tab === 'overview' && (
        <TabPanel id="overview" idPrefix="server">
          <ServerOverviewTab server={data} abilities={abilities} canChangeStatus={canChangeStatus} canTrust={canTrust} onOpenKeys={() => setTab('keys')} />
        </TabPanel>
      )}
      {tab === 'keys' && (
        <TabPanel id="keys" idPrefix="server">
          <ServerKeysTab server={data} abilities={abilities} />
        </TabPanel>
      )}
      {tab === 'policy' && (
        <TabPanel id="policy" idPrefix="server">
          <ServerPolicyTab server={data} abilities={abilities} canViewAudit={auth.hasPermission(Permission.AUDIT_VIEW)} />
        </TabPanel>
      )}
      {tab === 'whitelist' && (
        <TabPanel id="whitelist" idPrefix="server">
          <ServerWhitelistTab server={data} abilities={abilities} />
        </TabPanel>
      )}
      {tab === 'members' && (
        <TabPanel id="members" idPrefix="server">
          <ServerMembersTab server={data} abilities={abilities} currentUserId={auth.user?.id ?? null} />
        </TabPanel>
      )}
    </>
  );
}

export default ServerDetailPage;
