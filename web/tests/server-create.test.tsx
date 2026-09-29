import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { ServerCreatePage } from '../src/pages/servers/ServerCreatePage';
import { REGISTRATION_TOKEN, SERVER_ID, fakeServer } from './area-fixtures';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

describe('ServerCreatePage', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('shows the registration token exactly once and hides it after confirmation', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('server_admin'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('server_admin'));
      if (call.url === '/api/v1/servers' && call.method === 'POST') {
        return jsonResponse(201, {
          server: fakeServer(),
          registration_token: REGISTRATION_TOKEN,
          registration_token_expires_at: '2026-09-30T10:00:00.000Z',
        });
      }
      if (call.url === '/api/v1/servers' && call.method === 'GET') return jsonResponse(200, { items: [], page: 1, page_size: 25, total: 0 });
      return errorResponse(404, 'NOT_FOUND', 'Resource not found');
    });
    restore = mock.restore;

    renderWithProviders(
      <Routes>
        <Route path="/servers/new" element={<ServerCreatePage />} />
        <Route path="/servers/:serverId" element={<div>Server page</div>} />
      </Routes>,
      { route: '/servers/new' },
    );
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/^Name/), 'Alpha EU #1');
    await user.click(screen.getByRole('button', { name: 'Create server and get token' }));

    expect(await screen.findByText(REGISTRATION_TOKEN)).toBeInTheDocument();
    expect(screen.getByText(`trust register ${REGISTRATION_TOKEN}`)).toBeInTheDocument();
    const createCall = mock.calls.find((call) => call.url === '/api/v1/servers' && call.method === 'POST');
    expect(createCall?.body).toEqual({ name: 'Alpha EU #1', description: null, accepts_whitelist_requests: true });
    expect(createCall?.headers['x-csrf-token']).toBe('csrf-token-1');

    const continueButton = screen.getByRole('button', { name: 'Continue to the server' });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByLabelText('I have saved this in a safe place'));
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    await waitFor(() => expect(screen.getByText('Server page')).toBeInTheDocument());
    expect(screen.queryByText(REGISTRATION_TOKEN)).not.toBeInTheDocument();
    expect(SERVER_ID).toMatch(/^srv_/);
  });
});
