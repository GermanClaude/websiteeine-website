import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { z } from 'zod';

import {
  LIMITS,
  PasswordChangeRequestSchema,
  TwoFactorConfirmRequestSchema,
  TwoFactorEnableRequestSchema,
  type SessionListItem,
  type TwoFactorSetupResponse,
} from '@scpsl-trust/shared';

import {
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  listSessions,
  regenerateRecoveryCodes,
  revokeSession,
  setupTwoFactor,
} from '../../api/auth';
import { getErrorMessage } from '../../api/client';
import { authKeys } from '../../api/keys';
import type { MfaRedirectState } from '../../auth/MfaEnrollmentGate';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CodeBlock, SecretDisplay } from '../../components/CodeBlock';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { ErrorState, FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { truncateEnd } from '../../lib/format';

// ---------------------------------------------------------------------------
// Change password
// ---------------------------------------------------------------------------

const PasswordFormSchema = z
  .object({
    ...PasswordChangeRequestSchema.shape,
    new_password_confirm: z.string(),
  })
  .refine((values) => values.new_password === values.new_password_confirm, {
    message: 'Passwords do not match',
    path: ['new_password_confirm'],
  })
  .refine((values) => values.current_password !== values.new_password, {
    message: 'New password must differ from the current password',
    path: ['new_password'],
  });

function ChangePasswordCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const form = useZodForm({
    schema: PasswordFormSchema,
    initialValues: { current_password: '', new_password: '', new_password_confirm: '' },
    onSubmit: async (values) => {
      await changePassword({ current_password: values.current_password, new_password: values.new_password });
      toast.success('Password changed. Your other sessions were signed out.');
      form.reset();
      await queryClient.invalidateQueries({ queryKey: authKeys.sessions });
    },
  });

  return (
    <Card title="Change password">
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <Input label="Current password" type="password" autoComplete="current-password" required {...form.field('current_password')} />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint={`${LIMITS.PASSWORD_MIN}–${LIMITS.PASSWORD_MAX} characters; must not equal your email or username.`}
          {...form.field('new_password')}
        />
        <Input label="Confirm new password" type="password" autoComplete="new-password" required {...form.field('new_password_confirm')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

interface SetupState extends TwoFactorSetupResponse {
  qrDataUrl: string | null;
}

async function toQrDataUrl(uri: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(uri, { margin: 1, width: 180 });
  } catch {
    return null;
  }
}

function EnrollPanel({ setup, onEnabled, onCancel }: { setup: SetupState; onEnabled: (codes: string[]) => void; onCancel: () => void }) {
  const form = useZodForm({
    schema: TwoFactorEnableRequestSchema,
    initialValues: { code: '' },
    onSubmit: async (values) => {
      const response = await enableTwoFactor(values);
      onEnabled(response.recovery_codes);
    },
  });

  return (
    <div className="stack">
      <ol className="text-sm stack-sm">
        <li>Install an authenticator app (e.g. Aegis, Google Authenticator, 1Password).</li>
        <li>Scan the QR code, or enter the secret manually.</li>
        <li>Enter the current 6-digit code to confirm.</li>
      </ol>
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-4)' }}>
        {setup.qrDataUrl !== null ? (
          <img className="qr-image" src={setup.qrDataUrl} alt="QR code for your authenticator app" />
        ) : (
          <div className="alert alert-warning">QR code could not be rendered; use the manual secret.</div>
        )}
        <div className="stack-sm" style={{ flex: 1, minWidth: 220 }}>
          <div className="text-xs text-muted">Manual secret (Base32)</div>
          <CodeBlock value={setup.secret} inline />
          <div className="text-xs text-muted">Type: time-based (TOTP), 6 digits, 30 seconds</div>
        </div>
      </div>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <Input label="Confirmation code" inputMode="numeric" autoComplete="one-time-code" mono required autoFocus {...form.field('code')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting}>
            Enable two-factor authentication
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Password + code confirmation used for disabling 2FA and regenerating recovery codes. */
function ConfirmWithCodeModal({
  open,
  title,
  description,
  submitLabel,
  tone = 'primary',
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  tone?: 'primary' | 'danger';
  onSubmit: (values: { password: string; code: string }) => Promise<void>;
  onClose: () => void;
}) {
  const form = useZodForm({
    schema: TwoFactorConfirmRequestSchema,
    initialValues: { password: '', code: '' },
    onSubmit: async (values) => {
      await onSubmit(values);
      form.reset();
    },
  });

  const close = () => {
    form.reset();
    onClose();
  };

  return (
    <Modal open={open} title={title} onClose={close} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <p className="text-sm text-muted">{description}</p>
        <Input label="Password" type="password" autoComplete="current-password" required data-autofocus {...form.field('password')} />
        <Input label="Authentication or recovery code" mono autoComplete="one-time-code" required {...form.field('code')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant={tone} loading={form.submitting}>
            {submitLabel}
          </Button>
          <Button variant="ghost" onClick={close} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TwoFactorCard({ highlight }: { highlight: boolean }) {
  const auth = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [regenerateOpen, setRegenerateOpen] = useState(false);

  const startSetup = useMutation({
    mutationFn: async (): Promise<SetupState> => {
      const response = await setupTwoFactor();
      return { ...response, qrDataUrl: await toQrDataUrl(response.otpauth_uri) };
    },
    onSuccess: (state) => setSetup(state),
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const onEnabled = (codes: string[]) => {
    setSetup(null);
    setRecoveryCodes(codes);
  };

  const acknowledgeCodes = async () => {
    setRecoveryCodes(null);
    await auth.refresh();
    toast.success('Two-factor authentication is active.');
  };

  const enabled = auth.mfaEnabled;

  return (
    <Card
      id="two-factor"
      title="Two-factor authentication"
      actions={enabled ? <Badge tone="success">Enabled</Badge> : <Badge tone={highlight ? 'danger' : 'warning'}>Disabled</Badge>}
    >
      {recoveryCodes !== null ? (
        <SecretDisplay
          title="Recovery codes"
          values={recoveryCodes}
          description="Each code signs you in once if you lose access to your authenticator app. Store them somewhere safe."
          downloadFilename="scpsl-trust-recovery-codes.txt"
          onAcknowledge={() => void acknowledgeCodes()}
          acknowledgeLabel="Done"
        />
      ) : setup !== null ? (
        <EnrollPanel setup={setup} onEnabled={onEnabled} onCancel={() => setSetup(null)} />
      ) : enabled ? (
        <div className="stack-sm">
          <p className="text-sm">Signing in requires a code from your authenticator app or a recovery code.</p>
          <div className="row">
            <Button onClick={() => setRegenerateOpen(true)}>Regenerate recovery codes</Button>
            <Button variant="danger" onClick={() => setDisableOpen(true)}>
              Disable 2FA
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          <p className="text-sm">
            Protect your account with a time-based one-time code. {highlight ? 'Your role requires it before you can use the panel.' : 'Recommended for everyone.'}
          </p>
          <div>
            <Button variant="primary" onClick={() => startSetup.mutate()} loading={startSetup.isPending}>
              Set up two-factor authentication
            </Button>
          </div>
        </div>
      )}

      <ConfirmWithCodeModal
        open={disableOpen}
        title="Disable two-factor authentication"
        description="Confirm with your password and a current code. Your other sessions will be signed out."
        submitLabel="Disable 2FA"
        tone="danger"
        onClose={() => setDisableOpen(false)}
        onSubmit={async (values) => {
          await disableTwoFactor(values);
          setDisableOpen(false);
          await auth.refresh();
          toast.success('Two-factor authentication disabled.');
        }}
      />
      <ConfirmWithCodeModal
        open={regenerateOpen}
        title="Regenerate recovery codes"
        description="Your previous recovery codes stop working immediately."
        submitLabel="Regenerate"
        onClose={() => setRegenerateOpen(false)}
        onSubmit={async (values) => {
          const response = await regenerateRecoveryCodes(values);
          setRegenerateOpen(false);
          setRecoveryCodes(response.recovery_codes);
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function SessionsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: authKeys.sessions, queryFn: listSessions });
  const [revoking, setRevoking] = useState<SessionListItem | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: async () => {
      setRevoking(null);
      toast.success('Session revoked.');
      await queryClient.invalidateQueries({ queryKey: authKeys.sessions });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: readonly Column<SessionListItem>[] = [
    {
      key: 'device',
      header: 'Device',
      wrap: true,
      render: (row) => (
        <span className="row">
          <span title={row.user_agent ?? undefined}>{row.user_agent === null ? <span className="text-faint">Unknown device</span> : truncateEnd(row.user_agent, 60)}</span>
          {row.current && <Badge tone="info">This session</Badge>}
        </span>
      ),
    },
    { key: 'created', header: 'Signed in', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
    { key: 'seen', header: 'Last active', render: (row) => <RelativeTime value={row.last_seen_at} />, sortValue: (row) => row.last_seen_at },
    { key: 'expires', header: 'Expires', render: (row) => <DateTime value={row.expires_at} /> },
    {
      key: 'mfa',
      header: '2FA',
      render: (row) => (row.mfa_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="muted">No</Badge>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) =>
        row.current ? null : (
          <Button size="sm" variant="danger" onClick={() => setRevoking(row)}>
            Revoke
          </Button>
        ),
    },
  ];

  return (
    <Card title="Active sessions" flush actions={<Button size="sm" onClick={() => void sessions.refetch()} loading={sessions.isFetching}>Refresh</Button>}>
      <DataTable
        columns={columns}
        rows={sessions.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={sessions.isPending}
        error={sessions.isError ? <ErrorState error={sessions.error} compact onRetry={() => void sessions.refetch()} /> : undefined}
        defaultSort={{ key: 'seen', direction: 'desc' }}
      />
      <ConfirmDialog
        open={revoking !== null}
        title="Revoke session"
        message="The device will be signed out immediately."
        confirmLabel="Revoke"
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (revoking !== null) revoke.mutate(revoking.id);
        }}
        onCancel={() => setRevoking(null)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SecurityPage() {
  const auth = useAuth();
  const location = useLocation();
  const redirectedForMfa = (location.state as MfaRedirectState | null)?.mfaEnrollment === true;
  const mustEnroll = auth.mfaEnrollmentRequired;

  return (
    <>
      <PageHeader title="Security" subtitle="Password, two-factor authentication and active sessions." />
      {(mustEnroll || redirectedForMfa) && !auth.mfaEnabled && (
        <div className="alert alert-warning mb-4" role="alert">
          <div className="alert-title">Two-factor authentication is required for your role</div>
          Enable it below to unlock the rest of the panel. Until then only your account pages are available.
        </div>
      )}
      <div className="stack">
        <TwoFactorCard highlight={mustEnroll} />
        <ChangePasswordCard />
        <SessionsCard />
      </div>
    </>
  );
}

export default SecurityPage;
