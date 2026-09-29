import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router';

import { ErrorCode, Login2faRequestSchema, LoginRequestSchema } from '@scpsl-trust/shared';

import { login, login2fa, resendVerification } from '../../api/auth';
import { ApiError } from '../../api/client';
import type { LoginRedirectState } from '../../auth/RequireAuth';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';

const MfaFormSchema = Login2faRequestSchema.pick({ code: true });

const registrationEnabled = import.meta.env.VITE_REGISTRATION_ENABLED !== 'false';

function safeRedirect(from: string | undefined): string {
  if (from === undefined || !from.startsWith('/') || from.startsWith('//') || from.startsWith('/login')) return '/';
  return from;
}

export function LoginPage() {
  const auth = useAuth();
  const toast = useToast();
  const location = useLocation();
  const from = safeRedirect((location.state as LoginRedirectState | null)?.from);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const credentials = useZodForm({
    schema: LoginRequestSchema,
    initialValues: { email: '', password: '' },
    onSubmit: async (values) => {
      setUnverifiedEmail(null);
      setNotice(null);
      try {
        const response = await login(values);
        if (response.mfa_required) {
          setMfaToken(response.mfa_token);
          return;
        }
        auth.setSession(response);
      } catch (error) {
        if (ApiError.is(error) && error.code === ErrorCode.EMAIL_NOT_VERIFIED) setUnverifiedEmail(values.email);
        throw error;
      }
    },
  });

  const mfa = useZodForm({
    schema: MfaFormSchema,
    initialValues: { code: '' },
    onSubmit: async (values) => {
      if (mfaToken === null) return;
      try {
        const session = await login2fa({ mfa_token: mfaToken, code: values.code });
        auth.setSession(session);
      } catch (error) {
        if (ApiError.is(error) && error.code === ErrorCode.MFA_TOKEN_INVALID) {
          setMfaToken(null);
          setNotice('Your sign-in expired. Please enter your credentials again.');
          return;
        }
        throw error;
      }
    },
  });

  if (auth.status === 'authenticated') return <Navigate to={from} replace />;

  const resend = async () => {
    if (unverifiedEmail === null) return;
    setResending(true);
    try {
      await resendVerification({ email: unverifiedEmail });
      toast.success('Verification email sent. Check your inbox.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the verification email.');
    } finally {
      setResending(false);
    }
  };

  if (mfaToken !== null) {
    return (
      <Card>
        <PageHeader title="Sign in" documentTitle="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app or one of your recovery codes." />
        <form className="form" onSubmit={(event) => void mfa.handleSubmit(event)} noValidate>
          <Input
            label="Authentication code"
            autoComplete="one-time-code"
            inputMode="numeric"
            autoFocus
            mono
            required
            {...mfa.field('code')}
          />
          <FormError error={mfa.formError} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={mfa.submitting}>
              Verify
            </Button>
            <Button variant="ghost" onClick={() => setMfaToken(null)}>
              Back
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <PageHeader title="Sign in" documentTitle="Sign in" subtitle="Use your SCP:SL Trust Network account." />
      {notice !== null && (
        <div className="alert alert-info mb-4" role="status">
          {notice}
        </div>
      )}
      <form className="form" onSubmit={(event) => void credentials.handleSubmit(event)} noValidate>
        <Input label="Email" type="email" autoComplete="email" autoFocus required {...credentials.field('email')} />
        <Input label="Password" type="password" autoComplete="current-password" required {...credentials.field('password')} />
        <FormError error={credentials.formError} />
        {unverifiedEmail !== null && (
          <div className="alert alert-warning" role="status">
            Your email address is not verified yet.{' '}
            <Button size="sm" variant="link" onClick={() => void resend()} loading={resending}>
              Resend verification email
            </Button>
          </div>
        )}
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={credentials.submitting} block>
            Sign in
          </Button>
        </div>
      </form>
      <div className="auth-links">
        <Link to="/forgot-password">Forgot password?</Link>
        {registrationEnabled && <Link to="/register">Create an account</Link>}
      </div>
    </Card>
  );
}

export default LoginPage;
