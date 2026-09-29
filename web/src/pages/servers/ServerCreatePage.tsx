import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { LIMITS, ServerCreateRequestSchema, type ServerCreateResponse } from '@scpsl-trust/shared';

import { createServer, serverKeys } from '../../api/servers';
import { Button, LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Checkbox, Input, Textarea } from '../../components/FormField';
import { serverPath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { useZodForm } from '../../components/useZodForm';
import { RegistrationTokenPanel } from './RegistrationTokenPanel';

export function ServerCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<ServerCreateResponse | null>(null);

  const form = useZodForm({
    schema: ServerCreateRequestSchema,
    initialValues: { name: '', description: '', accepts_whitelist_requests: true },
    onSubmit: async (values) => {
      const response = await createServer(values);
      setCreated(response);
      await queryClient.invalidateQueries({ queryKey: serverKeys.all });
    },
  });

  if (created !== null) {
    return (
      <>
        <PageHeader
          title="Server created"
          breadcrumbs={[{ label: 'Servers', to: '/servers' }, { label: created.server.name }]}
          subtitle="The registration token below is shown only once."
        />
        <Card title="Registration token">
          <RegistrationTokenPanel
            serverId={created.server.server_id}
            serverName={created.server.name}
            token={created.registration_token}
            expiresAt={created.registration_token_expires_at}
            onAcknowledge={() => void navigate(serverPath(created.server.server_id), { replace: true })}
            acknowledgeLabel="Continue to the server"
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Register new server" breadcrumbs={[{ label: 'Servers', to: '/servers' }, { label: 'New' }]} />
      <div className="grid-2">
        <Card title="Server details">
          <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
            <Input
              label="Name"
              required
              maxLength={LIMITS.SERVER_NAME_MAX}
              hint={`${LIMITS.SERVER_NAME_MIN}–${LIMITS.SERVER_NAME_MAX} characters, shown to reviewers and players.`}
              autoFocus
              {...form.field('name')}
            />
            <Textarea label="Description (optional)" maxLength={LIMITS.SERVER_DESCRIPTION_MAX} rows={3} {...form.field('description')} />
            <Checkbox
              label="Accept whitelist requests from players"
              hint="Players can ask your team for a VPN or account-age whitelist through the panel."
              {...form.checkbox('accepts_whitelist_requests')}
            />
            <FormError error={form.formError} />
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={form.submitting}>
                Create server and get token
              </Button>
              <LinkButton to="/servers" variant="ghost">
                Cancel
              </LinkButton>
            </div>
          </form>
        </Card>
        <Card title="What happens next">
          <ol className="stack-sm text-sm">
            <li>The server is created in status pending and you become its owner.</li>
            <li>You receive a one-time registration token (valid 24 hours).</li>
            <li>
              Run <code>trust register &lt;token&gt;</code> in the SCP:SL server console; the plugin creates its key pair locally and proves
              possession. The private key never leaves the game server.
            </li>
            <li>The server becomes active with the conservative default policy (admin notifications only). Adjust it in the Policy tab.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}

export default ServerCreatePage;
