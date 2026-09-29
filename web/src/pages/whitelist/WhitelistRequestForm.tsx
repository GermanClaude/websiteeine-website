/**
 * "Request VPN / account-age whitelist" (§11.6): needs a linked in-game identity; the server
 * must be active and accept whitelist requests. Known servers (memberships or server:manage_any)
 * are offered as suggestions; any `srv_…` id can be typed.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';

import {
  DEFAULTS,
  LIMITS,
  Permission,
  ServerIdSchema,
  WHITELIST_REQUEST_TYPES,
  WhitelistRequestCreateRequestSchema,
  WhitelistRequestTypeSchema,
  type WhitelistRequestCreateRequest,
  type WhitelistRequestView,
} from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { listServers, serverKeys } from '../../api/servers';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Input, Select, Textarea } from '../../components/FormField';
import { humanizeEnum } from '../../components/StatusBadge';
import { useZodForm } from '../../components/useZodForm';
import { intInput } from '../servers/lib/forms';

const TYPE_HINTS: Readonly<Record<string, string>> = {
  vpn_whitelist: 'Ask the server team to let you play through a VPN/proxy on that server.',
  account_age_whitelist: 'Ask the server team to waive their minimum account age for you.',
};

const RequestFormSchema = z.object({
  server_id: z.string().trim().pipe(ServerIdSchema),
  type: WhitelistRequestTypeSchema,
  reason: z.string().trim().min(LIMITS.WHITELIST_REASON_MIN, `At least ${LIMITS.WHITELIST_REASON_MIN} characters`).max(LIMITS.WHITELIST_REASON_MAX),
  requested_days: intInput({ min: LIMITS.WHITELIST_REQUESTED_DAYS_MIN, max: LIMITS.WHITELIST_REQUESTED_DAYS_MAX, label: 'Days' }),
});

export interface WhitelistRequestFormProps {
  onSubmit: (body: WhitelistRequestCreateRequest) => Promise<WhitelistRequestView>;
  /** Preselected server (e.g. from `?server_id=`). */
  initialServerId?: string;
}

export function WhitelistRequestForm({ onSubmit, initialServerId = '' }: WhitelistRequestFormProps) {
  const auth = useAuth();
  const linked = auth.me?.linked_player ?? null;
  const knowsServers = auth.hasServerMembership || auth.hasAnyPermission([Permission.SERVER_MANAGE_ANY, Permission.SERVER_CREATE]);
  const servers = useQuery({
    queryKey: serverKeys.list({ purpose: 'whitelist-form', status: 'active' }),
    queryFn: () => listServers({ status: 'active', page_size: 100 }),
    enabled: knowsServers,
    staleTime: 60_000,
  });

  const form = useZodForm({
    schema: RequestFormSchema,
    initialValues: { server_id: initialServerId, type: 'vpn_whitelist', reason: '', requested_days: '' },
    onSubmit: async (values) => {
      const body = WhitelistRequestCreateRequestSchema.parse({
        server_id: values.server_id,
        type: values.type,
        reason: values.reason,
        requested_days: values.requested_days,
      });
      await onSubmit(body);
      form.reset({ server_id: '', type: 'vpn_whitelist', reason: '', requested_days: '' });
    },
  });

  const formError = form.formError;
  const notLinked = ApiError.is(formError) && formError.code === 'PLAYER_NOT_LINKED';
  const disabledServer = ApiError.is(formError) && formError.code === 'WHITELIST_REQUESTS_DISABLED';

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Request whitelist">
      {linked === null ? (
        <div className="alert alert-warning">
          <div className="alert-title">Link your in-game account first.</div>
          Whitelist requests are submitted for your linked Steam, Discord or Northwood identity. <Link to="/account">Link it under Profile</Link>.
        </div>
      ) : (
        <div className="text-sm text-muted">
          Submitted for <span className="mono">{linked.user_id}</span>
          {linked.display_name !== null && linked.display_name !== '' ? ` (${linked.display_name})` : ''}.
        </div>
      )}
      <div className="form-grid">
        <Input
          label="Server id"
          mono
          required
          placeholder="srv_…"
          list={knowsServers ? 'whitelist-known-servers' : undefined}
          hint={knowsServers ? 'Pick one of your servers or paste the id shown by the server (trust status).' : 'The server shows its id in the whitelist message and in `trust status`.'}
          {...form.field('server_id')}
        />
        {knowsServers && (
          <datalist id="whitelist-known-servers">
            {(servers.data?.items ?? []).map((server) => (
              <option key={server.server_id} value={server.server_id}>
                {server.name}
              </option>
            ))}
          </datalist>
        )}
        <Select
          label="Type"
          options={WHITELIST_REQUEST_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }))}
          hint={TYPE_HINTS[form.values.type]}
          {...form.field('type')}
        />
        <Input
          label="Requested duration (days, optional)"
          type="number"
          inputMode="numeric"
          min={LIMITS.WHITELIST_REQUESTED_DAYS_MIN}
          max={LIMITS.WHITELIST_REQUESTED_DAYS_MAX}
          hint="Leave empty to let the server team decide."
          {...form.field('requested_days')}
        />
      </div>
      <Textarea
        label="Reason"
        required
        rows={4}
        maxLength={LIMITS.WHITELIST_REASON_MAX}
        hint={`${LIMITS.WHITELIST_REASON_MIN}–${LIMITS.WHITELIST_REASON_MAX} characters. Explain why you need the exemption; the server team reads this.`}
        {...form.field('reason')}
      />
      {notLinked ? (
        <div className="alert alert-danger" role="alert">
          A linked in-game identity is required. <Link to="/account">Link your account under Profile</Link> and try again.
        </div>
      ) : disabledServer ? (
        <div className="alert alert-danger" role="alert">
          This server does not accept whitelist requests through the panel. Contact its staff directly.
        </div>
      ) : (
        <FormError error={formError} />
      )}
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting} disabled={linked === null || !auth.hasPermission(Permission.WHITELIST_REQUEST)}>
          Submit request
        </Button>
        <span className="text-xs text-muted">Pending requests expire after {DEFAULTS.WHITELIST_REQUEST_TTL_DAYS} days without a decision.</span>
      </div>
    </form>
  );
}
