import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { WhitelistRequestTable } from '../src/pages/whitelist/WhitelistRequestTable';
import { REQUEST_ID, fakeWhitelistRequest } from './area-fixtures';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

describe('whitelist decisions', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  function install() {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('player'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('player', { servers: [{ server_id: 'srv_7k4x92m8pq174kf9', name: 'Alpha EU #1', role: 'moderator' }] }));
      if (call.url === `/api/v1/whitelist-requests/${REQUEST_ID}/decision` && call.method === 'POST') {
        const body = call.body as { decision: string };
        return jsonResponse(200, fakeWhitelistRequest({ status: body.decision === 'approve' ? 'approved' : 'rejected', decided_at: '2026-09-29T11:00:00.000Z' }));
      }
      if (call.url === `/api/v1/whitelist-requests/${REQUEST_ID}/revoke` && call.method === 'POST') {
        return jsonResponse(200, fakeWhitelistRequest({ status: 'revoked' }));
      }
      return errorResponse(404, 'NOT_FOUND', 'Resource not found');
    });
    restore = mock.restore;
    return mock;
  }

  it('approves with a duration and a note', async () => {
    const mock = install();
    renderWithProviders(<WhitelistRequestTable rows={[fakeWhitelistRequest()]} canDecide />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve whitelist request' });
    const days = within(dialog).getByLabelText(/Valid for/);
    expect(days).toHaveValue(30);
    await user.clear(days);
    await user.type(days, '14');
    await user.type(within(dialog).getByLabelText(/Note/), 'ok for two weeks');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mock.calls.some((call) => call.url.endsWith('/decision'))).toBe(true));
    const decision = mock.calls.find((call) => call.url.endsWith('/decision'));
    expect(decision?.method).toBe('POST');
    expect(decision?.body).toEqual({ decision: 'approve', note: 'ok for two weeks', days: 14 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('rejects without days', async () => {
    const mock = install();
    renderWithProviders(<WhitelistRequestTable rows={[fakeWhitelistRequest()]} canDecide />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = screen.getByRole('dialog', { name: 'Reject whitelist request' });
    await user.type(within(dialog).getByLabelText(/Note/), 'no');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mock.calls.some((call) => call.url.endsWith('/decision'))).toBe(true));
    const decision = mock.calls.find((call) => call.url.endsWith('/decision'));
    expect(decision?.body).toEqual({ decision: 'reject', note: 'no' });
  });

  it('revokes an approved request with a reason and hides actions without canDecide', async () => {
    const mock = install();
    const { rerender } = renderWithProviders(<WhitelistRequestTable rows={[fakeWhitelistRequest({ status: 'approved', bypass_expires_at: null })]} canDecide />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke approved whitelist' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Abuse reported');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(mock.calls.some((call) => call.url.endsWith('/revoke'))).toBe(true));
    expect(mock.calls.find((call) => call.url.endsWith('/revoke'))?.body).toEqual({ reason: 'Abuse reported' });

    rerender(<WhitelistRequestTable rows={[fakeWhitelistRequest()]} canDecide={false} mine />);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByText('Player')).not.toBeInTheDocument();
  });
});
