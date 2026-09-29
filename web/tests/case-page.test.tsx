import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { CaseDetailPage } from '../src/pages/cases/CaseDetailPage';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';
import { CASE_NUMBER, SERVER_ID, fakeCase } from './moderation-fixtures';

function app() {
  return (
    <Routes>
      <Route path="/cases/:caseNumber" element={<CaseDetailPage />} />
    </Routes>
  );
}

describe('case page', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('renders the header, summary and every section for a reviewer, with review actions', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      if (call.url === `/api/v1/cases/${CASE_NUMBER}`) return jsonResponse(200, fakeCase());
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: `/cases/${CASE_NUMBER}` });

    // The title renders while loading too; wait for the case data itself.
    expect(await screen.findByText('Reported for aimbot')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(CASE_NUMBER) })).toBeInTheDocument();

    const tabs = screen.getByRole('tablist', { name: 'Case sections' });
    for (const label of ['Reports', 'Evidence', 'Review history', 'Appeals', 'Server confirmations', 'Audit history']) {
      expect(within(tabs).getByRole('tab', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }

    // Reports tab is shown by default with the report row.
    expect(screen.getByText('Aimbot on Surface')).toBeInTheDocument();

    // Reviewer actions.
    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set verdict' })).toBeInTheDocument();
    // case:reopen is moderator+; reviewers never see it.
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('hides review actions from a server team member without the permissions', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('server_admin'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('server_admin', { servers: [{ server_id: SERVER_ID, name: 'Alpha Server', role: 'admin' }] }));
      if (call.url === `/api/v1/cases/${CASE_NUMBER}`) return jsonResponse(200, fakeCase());
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: `/cases/${CASE_NUMBER}` });

    expect(await screen.findByRole('tablist', { name: 'Case sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(CASE_NUMBER) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set verdict' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });

  it('falls back to the public view when the staff view is forbidden', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('player'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('player'));
      if (call.url === `/api/v1/cases/${CASE_NUMBER}`) return errorResponse(403, 'FORBIDDEN', 'Insufficient permissions');
      if (call.url === `/api/v1/public/cases/${CASE_NUMBER}`) {
        return jsonResponse(200, {
          case_number: CASE_NUMBER,
          player: { user_id: '76561198000000001@steam', display_name: 'Suspect' },
          status: 'open',
          verdict: 'unknown',
          public_summary: null,
          verdict_set_at: null,
          report_count: 1,
          evidence_count: 1,
          verified_evidence_count: 0,
          confirmed_servers: 0,
          appeal_status: null,
          created_at: '2026-09-20T10:00:00.000Z',
          updated_at: '2026-09-21T10:00:00.000Z',
        });
      }
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: `/cases/${CASE_NUMBER}` });

    expect(await screen.findByText(/public view/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set verdict' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});
