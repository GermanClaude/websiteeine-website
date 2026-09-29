import { useState } from 'react';
import { Link } from 'react-router';

import { PasswordForgotRequestSchema } from '@scpsl-trust/shared';

import { forgotPassword } from '../../api/auth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useZodForm } from '../../components/useZodForm';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useZodForm({
    schema: PasswordForgotRequestSchema,
    initialValues: { email: '' },
    onSubmit: async (values) => {
      await forgotPassword(values);
      setSent(true);
    },
  });

  return (
    <Card>
      <PageHeader title="Reset your password" documentTitle="Forgot password" subtitle="Enter your email address and we will send you a reset link." />
      {sent ? (
        <div className="alert alert-success" role="status">
          If an account exists for that email address, a password reset link has been sent. The link is valid for one hour.
        </div>
      ) : (
        <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
          <Input label="Email" type="email" autoComplete="email" autoFocus required {...form.field('email')} />
          <FormError error={form.formError} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={form.submitting} block>
              Send reset link
            </Button>
          </div>
        </form>
      )}
      <div className="auth-links">
        <Link to="/login">Back to sign in</Link>
      </div>
    </Card>
  );
}

export default ForgotPasswordPage;
