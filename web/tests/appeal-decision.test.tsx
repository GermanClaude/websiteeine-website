import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserRole } from '@scpsl-trust/shared';

import { resetClientState } from '../src/api/client';
import { AppealDetailPage } from '../src/pages/appeals/AppealDetailPage';
import { APPEAL_ID, fakeAppeal } from './area-fixtures';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

describe('AppealDetailPage decision', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  function install(role: UserRole, decisionResponse: (call: RecordedCall) => Response) {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession(role));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe(role));
      if (call.url === `/api/v1/appeals/${APPEAL_ID}` && call.method === 'GET') return jsonResponse(200, fakeAppeal());
      if (call.url === `/api/v1/appeals/${APPEAL_ID}/decision` && call.method === 'POST') return decisionResponse(call);
      return errorResponse(404, 'NOT_FOUND', 'Resource not found');
    });
    restore = mock.restore;
    return mock;
  }

  function renderPage() {
    return renderWithProviders(
      <Routes>
        <Route path="/appeals/:id" element={<AppealDetailPage />} />
      </Routes>,
      { route: `/appeals/${APPEAL_ID}` },
    );
  }

  it('surfaces CONFLICT_OF_INTEREST clearly and hides the override for reviewers', async () => {
    const mock = install('reviewer', () => errorResponse(409, 'CONFLICT_OF_INTEREST', 'You cannot decide on a case you are involved in'));
    renderPage();
    const user = userEvent.setup();

    const form = await screen.findByRole('form', { name: 'Decide appeal' });
    expect(within(form).queryByLabelText(/Override conflict of interest/)).not.toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText('Decision'), 'reverse');
    await user.type(within(form).getByLabelText(/Reason/), 'The evidence does not show cheating.');
    await user.click(within(form).getByRole('button', { name: 'Reverse verdict' }));

    expect(await screen.findByText('Conflict of interest')).toBeInTheDocument();
    expect(screen.getByText(/you cannot decide this appeal/i)).toBeInTheDocument();
    const call = mock.calls.find((entry) => entry.url.endsWith('/decision'));
    expect(call?.body).toEqual({ decision: 'reverse', reason: 'The evidence does not show cheating.', override_conflict: false });
  });

  it('lets a super_admin override the conflict with a warning and renders the decision', async () => {
    const mock = install('super_admin', (call) => {
      const body = call.body as { decision: 'confirm' | 'reverse' | 'inconclusive'; reason: string; override_conflict: boolean };
      return jsonResponse(200, fakeAppeal({ status: 'decided', decision: body.decision, decision_reason: body.reason, conflict_override: body.override_conflict, decided_at: '2026-09-29T12:00:00.000Z', decided_by: { reviewer_number: 7, pseudonym: 'Reviewer #7' } }));
    });
    renderPage();
    const user = userEvent.setup();

    const form = await screen.findByRole('form', { name: 'Decide appeal' });
    await user.click(within(form).getByLabelText(/Override conflict of interest/));
    expect(await screen.findByText(/You are about to decide an appeal on a case you are involved in/)).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Reason/), 'No other reviewer is available this week.');
    await user.click(within(form).getByRole('button', { name: 'Confirm verdict' }));

    await waitFor(() => expect(mock.calls.some((entry) => entry.url.endsWith('/decision'))).toBe(true));
    expect(mock.calls.find((entry) => entry.url.endsWith('/decision'))?.body).toMatchObject({ decision: 'confirm', override_conflict: true });
    expect(await screen.findByText('conflict override')).toBeInTheDocument();
    expect(screen.getByText('No other reviewer is available this week.')).toBeInTheDocument();
  });

  it('shows a generic error for other failures', async () => {
    install('reviewer', () => errorResponse(409, 'INVALID_STATE', 'Operation is not allowed in the current state'));
    renderPage();
    const user = userEvent.setup();
    const form = await screen.findByRole('form', { name: 'Decide appeal' });
    await user.type(within(form).getByLabelText(/Reason/), 'Long enough reason text.');
    await user.click(within(form).getByRole('button', { name: 'Confirm verdict' }));
    expect(await screen.findByText('Operation is not allowed in the current state')).toBeInTheDocument();
  });
});
