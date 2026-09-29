import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { PublicCasePage } from '../src/pages/public/PublicCasePage';
import { errorResponse, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';
import { CASE_NUMBER, fakePublicCase } from './moderation-fixtures';

function app() {
  return (
    <Routes>
      <Route path="/public/cases/:caseNumber" element={<PublicCasePage />} />
    </Routes>
  );
}

describe('public case page', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('renders the limited public view without a session', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === `/api/v1/public/cases/${CASE_NUMBER}`) return jsonResponse(200, fakePublicCase());
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: `/public/cases/${CASE_NUMBER}` });

    expect(await screen.findByText('Verified recording shows aim assistance.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(CASE_NUMBER) })).toBeInTheDocument();
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(screen.getByText(/verified of 2/)).toBeInTheDocument();
    // Anonymous visitors get the lookup link, never the staff view, and no staff endpoint is called.
    expect(screen.getByRole('link', { name: 'Look up another case' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open staff view' })).not.toBeInTheDocument();
    expect(mock.calls.some((call) => call.url === `/api/v1/cases/${CASE_NUMBER}`)).toBe(false);
    expect(mock.calls.some((call) => call.url === '/api/v1/me')).toBe(false);
  });

  it('explains an unknown case', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required');
      if (call.url === '/api/v1/public/cases/CASE-2026-999999') return errorResponse(404, 'NOT_FOUND', 'Case not found');
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(app(), { route: '/public/cases/CASE-2026-999999' });
    expect(await screen.findByText(/There is no case with this number/)).toBeInTheDocument();
    expect(screen.getAllByText('Case not found').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Look up another case' })).toBeInTheDocument();
  });
});
