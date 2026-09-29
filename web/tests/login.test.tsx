import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { RequireAuth } from '../src/auth/RequireAuth';
import { LoginPage } from '../src/pages/auth/LoginPage';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

function app() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<div>Dashboard home</div>} />
        <Route path="/cases" element={<div>Cases list</div>} />
      </Route>
    </Routes>
  );
}

describe('login flow', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => {
    resetClientState();
  });

  afterEach(() => {
    restore();
  });

  it('signs in with email and password and lands on the dashboard', async () => {
    const session = fakeSession('reviewer');
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === '/api/v1/auth/login' && call.method === 'POST') {
        const body = call.body as { email: string; password: string };
        if (body.password === 'correct-horse') return jsonResponse(200, { ...session, mfa_required: false });
        return errorResponse(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: '/' });
    const user = userEvent.setup();

    // RequireAuth redirects to /login.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), 'user@example.org');
    await user.type(screen.getByLabelText(/^password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^password/i));
    await user.type(screen.getByLabelText(/^password/i), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
    const loginCall = mock.calls.find((call) => call.url === '/api/v1/auth/login' && (call.body as { password: string }).password === 'correct-horse');
    expect(loginCall?.body).toEqual({ email: 'user@example.org', password: 'correct-horse' });
  });

  it('asks for a second factor when the backend requires it', async () => {
    const session = fakeSession('admin', { user: { ...fakeSession('admin').user, mfa_enabled: true } });
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === '/api/v1/auth/login') return jsonResponse(200, { mfa_required: true, mfa_token: 'mfa-token-abcdefghijklmnop' });
      if (call.url === '/api/v1/auth/login/2fa') {
        const body = call.body as { mfa_token: string; code: string };
        if (body.mfa_token === 'mfa-token-abcdefghijklmnop' && body.code === '123456') return jsonResponse(200, session);
        return errorResponse(401, 'INVALID_MFA_CODE', 'Invalid two-factor authentication code');
      }
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('admin'));
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: '/cases' });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/email/i), 'admin@example.org');
    await user.type(screen.getByLabelText(/^password/i), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const codeInput = await screen.findByLabelText(/authentication code/i);
    await user.type(codeInput, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Invalid two-factor authentication code')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/authentication code/i));
    await user.type(screen.getByLabelText(/authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    // Returns to the page originally requested.
    expect(await screen.findByText('Cases list')).toBeInTheDocument();
    const twoFactorCalls = mock.calls.filter((call) => call.url === '/api/v1/auth/login/2fa');
    expect(twoFactorCalls).toHaveLength(2);
    // The session CSRF token is used for subsequent non-GET requests.
    await waitFor(() => expect(mock.calls.some((call) => call.url === '/api/v1/me')).toBe(true));
  });

  it('offers to resend the verification email when the address is unverified', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === '/api/v1/auth/login') return errorResponse(403, 'EMAIL_NOT_VERIFIED', 'Email address has not been verified');
      if (call.url === '/api/v1/auth/resend-verification') return new Response(null, { status: 202 });
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: '/login' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), 'new@example.org');
    await user.type(screen.getByLabelText(/^password/i), 'whatever-pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const resend = await screen.findByRole('button', { name: /resend verification email/i });
    await user.click(resend);
    await waitFor(() => expect(mock.calls.some((call) => call.url === '/api/v1/auth/resend-verification')).toBe(true));
    expect(mock.calls.find((call) => call.url === '/api/v1/auth/resend-verification')?.body).toEqual({ email: 'new@example.org' });
  });
});
