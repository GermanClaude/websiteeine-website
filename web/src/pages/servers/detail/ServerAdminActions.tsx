/**
 * Network-admin actions on a server: status change (server:manage_any) and the trusted flag
 * (server:trust). Both require a reason and are audited.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { LIMITS, ServerStatusChangeRequestSchema, ServerTrustRequestSchema, type ServerView } from '@scpsl-trust/shared';

import { changeServerStatus, serverKeys, setServerTrust } from '../../../api/servers';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { FormError } from '../../../components/ErrorState';
import { Select, Textarea } from '../../../components/FormField';
import { Modal } from '../../../components/Modal';
import { StatusBadge, humanizeEnum } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { useZodForm } from '../../../components/useZodForm';

export interface ServerAdminActionsProps {
  server: ServerView;
  canChangeStatus: boolean;
  canTrust: boolean;
}

const STATUS_TARGETS = ['active', 'suspended', 'revoked'] as const;

function StatusDialog({ server, onClose }: { server: ServerView; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: ServerStatusChangeRequestSchema,
    initialValues: { status: server.status === 'active' ? 'suspended' : 'active', reason: '' },
    onSubmit: async (values) => {
      const updated = await changeServerStatus(server.server_id, values);
      queryClient.setQueryData(serverKeys.detail(server.server_id), updated);
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
      toast.success(`Server status changed to ${humanizeEnum(updated.status).toLowerCase()}.`);
      onClose();
    },
  });
  const target = form.values.status;
  return (
    <Modal open title="Change server status" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <p className="text-sm">
          Current status: <StatusBadge kind="serverStatus" value={server.status} />. Suspended and revoked servers cannot make signed requests; revocation is
          meant to be final.
        </p>
        <Select
          label="New status"
          options={STATUS_TARGETS.filter((status) => status !== server.status).map((status) => ({ value: status, label: humanizeEnum(status) }))}
          data-autofocus
          {...form.field('status')}
        />
        {target === 'revoked' && <div className="alert alert-danger">Revoking a server is intended to be permanent. All of its keys stop working immediately.</div>}
        <Textarea label="Reason" required rows={3} minLength={LIMITS.REVOKE_REASON_MIN} maxLength={LIMITS.REVOKE_REASON_MAX} {...form.field('reason')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant={target === 'active' ? 'primary' : 'danger'} loading={form.submitting}>
            {target === 'active' ? 'Activate server' : target === 'suspended' ? 'Suspend server' : 'Revoke server'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TrustDialog({ server, onClose }: { server: ServerView; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const next = !server.is_trusted;
  const form = useZodForm({
    schema: ServerTrustRequestSchema,
    initialValues: { is_trusted: next, reason: '' },
    onSubmit: async (values) => {
      const updated = await setServerTrust(server.server_id, values);
      queryClient.setQueryData(serverKeys.detail(server.server_id), updated);
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
      toast.success(updated.is_trusted ? 'Server marked as trusted.' : 'Trusted flag removed.');
      onClose();
    },
  });
  return (
    <Modal open title={next ? 'Mark server as trusted' : 'Remove trusted flag'} onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <p className="text-sm">
          The trusted flag is shown next to this server&apos;s case confirmations. It never changes a verdict; reviewers weigh confirmations of trusted servers
          themselves.
        </p>
        <Textarea label="Reason (optional)" rows={3} maxLength={LIMITS.REVOKE_REASON_MAX} data-autofocus {...form.field('reason')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting}>
            {next ? 'Mark as trusted' : 'Remove trusted flag'}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ServerAdminActions({ server, canChangeStatus, canTrust }: ServerAdminActionsProps) {
  const [dialog, setDialog] = useState<'status' | 'trust' | null>(null);
  return (
    <Card title="Network administration">
      <div className="stack-sm">
        <p className="text-sm text-muted">These actions are available to network administrators only and are recorded in the audit log.</p>
        <div className="row">
          {canChangeStatus && (
            <Button variant={server.status === 'active' ? 'danger' : 'primary'} onClick={() => setDialog('status')} disabled={server.status === 'pending'}>
              Change status
            </Button>
          )}
          {canTrust && (
            <Button onClick={() => setDialog('trust')}>{server.is_trusted ? 'Remove trusted flag' : 'Mark as trusted'}</Button>
          )}
        </div>
        {server.status === 'pending' && canChangeStatus && (
          <div className="text-xs text-muted">A pending server becomes active when the plugin completes registration; its status cannot be set manually.</div>
        )}
      </div>
      {dialog === 'status' && <StatusDialog server={server} onClose={() => setDialog(null)} />}
      {dialog === 'trust' && <TrustDialog server={server} onClose={() => setDialog(null)} />}
    </Card>
  );
}
