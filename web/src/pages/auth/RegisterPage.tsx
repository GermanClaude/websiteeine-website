import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { z } from 'zod';

import { LIMITS, RegisterRequestSchema, type RegisterResponse } from '@scpsl-trust/shared';

import { register } from '../../api/auth';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useZodForm } from '../../components/useZodForm';

const RegisterFormSchema = z
  .object({
    ...RegisterRequestSchema.shape,
    password_confirm: z.string(),
  })
  .refine((values) => values.password === values.password_confirm, {
    message: 'Passwords do not match',
    path: ['password_confirm'],
  })
  .refine(
    (values) =>
      values.password.toLowerCase() !== values.email.toLowerCase() && values.password.toLowerCase() !== values.username.toLowerCase(),
    { message: 'Password must not equal the email or username', path: ['password'] },
  );

export function RegisterPage() {
  const auth = useAuth();
  const [result, setResult] = useState<RegisterResponse | null>(null);

  const form = useZodForm({
    schema: RegisterFormSchema,
    initialValues: { email: '', username: '', password: '', password_confirm: '' },
    onSubmit: async (values) => {
      const response = await register({ email: values.email, username: values.username, password: values.password });
      setResult(response);
    },
  });

  if (auth.status === 'authenticated') return <Navigate to="/" replace />;

  if (result !== null) {
    return (
      <Card>
        <PageHeader title="Account created" documentTitle="Account created" />
        {result.email_verification_required ? (
          <p>We sent a verification link to your email address. Open it to activate your account, then sign in.</p>
        ) : (
          <p>Your account is ready.</p>
        )}
        <Link to="/login" className="btn btn-primary">
          Go to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <PageHeader title="Create an account" documentTitle="Create an account" subtitle="Players use an account to link their in-game identity, submit reports, appeals and whitelist requests." />
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <Input label="Email" type="email" autoComplete="email" required {...form.field('email')} />
        <Input
          label="Username"
          autoComplete="username"
          required
          hint={`${LIMITS.USERNAME_MIN}–${LIMITS.USERNAME_MAX} characters: letters, digits, "_", "." or "-".`}
          {...form.field('username')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint={`${LIMITS.PASSWORD_MIN}–${LIMITS.PASSWORD_MAX} characters; must not equal or contain your email or username. A passphrase works well.`}
          {...form.field('password')}
        />
        <Input label="Confirm password" type="password" autoComplete="new-password" required {...form.field('password_confirm')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting} block>
            Create account
          </Button>
        </div>
      </form>
      <div className="auth-links">
        <span />
        <Link to="/login">Already have an account? Sign in</Link>
      </div>
    </Card>
  );
}

export default RegisterPage;
