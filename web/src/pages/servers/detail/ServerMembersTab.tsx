/**
 * Members tab: server team (owner / admin / moderator), add by username, remove.
 * Membership — not the global role — authorizes server-scoped actions (§12.3).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SERVER_MEMBER_ROLES_FOR, ServerMemberAddRequestSchema, type ServerMemberView, type ServerView } from '@scpsl-trust/shared';

import { getErrorMessage } from '../../../api/client';
import { meKeys } from '../../../api/keys';
import { addServerMember, listServerMembers, removeServerMember, serverKeys } from '../../../api/servers';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { DateTime } from '../../../components/DateTime';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState, FormError } from '../../../components/ErrorState';
import { Input, Select } from '../../../components/FormField';
import { ConfirmDialog } from '../../../components/Modal';
import { StatusBadge, humanizeEnum } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { useZodForm } from '../../../components/useZodForm';
import type { ServerAbilities } from '../serverUtils';

export interface ServerMembersTabProps {
  server: ServerView;
  abilities: ServerAbilities;
  currentUserId: string | null;
}

const ROLE_HINTS: Readonly<Record<string, string>> = {
  admin: 'Manage the server, its keys, policy, bypasses, members and whitelist decisions; confirm cases for the server.',
  moderator: 'Decide on whitelist requests for this server only.',
};

function AddMemberForm({ server }: { server: ServerView }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: ServerMemberAddRequestSchema,
    initialValues: { username: '', role: 'moderator' },
    onSubmit: async (values) => {
      const member = await addServerMember(server.server_id, values);
      toast.success(`${member.user.username} added as ${humanizeEnum(member.role).toLowerCase()}.`);
      form.reset();
      await Promise.all([queryClient.invalidateQueries({ queryKey: serverKeys.all }), queryClient.invalidateQueries({ queryKey: meKeys.all })]);
    },
  });
  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Add team member">
      <div className="form-grid">
        <Input label="Username" required autoComplete="off" placeholder="Exact panel username" hint="The user needs an account on this panel." {...form.field('username')} />
        <Select
          label="Role"
          options={[
            { value: 'admin', label: 'Admin' },
            { value: 'moderator', label: 'Moderator' },
          ]}
          hint={ROLE_HINTS[form.values.role]}
          {...form.field('role')}
        />
      </div>
      <FormError error={form.formError} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting}>
          Add member
        </Button>
      </div>
    </form>
  );
}

export function ServerMembersTab({ server, abilities, currentUserId }: ServerMembersTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<ServerMemberView | null>(null);
  const members = useQuery({ queryKey: serverKeys.sub(server.server_id, 'members'), queryFn: () => listServerMembers(server.server_id) });

  const remove = useMutation({
    mutationFn: (member: ServerMemberView) => removeServerMember(server.server_id, member.user.id),
    onSuccess: async (_result, member) => {
      setRemoving(null);
      toast.success(`${member.user.username} removed from the team.`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: serverKeys.all }), queryClient.invalidateQueries({ queryKey: meKeys.all })]);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: Column<ServerMemberView>[] = [
    {
      key: 'user',
      header: 'User',
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          {row.user.username}
          {row.user.id === currentUserId && <Badge tone="muted">you</Badge>}
        </span>
      ),
      sortValue: (row) => row.user.username,
    },
    { key: 'role', header: 'Role', render: (row) => <StatusBadge kind="serverMemberRole" value={row.role} />, sortValue: (row) => row.role },
    { key: 'since', header: 'Member since', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
    { key: 'by', header: 'Added by', render: (row) => row.created_by?.username ?? <span className="text-faint">—</span> },
  ];
  if (abilities.manage) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.role === 'owner' ? (
          <span className="text-xs text-muted">owner</span>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setRemoving(row)}>
            Remove
          </Button>
        ),
    });
  }

  return (
    <div className="stack">
      <Card title="Team" flush>
        <div className="card-body text-sm text-muted" style={{ paddingBottom: 0 }}>
          Members act on this server whatever their global panel role. {SERVER_MEMBER_ROLES_FOR.manage.map(humanizeEnum).join(' and ')}s manage the server,
          its keys, policy, bypasses and case confirmations; {SERVER_MEMBER_ROLES_FOR.whitelist_decide.map(humanizeEnum).join(', ').toLowerCase()}s decide on
          whitelist requests.
        </div>
        <DataTable
          columns={columns}
          rows={members.data?.items ?? []}
          rowKey={(row) => row.user.id}
          loading={members.isPending}
          error={members.isError ? <ErrorState error={members.error} compact onRetry={() => void members.refetch()} /> : undefined}
          emptyState={<EmptyState title="No members" />}
        />
      </Card>
      {abilities.manage && (
        <Card title="Add team member">
          <AddMemberForm server={server} />
        </Card>
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove team member"
        message={removing === null ? '' : `Remove ${removing.user.username} (${humanizeEnum(removing.role).toLowerCase()}) from ${server.name}? They lose access to this server immediately.`}
        confirmLabel="Remove"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => {
          if (removing !== null) remove.mutate(removing);
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
