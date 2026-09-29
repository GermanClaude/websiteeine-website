/**
 * Server confirmations (§11.4): counts, list, "confirm for my server" (owner/admin membership
 * on an active server) and revoking one's own confirmation. Confirmations are information for
 * other servers — they never change the verdict.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CaseConfirmationCreateRequestSchema, LIMITS, hasServerMemberRole, type CaseConfirmationView, type CaseStaffView } from '@scpsl-trust/shared';

import { getErrorMessage } from '../../api/client';
import { addCaseConfirmation, caseKeys, listConfirmableServers, revokeCaseConfirmation } from '../../api/cases';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { FormError } from '../../components/ErrorState';
import { Select, Textarea } from '../../components/FormField';
import { ServerLink } from '../../components/Links';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { lengthHint } from './formHelpers';

const columns: readonly Column<CaseConfirmationView>[] = [
  {
    key: 'server',
    header: 'Server',
    render: (row) => (
      <span className="row" style={{ gap: 6 }}>
        <ServerLink serverId={row.server.server_id} name={row.server.name} />
        {row.server.is_trusted && <Badge tone="success">trusted</Badge>}
      </span>
    ),
  },
  { key: 'by', header: 'Confirmed by', render: (row) => row.confirmed_by.username },
  { key: 'note', header: 'Note', render: (row) => row.note ?? <span className="text-faint">—</span>, wrap: true },
  { key: 'created', header: 'Confirmed', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  {
    key: 'state',
    header: 'State',
    render: (row) =>
      row.active ? (
        <Badge tone="success" dot>
          active
        </Badge>
      ) : (
        <span className="stack-sm text-xs" style={{ gap: 0 }}>
          <Badge tone="muted">revoked</Badge>
          <span className="text-muted">
            <DateTime value={row.revoked_at} />
            {row.revoke_reason !== null && ` · ${row.revoke_reason}`}
          </span>
        </span>
      ),
  },
];

export function CaseConfirmationsSection({ caseData }: { caseData: CaseStaffView }) {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<CaseConfirmationView | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const mayConfirmSomewhere = auth.memberships.some((membership) => hasServerMemberRole(membership.role, 'confirm'));
  const servers = useQuery({ queryKey: caseKeys.confirmableServers, queryFn: listConfirmableServers, enabled: mayConfirmSomewhere, staleTime: 60_000 });

  const activeServerIds = new Set(caseData.confirmations.filter((item) => item.active).map((item) => item.server.server_id));
  const eligibleServers = (servers.data ?? []).filter((server) => !activeServerIds.has(server.server_id));
  const caseAllows = caseData.verdict === 'confirmed' || caseData.status === 'under_review';

  const invalidate = () => queryClient.invalidateQueries({ queryKey: caseKeys.all });

  const confirmMutation = useMutation({ mutationFn: (body: Parameters<typeof addCaseConfirmation>[1]) => addCaseConfirmation(caseData.case_number, body) });
  const form = useZodForm({
    schema: CaseConfirmationCreateRequestSchema,
    initialValues: { server_id: '', note: '' },
    onSubmit: async (body) => {
      await confirmMutation.mutateAsync(body);
      await invalidate();
      toast.success('Confirmation recorded for your server.');
      form.reset();
      setConfirmOpen(false);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) => revokeCaseConfirmation(caseData.case_number, input.id, { reason: input.reason === '' ? null : input.reason }),
    onSuccess: async () => {
      await invalidate();
      toast.success('Confirmation revoked.');
      setRevokeTarget(null);
      setRevokeReason('');
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const canRevoke = (row: CaseConfirmationView): boolean => {
    if (!row.active || auth.user === null) return false;
    if (row.confirmed_by.id === auth.user.id) return true;
    return auth.memberships.some((membership) => membership.server_id === row.server.server_id && hasServerMemberRole(membership.role, 'confirm'));
  };

  const columnsWithActions: readonly Column<CaseConfirmationView>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        canRevoke(row) ? (
          <Button size="sm" variant="danger" onClick={() => setRevokeTarget(row)}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  const serverOptions = eligibleServers.map((server) => ({ value: server.server_id, label: `${server.name} (${server.server_id})` }));

  return (
    <div className="stack-sm">
      <div className="row-between" style={{ padding: '0 var(--sp-4)' }}>
        <div className="row text-sm">
          <span className="text-muted">Active confirmations:</span>
          <Badge tone={caseData.confirmed_servers > 0 ? 'accent' : 'muted'}>{caseData.confirmed_servers}</Badge>
          <span className="text-muted">Independent (distinct owners):</span>
          <Badge tone={caseData.independent_confirmed_servers > 0 ? 'accent' : 'muted'}>{caseData.independent_confirmed_servers}</Badge>
        </div>
        {mayConfirmSomewhere && (
          <Button size="sm" variant="primary" onClick={() => setConfirmOpen(true)} disabled={servers.isPending}>
            Confirm for my server
          </Button>
        )}
      </div>
      <p className="text-xs text-muted" style={{ padding: '0 var(--sp-4)' }}>
        A confirmation is a statement by a server team (owner or admin) that they independently stand behind the finding. Servers use the counts in
        their own policies; confirmations <strong>never change the verdict automatically</strong>. Possible while the case is under review or once the
        verdict is confirmed.
      </p>
      <DataTable
        columns={columnsWithActions}
        rows={caseData.confirmations}
        rowKey={(row) => row.id}
        emptyState={<EmptyState title="No server confirmations" />}
        caption="Server confirmations"
      />

      <Modal
        open={confirmOpen}
        title="Confirm for my server"
        onClose={() => {
          if (form.submitting) return;
          form.reset();
          setConfirmOpen(false);
        }}
        locked={form.submitting}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)} disabled={form.submitting}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="case-confirm-form" loading={form.submitting} disabled={serverOptions.length === 0}>
              Confirm
            </Button>
          </>
        }
      >
        <form id="case-confirm-form" className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
          {!caseAllows && (
            <div className="alert alert-warning text-sm" role="status">
              This case is neither under review nor confirmed; the backend will reject the confirmation.
            </div>
          )}
          {servers.isError ? (
            <FormError error={servers.error} />
          ) : serverOptions.length === 0 && !servers.isPending ? (
            <p className="text-sm text-muted">Every active server you own or administer has already confirmed this case.</p>
          ) : (
            <Select
              {...form.field('server_id')}
              label="Server"
              options={serverOptions}
              placeholder={servers.isPending ? 'Loading servers…' : 'Choose a server'}
              required
              hint="Only active servers where you are owner or admin."
              disabled={form.submitting || servers.isPending}
              data-autofocus
            />
          )}
          <Textarea
            {...form.field('note')}
            label="Note (optional)"
            rows={3}
            hint={`Why your server confirms this finding, e.g. own observations. ${lengthHint(form.values.note, LIMITS.CONFIRMATION_NOTE_MAX)}`}
            disabled={form.submitting}
          />
          <FormError error={form.formError} />
        </form>
      </Modal>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke confirmation"
        message={
          revokeTarget === null ? '' : `Revoke the confirmation of ${revokeTarget.server.name}? The record is kept (soft revoke) and the change is audited.`
        }
        confirmLabel="Revoke"
        tone="danger"
        loading={revokeMutation.isPending}
        onConfirm={() => {
          if (revokeTarget !== null) revokeMutation.mutate({ id: revokeTarget.id, reason: revokeReason.trim() });
        }}
        onCancel={() => {
          setRevokeTarget(null);
          setRevokeReason('');
        }}
      >
        <Textarea label="Reason (optional)" rows={2} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} maxLength={LIMITS.REVOKE_REASON_MAX} />
      </ConfirmDialog>
    </div>
  );
}
