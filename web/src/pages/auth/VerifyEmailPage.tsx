import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';

import { ResendVerificationRequestSchema } from '@scpsl-trust/shared';

import { resendVerification, verifyEmail } from '../../api/auth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState, FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const toast = useToast();
  const started = useRef(false);

  const verify = useMutation({ mutationFn: verifyEmail });
  const { mutate } = verify;

  useEffect(() => {
    if (token === null || token === '' || started.current) return;
    started.current = true;
    mutate({ token });
  }, [token, mutate]);

  const resend = useZodForm({
    schema: ResendVerificationRequestSchema,
    initialValues: { email: '' },
    onSubmit: async (values) => {
      await resendVerification(values);
      toast.success('If that address belongs to an unverified account, a new link has been sent.');
    },
  });

  let body: React.ReactNode;
  if (token === null || token === '') {
    body = <p className="text-muted">The verification link is incomplete. Open the link from your email again or request a new one below.</p>;
  } else if (verify.isPending || verify.isIdle) {
    body = <LoadingState label="Verifying your email…" />;
  } else if (verify.isSuccess) {
    body = (
      <div className="stack-sm">
        <div className="alert alert-success" role="status">
          Your email address is verified. You can sign in now.
        </div>
        <Link to="/login" className="btn btn-primary">
          Go to sign in
        </Link>
      </div>
    );
  } else {
    body = <ErrorState error={verify.error} title="Verification failed" compact />;
  }

  return (
    <Card>
      <PageHeader title="Verify email" documentTitle="Verify email" />
      {body}
      {!verify.isSuccess && (
        <>
          <hr className="divider" />
          <h3 className="mb-2">Request a new verification link</h3>
          <form className="form" onSubmit={(event) => void resend.handleSubmit(event)} noValidate>
            <Input label="Email" type="email" autoComplete="email" required {...resend.field('email')} />
            <FormError error={resend.formError} />
            <div className="form-actions">
              <Button type="submit" loading={resend.submitting}>
                Send link
              </Button>
            </div>
          </form>
        </>
      )}
      <div className="auth-links">
        <Link to="/login">Back to sign in</Link>
      </div>
    </Card>
  );
}

export default VerifyEmailPage;
