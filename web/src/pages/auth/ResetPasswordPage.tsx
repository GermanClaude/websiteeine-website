import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { LIMITS, PasswordResetRequestSchema } from '@scpsl-trust/shared';

import { resetPassword } from '../../api/auth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';

const ResetFormSchema = z
  .object({
    password: PasswordResetRequestSchema.shape.password,
    password_confirm: z.string(),
  })
  .refine((values) => values.password === values.password_confirm, { message: 'Passwords do not match', path: ['password_confirm'] });

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const toast = useToast();

  const form = useZodForm({
    schema: ResetFormSchema,
    initialValues: { password: '', password_confirm: '' },
    onSubmit: async (values) => {
      await resetPassword({ token, password: values.password });
      toast.success('Your password has been reset. Sign in with your new password.');
      void navigate('/login', { replace: true });
    },
  });

  return (
    <Card>
      <PageHeader title="Choose a new password" documentTitle="Reset password" />
      {token === '' ? (
        <p className="text-muted">The reset link is incomplete. Open the link from your email again or request a new one.</p>
      ) : (
        <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            hint={`${LIMITS.PASSWORD_MIN}–${LIMITS.PASSWORD_MAX} characters; must not equal your email or username.`}
            {...form.field('password')}
          />
          <Input label="Confirm new password" type="password" autoComplete="new-password" required {...form.field('password_confirm')} />
          <FormError error={form.formError} />
          <div className="form-actions">
            <Button type="submit" variant="primary" loading={form.submitting} block>
              Set new password
            </Button>
          </div>
        </form>
      )}
      <div className="auth-links">
        <Link to="/forgot-password">Request a new link</Link>
        <Link to="/login">Back to sign in</Link>
      </div>
    </Card>
  );
}

export default ResetPasswordPage;
