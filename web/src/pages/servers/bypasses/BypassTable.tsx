/**
 * Bypass list with revocation (server-scoped and global bypasses share this table).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { BypassRevokeRequestSchema, LIMITS, type BypassView } from '@scpsl-trust/shared';

import { revokeBypass, bypassKeys } from '../../../api/bypasses';
import { serverKeys } from '../../../api/servers';
import { whitelistKeys } from '../../../api/whitelist';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { DataTable, type Column } from '../../../components/DataTable';
import { DateTime, RelativeTime } from '../../../components/DateTime';
import { EmptyState } from '../../../components/EmptyState';
import { FormError } from '../../../components/ErrorState';
import { Textarea } from '../../../components/FormField';
import { ServerLink, UserIdLink } from '../../../components/Links';
import { Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { useZodForm } from '../../../components/useZodForm';

export interface BypassTableProps {
  rows: readonly BypassView[];
  loading?: boolean;
  error?: React.ReactNode;
  /** Whether the caller may revoke bypasses in this list. */
  canRevoke: boolean;
  /** Show the scope / server columns (global list). */
  showScope?: boolean;
  emptyTitle?: string;
}

export function BypassStateBadge({ bypass }: { bypass: BypassView }) {
  if (bypass.revoked_at !== null) return <Badge tone="danger">Revoked</Badge>;
  if (!bypass.active) return <Badge tone="muted">Expired</Badge>;
  return <Badge tone="success" dot>
    Active
  </Badge>;
}

function RevokeBypassDialog({ bypass, onClose }: { bypass: BypassView | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: BypassRevokeRequestSchema,
    initialValues: { reason: '' },
    onSubmit: async (values) => {
      if (bypass === null) return;
      await revokeBypass(bypass.id, values);
      toast.success('Bypass revoked.');
      form.reset();
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: bypassKeys.all }),
        queryClient.invalidateQueries({ queryKey: serverKeys.all }),
        queryClient.invalidateQueries({ queryKey: whitelistKeys.all }),
      ]);
    },
  });
  const close = () => {
    form.reset();
    onClose();
  };
  return (
    <Modal open={bypass !== null} title="Revoke bypass" onClose={close} locked={form.submitting}>
      {bypass !== null && (
        <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
          <p className="text-sm">
            Revoke the <StatusBadge kind="bypassType" value={bypass.type} /> bypass of <span className="mono">{bypass.player.user_id}</span>? The player is
            evaluated by the policy again on the next join. This is audited.
          </p>
          <Textarea label="Reason" required rows={3} minLength={LIMITS.REVOKE_REASON_MIN} maxLength={LIMITS.REVOKE_REASON_MAX} data-autofocus {...form.field('reason')} />
          <FormError error={form.formError} />
          <div className="form-actions">
            <Button type="submit" variant="danger" loading={form.submitting}>
              Revoke
            </Button>
            <Button variant="ghost" onClick={close} disabled={form.submitting}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function BypassTable({ rows, loading = false, error, canRevoke, showScope = false, emptyTitle = 'No bypasses' }: BypassTableProps) {
  const [revoking, setRevoking] = useState<BypassView | null>(null);
  // Keep the mutation hook here so the dialog can be unmounted freely.
  useMutation({ mutationFn: async () => undefined });

  const columns: Column<BypassView>[] = [
    { key: 'player', header: 'Player', render: (row) => <UserIdLink userId={row.player.user_id} displayName={row.player.display_name} /> },
    { key: 'type', header: 'Type', render: (row) => <StatusBadge kind="bypassType" value={row.type} />, sortValue: (row) => row.type },
  ];
  if (showScope) {
    columns.push({
      key: 'scope',
      header: 'Scope',
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          <StatusBadge kind="bypassScope" value={row.scope} />
          {row.server !== null && <ServerLink serverId={row.server.server_id} name={row.server.name} />}
        </span>
      ),
    });
  }
  columns.push(
    { key: 'state', header: 'State', render: (row) => <BypassStateBadge bypass={row} /> },
    { key: 'reason', header: 'Reason', wrap: true, render: (row) => row.reason },
    { key: 'granted', header: 'Granted by', render: (row) => row.granted_by.username },
    {
      key: 'source',
      header: 'Source',
      render: (row) =>
        row.whitelist_request_id !== null ? (
          <Link to={`/whitelist-requests?id=${encodeURIComponent(row.whitelist_request_id)}`} className="text-xs">
            Whitelist request
          </Link>
        ) : (
          <span className="text-muted text-xs">Direct grant</span>
        ),
    },
    { key: 'created', header: 'Created', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
    { key: 'expires', header: 'Expires', render: (row) => (row.expires_at === null ? <span className="text-muted">never</span> : <RelativeTime value={row.expires_at} />), sortValue: (row) => row.expires_at },
    {
      key: 'revoked',
      header: 'Revoked',
      render: (row) =>
        row.revoked_at === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span title={row.revoke_reason ?? undefined}>
            <DateTime value={row.revoked_at} /> {row.revoked_by !== null && <span className="text-muted">by {row.revoked_by.username}</span>}
          </span>
        ),
    },
  );
  if (canRevoke) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.active ? (
          <Button size="sm" variant="danger" onClick={() => setRevoking(row)}>
            Revoke
          </Button>
        ) : null,
    });
  }

  return (
    <>
      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} loading={loading} error={error} emptyState={<EmptyState title={emptyTitle} />} />
      <RevokeBypassDialog bypass={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}
