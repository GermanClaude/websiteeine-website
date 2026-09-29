import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { ProofPage } from '../src/pages/proof/ProofPage';
import { datetimeLocalToMs, msToDatetimeLocal } from '../src/pages/proof/proofTime';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';
import { PLAYER_USER_ID, SERVER_ID, SPECTATOR_USER_ID, fakeProof } from './moderation-fixtures';

async function fillForm(user: ReturnType<typeof userEvent.setup>, code: string | null) {
  await user.type(screen.getByLabelText(/^Server id/), SERVER_ID);
  await user.type(screen.getByLabelText(/^Target player user id/), PLAYER_USER_ID);
  await user.type(screen.getByLabelText(/^Spectator user id/), SPECTATOR_USER_ID);
  await user.type(screen.getByLabelText('Unix milliseconds'), '1790000000000');
  if (code !== null) await user.type(screen.getByLabelText(/^Proof code/), code);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('proof verification page', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('works without a session and never shows an expected code the backend did not return', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url.startsWith('/api/v1/evidence/proof?')) return jsonResponse(200, fakeProof());
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<ProofPage />, { route: '/tools/proof' });
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Proof verification' });
    // Anonymous callers must supply the code.
    await fillForm(user, null);
    expect(await screen.findByText('The proof code is required.')).toBeInTheDocument();
    expect(mock.calls.some((call) => call.url.startsWith('/api/v1/evidence/proof'))).toBe(false);

    await user.type(screen.getByLabelText(/^Proof code/), '7k4x92');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByText('Valid proof')).toBeInTheDocument();
    expect(screen.getByText(/does not prove cheating/)).toBeInTheDocument();
    expect(screen.queryByText('Expected code')).not.toBeInTheDocument();
    expect(screen.queryByText('7K4-X92')).not.toBeInTheDocument();

    const proofCall = mock.calls.find((call) => call.url.startsWith('/api/v1/evidence/proof?'));
    const query = new URL(proofCall?.url ?? '', 'http://localhost').searchParams;
    expect(query.get('server_id')).toBe(SERVER_ID);
    expect(query.get('player_id')).toBe(PLAYER_USER_ID);
    expect(query.get('spectator_id')).toBe(SPECTATOR_USER_ID);
    expect(query.get('timestamp')).toBe('1790000000000');
    expect(query.get('code')).toBe('7K4-X92');
    expect(proofCall?.headers['x-csrf-token']).toBeUndefined();
  });

  it('shows the expected code only when the backend includes it (reviewer)', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      if (call.url.startsWith('/api/v1/evidence/proof?')) return jsonResponse(200, fakeProof({ code: '7K4-X92' }));
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<ProofPage />, { route: '/tools/proof' });
    const user = userEvent.setup();

    // Reviewers may omit the code.
    expect(await screen.findByLabelText(/Proof code \(optional for reviewers\)/)).toBeInTheDocument();
    await fillForm(user, null);

    expect(await screen.findByText('Expected code')).toBeInTheDocument();
    expect(screen.getByText('7K4-X92')).toBeInTheDocument();
    await waitFor(() => expect(mock.calls.some((call) => call.url.startsWith('/api/v1/evidence/proof?'))).toBe(true));
  });

  it('reports an invalid proof without leaking which field was wrong', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url.startsWith('/api/v1/evidence/proof?')) return jsonResponse(200, fakeProof({ valid: false, session_id: undefined, window_offset: undefined }));
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<ProofPage />, { route: '/tools/proof' });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Proof verification' });
    await fillForm(user, 'AAA-AAA');

    expect(await screen.findByText('Invalid or unknown proof')).toBeInTheDocument();
    expect(screen.queryByText('Expected code')).not.toBeInTheDocument();
  });

  it('converts between UTC datetime-local values and unix milliseconds', () => {
    expect(datetimeLocalToMs('2026-09-20T15:42:20')).toBe(Date.UTC(2026, 8, 20, 15, 42, 20));
    expect(datetimeLocalToMs('2026-09-20T15:42')).toBe(Date.UTC(2026, 8, 20, 15, 42, 0));
    expect(datetimeLocalToMs('nonsense')).toBeNull();
    expect(msToDatetimeLocal(Date.UTC(2026, 8, 20, 15, 42, 20))).toBe('2026-09-20T15:42:20');
  });
});
