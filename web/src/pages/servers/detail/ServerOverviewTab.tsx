/**
 * Overview tab: identity and state of the server (§22), editable settings for managers and the
 * network-admin actions (status change, trusted flag).
 */
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';

import { LIMITS, ServerUpdateRequestSchema, type ServerView } from '@scpsl-trust/shared';

import { serverKeys, updateServer } from '../../../api/servers';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { CopyButton } from '../../../components/CopyButton';
import { DateTime, RelativeTime } from '../../../components/DateTime';
import { FormError } from '../../../components/ErrorState';
import { Checkbox, Input, Textarea } from '../../../components/FormField';
import { KeyValueList } from '../../../components/KeyValueList';
import { StatusBadge } from '../../../components/StatusBadge';
import { useToast } from '../../../components/Toasts';
import { useZodForm } from '../../../components/useZodForm';
import { isServerOnline, type ServerAbilities } from '../serverUtils';
import { ServerAdminActions } from './ServerAdminActions';

export interface ServerOverviewTabProps {
  server: ServerView;
  abilities: ServerAbilities;
  canChangeStatus: boolean;
  canTrust: boolean;
  onOpenKeys: () => void;
}

function ServerSettingsForm({ server }: { server: ServerView }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: ServerUpdateRequestSchema,
    initialValues: { name: server.name, description: server.description ?? '', accepts_whitelist_requests: server.accepts_whitelist_requests },
    onSubmit: async (values) => {
      const updated = await updateServer(server.server_id, values);
      queryClient.setQueryData(serverKeys.detail(server.server_id), updated);
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
      toast.success('Server settings saved.');
      form.reset({ name: updated.name, description: updated.description ?? '', accepts_whitelist_requests: updated.accepts_whitelist_requests });
    },
  });

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Server settings">
      <Input label="Name" required maxLength={LIMITS.SERVER_NAME_MAX} {...form.field('name')} />
      <Textarea label="Description" rows={3} maxLength={LIMITS.SERVER_DESCRIPTION_MAX} {...form.field('description')} />
      <Checkbox
        label="Accept whitelist requests from players"
        hint="When off, players cannot submit VPN or account-age whitelist requests for this server."
        {...form.checkbox('accepts_whitelist_requests')}
      />
      <FormError error={form.formError} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting} disabled={!form.dirty}>
          Save settings
        </Button>
        <Button variant="ghost" onClick={() => form.reset()} disabled={!form.dirty || form.submitting}>
          Reset
        </Button>
      </div>
    </form>
  );
}

export function ServerOverviewTab({ server, abilities, canChangeStatus, canTrust, onOpenKeys }: ServerOverviewTabProps) {
  const online = isServerOnline(server.last_seen_at);
  return (
    <div className="stack">
      {server.status === 'pending' && (
        <div className="alert alert-warning">
          <div className="alert-title">This server has not completed registration yet.</div>
          Run <code>trust register &lt;token&gt;</code> in the SCP:SL server console. If the token expired, create a new one in the{' '}
          <button type="button" className="btn btn-link btn-sm" onClick={onOpenKeys}>
            Keys tab
          </button>
          .
        </div>
      )}
      {server.status === 'suspended' && (
        <div className="alert alert-warning">
          <div className="alert-title">This server is suspended.</div>
          Signed plugin requests are rejected until a network administrator re-activates it.
        </div>
      )}
      {server.status === 'revoked' && (
        <div className="alert alert-danger">
          <div className="alert-title">This server has been revoked.</div>
          It can no longer talk to the network.
        </div>
      )}
      {server.key_rotation_requested_at !== null && (
        <div className="alert alert-info">
          <div className="alert-title">Key rotation requested.</div>
          The plugin rotates its key on its next heartbeat (requested <RelativeTime value={server.key_rotation_requested_at} />).
        </div>
      )}

      <div className="grid-2">
        <Card title="Identity & status">
          <KeyValueList
            items={[
              {
                label: 'Server id',
                value: (
                  <span className="row" style={{ gap: 6 }}>
                    <span className="mono">{server.server_id}</span>
                    <CopyButton value={server.server_id} />
                  </span>
                ),
              },
              {
                label: 'Status',
                value: (
                  <span className="row" style={{ gap: 6 }}>
                    <StatusBadge kind="serverStatus" value={server.status} dot />
                    {server.status === 'active' && <Badge tone={online ? 'success' : 'muted'}>{online ? 'Online' : 'Offline'}</Badge>}
                  </span>
                ),
              },
              {
                label: 'Public key fingerprint',
                value:
                  server.key_fingerprint === null ? (
                    <span className="text-faint">no active key</span>
                  ) : (
                    <span className="row" style={{ gap: 6 }}>
                      <span className="mono break-all">{server.key_fingerprint}</span>
                      <CopyButton value={server.key_fingerprint} />
                    </span>
                  ),
              },
              { label: 'Trusted', value: server.is_trusted ? <Badge tone="success">Trusted server</Badge> : <span className="text-muted">Not trusted</span> },
              { label: 'Owner', value: server.owner.username },
              { label: 'Description', value: server.description },
            ]}
          />
        </Card>
        <Card title="Plugin & activity">
          <KeyValueList
            items={[
              { label: 'Created', value: <DateTime value={server.created_at} /> },
              { label: 'Registered', value: <DateTime value={server.registered_at} empty="not registered" /> },
              {
                label: 'Last seen',
                value:
                  server.last_seen_at === null ? (
                    <span className="text-faint">never</span>
                  ) : (
                    <span>
                      <RelativeTime value={server.last_seen_at} /> <span className="text-muted text-xs">(<DateTime value={server.last_seen_at} />)</span>
                    </span>
                  ),
              },
              { label: 'Plugin version', value: server.plugin_version },
              { label: 'Game version', value: server.game_version },
              { label: 'Policy version', value: server.policy_version === null ? null : `v${server.policy_version}` },
              { label: 'Whitelist requests', value: server.accepts_whitelist_requests ? <Badge tone="success">Accepted</Badge> : <Badge tone="muted">Disabled</Badge> },
              { label: 'Updated', value: <DateTime value={server.updated_at} /> },
            ]}
          />
        </Card>
      </div>

      {abilities.manage ? (
        <Card title="Settings">
          <ServerSettingsForm key={server.updated_at} server={server} />
        </Card>
      ) : (
        <Card title="Settings">
          <p className="text-sm text-muted">Only server owners and admins can change the name, description and whitelist-request setting of this server.</p>
        </Card>
      )}

      {(canChangeStatus || canTrust) && <ServerAdminActions server={server} canChangeStatus={canChangeStatus} canTrust={canTrust} />}

      <Card title="Related">
        <ul className="stack-sm text-sm" style={{ paddingLeft: 'var(--sp-4)' }}>
          <li>
            <Link to={`/whitelist-requests?server_id=${encodeURIComponent(server.server_id)}`}>Whitelist requests for this server</Link>
          </li>
          <li>
            <Link to={`/cases?server_id=${encodeURIComponent(server.server_id)}`}>Cases this server reported or confirmed</Link>
          </li>
        </ul>
      </Card>
    </div>
  );
}
