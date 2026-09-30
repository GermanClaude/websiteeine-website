import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { ReportDetailPage } from '../src/pages/reports/ReportDetailPage';
import { fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, USER_ID, type RecordedCall } from './helpers';
import { fakeReport, REPORT_ID } from './moderation-fixtures';

function renderAs(reporterId: string) {
  const mock = mockFetch((call: RecordedCall) => {
    if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('player'));
    if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('player'));
    if (call.url === `/api/v1/reports/${REPORT_ID}`) return jsonResponse(200, fakeReport({ reporter_user: { id: reporterId, username: 'me' } }));
    return undefined;
  });
  renderWithProviders(
    <Routes>
      <Route path="/reports/:id" element={<ReportDetailPage />} />
    </Routes>,
    { route: `/reports/${REPORT_ID}` },
  );
  return mock;
}

describe('report detail page', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('lets the reporting player add evidence (they only see the public case view)', async () => {
    restore = renderAs(USER_ID).restore;
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add evidence' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  it('does not offer the upload to other players', async () => {
    restore = renderAs('0a1b2c3d-9999-4999-8999-000000000009').restore;
    await screen.findByText('Report id');
    expect(screen.queryByRole('button', { name: 'Add evidence' })).toBeNull();
  });
});
