/**
 * Keys tab (§5.5, §5.6): key list with status/fingerprint/dates, revocation with reason,
 * rotation request and a new registration token for re-enrollment.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { KeyRevokeRequestSchema, LIMITS, type RegistrationTokenResponse, type ServerKeyView, type ServerView } from '@scpsl-trust/shared';

import { getErrorMessage } from '../../../api/client';
import { createRegistrationToken, listServerKeys, requestKeyRotation, revokeServerKey, serverKeys } from '../../../api/servers';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { CopyButton } from '../../../components/CopyButton';
import { DataTable, type Column } from '../../../components/DataTable';
import { DateTime, RelativeTime } from '../../../components/DateTime';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState, FormError } from '../../../components/ErrorState';
import { Textarea } from '../../../components/FormField';
import { ConfirmDialog, Modal } from '../../../components/Modal';
import { StatusBadge } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { useZodForm } from '../../../components/useZodForm';
import { RegistrationTokenPanel } from '../RegistrationTokenPanel';
import type { ServerAbilities } from '../serverUtils';

export interface ServerKeysTabProps {
  server: ServerView;
  abilities: ServerAbilities;
}

function RevokeKeyDialog({ server, keyToRevoke, onClose }: { server: ServerView; keyToRevoke: ServerKeyView; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: KeyRevokeRequestSchema,
    initialValues: { reason: '' },
    onSubmit: async (values) => {
      await revokeServerKey(server.server_id, keyToRevoke.id, values);
      toast.success('Key revoked.');
      onClose();
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
    },
  });
  return (
    <Modal open title="Revoke signing key" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <div className="alert alert-danger">
          <div className="alert-title">Requests signed with this key are rejected immediately.</div>
          {keyToRevoke.status === 'active' && 'This is the active key: the server must re-register with a new registration token before it can talk to the network again.'}
        </div>
        <div className="text-sm">
          Fingerprint: <span className="mono break-all">{keyToRevoke.fingerprint}</span>
        </div>
        <Textarea label="Reason" required rows={3} minLength={LIMITS.REVOKE_REASON_MIN} maxLength={LIMITS.REVOKE_REASON_MAX} data-autofocus {...form.field('reason')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="danger" loading={form.submitting}>
            Revoke key
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ServerKeysTab({ server, abilities }: ServerKeysTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<ServerKeyView | null>(null);
  const [rotationConfirm, setRotationConfirm] = useState(false);
  const [tokenConfirm, setTokenConfirm] = useState(false);
  const [token, setToken] = useState<RegistrationTokenResponse | null>(null);

  const keys = useQuery({ queryKey: serverKeys.sub(server.server_id, 'keys'), queryFn: () => listServerKeys(server.server_id) });

  const rotation = useMutation({
    mutationFn: () => requestKeyRotation(server.server_id),
    onSuccess: async () => {
      setRotationConfirm(false);
      toast.success('Key rotation requested. The plugin rotates on its next heartbeat.');
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const newToken = useMutation({
    mutationFn: () => createRegistrationToken(server.server_id),
    onSuccess: (response) => {
      setTokenConfirm(false);
      setToken(response);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const hasActiveKey = keys.data?.items.some((key) => key.status === 'active') ?? server.key_fingerprint !== null;

  const columns: Column<ServerKeyView>[] = [
    {
      key: 'fingerprint',
      header: 'Fingerprint',
      render: (row) => (
        <span className="row" style={{ gap: 6 }}>
          <span className="mono text-xs break-all">{row.fingerprint}</span>
          <CopyButton value={row.fingerprint} />
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="serverKeyStatus" value={row.status} dot />, sortValue: (row) => row.status },
    { key: 'created', header: 'Created', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
    { key: 'activated', header: 'Activated', render: (row) => <DateTime value={row.activated_at} /> },
    {
      key: 'retiring',
      header: 'Retiring until',
      render: (row) => (row.status === 'retiring' ? <RelativeTime value={row.retiring_until} /> : <DateTime value={row.retired_at} />),
    },
    {
      key: 'revoked',
      header: 'Revoked',
      wrap: true,
      render: (row) =>
        row.revoked_at === null ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="text-xs">
            <DateTime value={row.revoked_at} />
            {row.revoke_reason !== null && <div className="text-muted">{row.revoke_reason}</div>}
          </span>
        ),
    },
  ];
  if (abilities.manage) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.status === 'active' || row.status === 'retiring' ? (
          <Button size="sm" variant="danger" onClick={() => setRevoking(row)}>
            Revoke
          </Button>
        ) : null,
    });
  }

  return (
    <div className="stack">
      {token !== null && (
        <Card title="New registration token">
          <RegistrationTokenPanel
            serverId={server.server_id}
            serverName={server.name}
            token={token.registration_token}
            expiresAt={token.expires_at}
            onAcknowledge={() => setToken(null)}
            acknowledgeLabel="Done"
          />
        </Card>
      )}

      <Card
        title="Signing keys"
        flush
        actions={
          abilities.manage ? (
            <>
              <Button size="sm" onClick={() => setRotationConfirm(true)} disabled={server.status !== 'active' || server.key_rotation_requested_at !== null}>
                Request rotation
              </Button>
              <Button size="sm" variant={hasActiveKey ? 'secondary' : 'primary'} onClick={() => setTokenConfirm(true)} disabled={server.status === 'revoked'}>
                New registration token
              </Button>
            </>
          ) : undefined
        }
      >
        <div className="card-body text-sm text-muted" style={{ paddingBottom: 0 }}>
          Only public keys are ever stored; the private key never leaves the game server. Rotation is performed by the plugin (<code>trust rotatekey</code> or
          automatically after a rotation request); the previous key stays valid for a short grace period.
        </div>
        <DataTable
          columns={columns}
          rows={keys.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={keys.isPending}
          error={keys.isError ? <ErrorState error={keys.error} compact onRetry={() => void keys.refetch()} /> : undefined}
          emptyState={<EmptyState title="No keys yet" description="Keys appear once the plugin has registered with a registration token." />}
        />
      </Card>

      <ConfirmDialog
        open={rotationConfirm}
        title="Request key rotation"
        message="The plugin will generate a new key pair and prove possession of it on its next heartbeat. The current key retires after the grace period."
        confirmLabel="Request rotation"
        loading={rotation.isPending}
        onConfirm={() => rotation.mutate()}
        onCancel={() => setRotationConfirm(false)}
      />
      <ConfirmDialog
        open={tokenConfirm}
        title="Create a new registration token"
        message={
          hasActiveKey
            ? 'A new token lets the server re-enroll with a fresh key pair. Any unused previous token is revoked. The current active key keeps working until the plugin registers again.'
            : 'The token is valid for 24 hours and shown only once. Any unused previous token is revoked.'
        }
        confirmLabel="Create token"
        loading={newToken.isPending}
        onConfirm={() => newToken.mutate()}
        onCancel={() => setTokenConfirm(false)}
      />
      {revoking !== null && <RevokeKeyDialog server={server} keyToRevoke={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}
