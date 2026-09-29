import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetClientState } from '../src/api/client';
import { CaseVerdictModal } from '../src/pages/cases/CaseActionModals';
import { errorResponse, fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';
import { CASE_NUMBER, fakeCase } from './moderation-fixtures';

describe('verdict modal', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('surfaces INSUFFICIENT_EVIDENCE from the backend with an explanation', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      if (call.url === `/api/v1/cases/${CASE_NUMBER}/verdict` && call.method === 'POST') {
        return errorResponse(422, 'INSUFFICIENT_EVIDENCE', 'A confirmed verdict requires verified authentic evidence');
      }
      return undefined;
    });
    restore = mock.restore;

    const onClose = vi.fn();
    renderWithProviders(<CaseVerdictModal open caseData={fakeCase()} onClose={onClose} />);
    const user = userEvent.setup();

    expect(await screen.findByRole('dialog', { name: 'Set verdict' })).toBeInTheDocument();
    // The rule is explained before submitting.
    expect(screen.getByText(/Rules enforced by the backend/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Verdict/), 'confirmed');
    // No evidence supports "confirmed" yet → warning about INSUFFICIENT_EVIDENCE.
    expect(screen.getByText(/will refuse a confirmed verdict/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Review comment/), 'Clear aimbot in the clip.');
    await user.click(screen.getByRole('button', { name: 'Set verdict' }));

    expect(await screen.findByText('Verdict not accepted')).toBeInTheDocument();
    expect(screen.getByText(/requires at least one piece of evidence/)).toBeInTheDocument();
    expect(screen.getByText('A confirmed verdict requires verified authentic evidence')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await waitFor(() => {
      const verdictCall = mock.calls.find((call) => call.url === `/api/v1/cases/${CASE_NUMBER}/verdict`);
      expect(verdictCall?.body).toEqual({ verdict: 'confirmed', comment: 'Clear aimbot in the clip.', public_summary: null });
      expect(verdictCall?.headers['x-csrf-token']).toBe('csrf-token-1');
    });
  });

  it('explains a conflict of interest', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      if (call.url === `/api/v1/cases/${CASE_NUMBER}/verdict`) return errorResponse(409, 'CONFLICT_OF_INTEREST', 'Reviewer reported on this case');
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<CaseVerdictModal open caseData={fakeCase()} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await screen.findByRole('dialog', { name: 'Set verdict' });
    await user.type(screen.getByLabelText(/Review comment/), 'Nothing conclusive here.');
    await user.click(screen.getByRole('button', { name: 'Set verdict' }));

    expect(await screen.findByText(/You are a reporter on this case/)).toBeInTheDocument();
  });
});
