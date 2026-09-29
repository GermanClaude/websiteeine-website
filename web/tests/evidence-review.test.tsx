import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetClientState } from '../src/api/client';
import { EvidenceReviewForm, suggestOverallStatus } from '../src/pages/evidence/EvidenceReviewForm';
import { fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';
import { EVIDENCE_ID, fakeEvidenceDetail } from './moderation-fixtures';

describe('evidence review form', () => {
  let restore: () => void = () => undefined;

  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('sends the three assessments separately plus the overall status and comment', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      if (call.url === `/api/v1/evidence/${EVIDENCE_ID}/reviews` && call.method === 'POST') {
        const body = call.body as Record<string, string>;
        return jsonResponse(201, {
          id: '0a1b2c3d-aaaa-4aaa-8aaa-00000000000a',
          evidence_id: EVIDENCE_ID,
          reviewer: { reviewer_number: 184, pseudonym: 'Reviewer #184' },
          comment: body.comment,
          status: body.status,
          identity_status: body.identity_status,
          authenticity_status: body.authenticity_status,
          cheating_status: body.cheating_status,
          created_at: '2026-09-22T10:00:00.000Z',
        });
      }
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<EvidenceReviewForm evidence={fakeEvidenceDetail()} />);
    const user = userEvent.setup();

    const identity = await screen.findByLabelText(/1\. Is the identity/);
    const authenticity = screen.getByLabelText(/2\. Is the evidence authentic/);
    const cheating = screen.getByLabelText(/3\. Does the evidence actually demonstrate cheating/);
    const overall = screen.getByLabelText(/Overall status/);

    await user.selectOptions(identity, 'verified');
    await user.selectOptions(authenticity, 'verified');
    await user.selectOptions(cheating, 'rejected');
    await user.selectOptions(overall, 'inconclusive');
    await user.type(screen.getByLabelText(/Review comment/), 'Identity and file are genuine, but no cheating visible.');
    await user.click(screen.getByRole('button', { name: 'Record review' }));

    await waitFor(() => {
      const reviewCall = mock.calls.find((call) => call.url === `/api/v1/evidence/${EVIDENCE_ID}/reviews`);
      expect(reviewCall).toBeDefined();
      expect(reviewCall?.body).toEqual({
        identity_status: 'verified',
        authenticity_status: 'verified',
        cheating_status: 'rejected',
        status: 'inconclusive',
        comment: 'Identity and file are genuine, but no cheating visible.',
      });
    });
    expect(await screen.findByText(/Evidence review recorded/)).toBeInTheDocument();
  });

  it('requires a comment before submitting', async () => {
    const mock = mockFetch((call: RecordedCall) => {
      if (call.url === '/api/v1/auth/session') return jsonResponse(200, fakeSession('reviewer'));
      if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('reviewer'));
      return undefined;
    });
    restore = mock.restore;

    renderWithProviders(<EvidenceReviewForm evidence={fakeEvidenceDetail()} />);
    const user = userEvent.setup();
    await screen.findByLabelText(/1\. Is the identity/);
    await user.click(screen.getByRole('button', { name: 'Record review' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(mock.calls.some((call) => call.url.endsWith('/reviews'))).toBe(false);
  });

  it('suggests an overall status from the three answers', () => {
    expect(suggestOverallStatus('verified', 'verified', 'verified')).toBe('verified');
    expect(suggestOverallStatus('verified', 'rejected', 'verified')).toBe('rejected');
    expect(suggestOverallStatus('unverified', 'unverified', 'unverified')).toBe('unverified');
    expect(suggestOverallStatus('verified', 'inconclusive', 'verified')).toBe('inconclusive');
  });
});
