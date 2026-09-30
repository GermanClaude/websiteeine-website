import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { RegisterPage } from '../src/pages/auth/RegisterPage';
import { errorResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

describe('register page', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('lists the concrete password problems the backend reports (PASSWORD_TOO_WEAK details.problems)', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === '/api/v1/auth/register')
        return errorResponse(400, 'PASSWORD_TOO_WEAK', 'Password does not meet the password requirements', {
          problems: ['Password must not contain the email or username'],
        });
      return undefined;
    });
    restore = mock.restore;
    renderWithProviders(
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
      </Routes>,
      { route: '/register' },
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Email/), 'player@example.test');
    await user.type(screen.getByLabelText(/^Username/), 'smoke_player');
    const [password, confirm] = document.querySelectorAll<HTMLInputElement>('input[autocomplete="new-password"]');
    await user.type(password!, 'Player-Horse-Battery-7');
    await user.type(confirm!, 'Player-Horse-Battery-7');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Password does not meet the password requirements');
    expect(alert).toHaveTextContent('Password must not contain the email or username');
    expect(screen.getByText(/must not equal or contain your email or username/)).toBeInTheDocument();
  });
});
