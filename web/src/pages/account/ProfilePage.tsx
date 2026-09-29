import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { formatReviewerPseudonym, type PlayerLinkCodeResponse } from '@scpsl-trust/shared';

import { getErrorMessage } from '../../api/client';
import { meKeys } from '../../api/keys';
import { createPlayerLinkCode, getMe, unlinkPlayer } from '../../api/me';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CodeBlock } from '../../components/CodeBlock';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { ServerLink, UserIdLink } from '../../components/Links';
import { ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { formatCountdown } from '../../lib/format';
import { useCountdown } from '../../lib/useCountdown';

type Membership = { server_id: string; name: string; role: string };

const membershipColumns: readonly Column<Membership>[] = [
  { key: 'name', header: 'Server', render: (row) => <ServerLink serverId={row.server_id} name={row.name} /> },
  { key: 'server_id', header: 'Server id', render: (row) => <span className="mono">{row.server_id}</span> },
  { key: 'role', header: 'Your role', render: (row) => <StatusBadge kind="serverMemberRole" value={row.role} /> },
];

function LinkCodePanel({ code, onCheck, onRegenerate, checking }: { code: PlayerLinkCodeResponse; onCheck: () => void; onRegenerate: () => void; checking: boolean }) {
  const remaining = useCountdown(code.expires_at);
  const expired = remaining <= 0;
  return (
    <div className="stack-sm">
      <p>
        Join any SCP:SL server that runs the Trust Network plugin, open the <strong>client console</strong> (the <kbd>~</kbd> key) and enter:
      </p>
      <CodeBlock value={`.trustlink ${code.code}`} inline />
      <div className="text-sm text-muted">
        {expired ? (
          <span className="text-danger">This code has expired. Generate a new one.</span>
        ) : (
          <>
            Code expires in <span className="countdown">{formatCountdown(remaining)}</span>. The link is completed by the game server; then check the status here.
          </>
        )}
      </div>
      <div className="row">
        <Button variant="primary" size="sm" onClick={onCheck} loading={checking} disabled={expired}>
          I entered the code — check status
        </Button>
        <Button size="sm" onClick={onRegenerate}>
          Generate a new code
        </Button>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: meKeys.profile, queryFn: getMe });
  const [linkCode, setLinkCode] = useState<PlayerLinkCodeResponse | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const createCode = useMutation({
    mutationFn: createPlayerLinkCode,
    onSuccess: (code) => setLinkCode(code),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
  const unlink = useMutation({
    mutationFn: unlinkPlayer,
    onSuccess: async () => {
      setUnlinkOpen(false);
      toast.success('In-game account unlinked.');
      await queryClient.invalidateQueries({ queryKey: meKeys.all });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const linkedPlayer = meQuery.data?.linked_player ?? null;
  useEffect(() => {
    if (linkedPlayer !== null && linkCode !== null) {
      setLinkCode(null);
      toast.success(`Linked to ${linkedPlayer.user_id}.`);
    }
  }, [linkedPlayer, linkCode, toast]);

  if (meQuery.isPending) {
    return (
      <>
        <PageHeader title="Profile" />
        <LoadingState />
      </>
    );
  }
  if (meQuery.isError) {
    return (
      <>
        <PageHeader title="Profile" />
        <ErrorState error={meQuery.error} onRetry={() => void meQuery.refetch()} />
      </>
    );
  }

  const me = meQuery.data;
  const { user } = me;

  return (
    <>
      <PageHeader title="Profile" subtitle="Your account, linked in-game identity and server team memberships." />
      <div className="grid-2">
        <Card title="Account">
          <KeyValueList
            items={[
              { label: 'Username', value: user.username },
              {
                label: 'Email',
                value: (
                  <span className="row">
                    {user.email}
                    {user.email_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Unverified</Badge>}
                  </span>
                ),
              },
              { label: 'Role', value: <StatusBadge kind="userRole" value={user.role} /> },
              { label: 'Status', value: <StatusBadge kind="userStatus" value={user.status} /> },
              {
                label: 'Two-factor auth',
                value: user.mfa_enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone="warning">Disabled</Badge>,
              },
              {
                label: 'Reviewer pseudonym',
                value: user.reviewer_number !== null ? formatReviewerPseudonym(user.reviewer_number) : null,
              },
              { label: 'Member since', value: <DateTime value={user.created_at} /> },
              { label: 'Last sign-in', value: <DateTime value={user.last_login_at} /> },
            ]}
          />
          <hr className="divider" />
          <div className="text-xs text-muted mb-2">Permissions granted to this session</div>
          <div className="row">
            {me.permissions.length === 0 ? (
              <span className="text-faint">None</span>
            ) : (
              me.permissions.map((permission) => (
                <Badge key={permission} tone="muted">
                  {permission}
                </Badge>
              ))
            )}
          </div>
        </Card>

        <Card
          title="Linked in-game account"
          actions={
            linkedPlayer !== null ? (
              <Button size="sm" variant="danger" onClick={() => setUnlinkOpen(true)} disabled={!auth.hasPermission('player:link')}>
                Unlink
              </Button>
            ) : undefined
          }
        >
          {linkedPlayer !== null ? (
            <div className="stack-sm">
              <KeyValueList
                items={[
                  { label: 'Player', value: <UserIdLink userId={linkedPlayer.user_id} displayName={linkedPlayer.display_name} showType /> },
                  { label: 'Identity type', value: <StatusBadge kind="playerIdType" value={linkedPlayer.type} /> },
                ]}
              />
              <p className="text-sm text-muted">Appeals and whitelist requests are submitted on behalf of this identity.</p>
            </div>
          ) : linkCode !== null ? (
            <LinkCodePanel
              code={linkCode}
              checking={meQuery.isFetching}
              onCheck={() => void meQuery.refetch()}
              onRegenerate={() => createCode.mutate()}
            />
          ) : (
            <div className="stack-sm">
              <p className="text-sm">
                Linking your Steam, Discord or Northwood identity lets you appeal cases against you and request VPN or account-age whitelists.
                Nothing about your account is shared with game servers.
              </p>
              <div>
                <Button variant="primary" onClick={() => createCode.mutate()} loading={createCode.isPending} disabled={!auth.hasPermission('player:link')}>
                  Link in-game account
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Server team memberships" className="mt-4" flush>
        {me.servers.length === 0 ? (
          <EmptyState title="No server memberships" description="Server owners can add you to their team from the server page." />
        ) : (
          <DataTable columns={membershipColumns} rows={me.servers} rowKey={(row) => row.server_id} />
        )}
      </Card>

      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink in-game account"
        message="You will no longer be able to submit appeals or whitelist requests until you link an identity again."
        confirmLabel="Unlink"
        tone="danger"
        loading={unlink.isPending}
        onConfirm={() => unlink.mutate()}
        onCancel={() => setUnlinkOpen(false)}
      />
    </>
  );
}

export default ProfilePage;
