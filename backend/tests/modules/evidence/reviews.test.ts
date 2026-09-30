/**
 * Evidence reviews (R2) and the supersede chain (R7): three independent assessments,
 * review history, self-review conflict, one-time supersede.
 */
import { describe, expect, it } from 'vitest';

import { createUser, expectError, sessionFor, useTestApp } from '../../helpers';
import { addReport, createCase, EVIDENCE_MODULES, multipartPayload, pngBytes } from './helpers';

describe('evidence reviews & supersede', () => {
  const t = useTestApp({ now: '2026-09-29T15:42:20.000Z', modules: EVIDENCE_MODULES });

  async function uploadedEvidence(uploaderRole: 'reviewer' | 'player' = 'reviewer') {
    const { user: uploader } = await createUser(t().deps, { role: uploaderRole, totp: uploaderRole === 'reviewer' });
    const { caseRow } = await createCase(t().deps);
    if (uploaderRole === 'player') await addReport(t().deps, caseRow, { userId: uploader.id });
    const session = await sessionFor(t().deps, uploader);
    const { payload, headers } = multipartPayload({ type: 'image', title: 'Shot' }, { filename: 's.png', contentType: 'image/png', data: pngBytes(20) });
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseRow.case_number}/evidence`,
      headers: { ...session.headers, ...headers },
      payload,
    });
    expect(res.statusCode).toBe(201);
    return { uploader, uploaderSession: session, caseRow, evidence: res.json() as { id: string } };
  }

  const review = (id: string, headers: Record<string, string>, body: Record<string, unknown>) =>
    t().app.inject({ method: 'POST', url: `/api/v1/evidence/${id}/reviews`, headers, payload: body });

  const fullReview = {
    status: 'verified',
    identity_status: 'verified',
    authenticity_status: 'verified',
    cheating_status: 'inconclusive',
    comment: 'checked frame by frame',
  };

  it('records review history with three separate assessments and updates the current values', async () => {
    const { evidence, caseRow } = await uploadedEvidence();
    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);

    const res = await review(evidence.id, reviewer.headers, fullReview);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      status: 'verified',
      identity_status: 'verified',
      authenticity_status: 'verified',
      cheating_status: 'inconclusive',
    });
    expect(res.json().reviewer.pseudonym).toMatch(/^Reviewer #\d+$/);

    const second = await review(evidence.id, reviewer.headers, { ...fullReview, status: 'rejected', comment: 'second look' });
    expect(second.statusCode).toBe(201);

    const detail = await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${evidence.id}`, headers: { cookie: reviewer.headers.cookie } });
    expect(detail.json().status).toBe('rejected');
    expect(detail.json().reviews).toHaveLength(2);
    // The case verdict is never touched (R2).
    const caseNow = await t().db.selectFrom('cases').select('current_verdict').where('id', '=', caseRow.id).executeTakeFirstOrThrow();
    expect(caseNow.current_verdict).toBe('unknown');

    const actions = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', evidence.id)
      .execute();
    const names = actions.map((a) => a.action);
    expect(names.filter((n) => n === 'EVIDENCE_REVIEWED')).toHaveLength(2);
    expect(names).toContain('EVIDENCE_VERIFIED');
    expect(names).toContain('EVIDENCE_REJECTED');
  });

  it('rejects a reviewer reviewing their own upload with CONFLICT_OF_INTEREST', async () => {
    const { evidence, uploaderSession } = await uploadedEvidence('reviewer');
    expectError(await review(evidence.id, uploaderSession.headers, fullReview), 409, 'CONFLICT_OF_INTEREST');
  });

  it('requires evidence:review', async () => {
    const { evidence } = await uploadedEvidence();
    const player = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
    expectError(await review(evidence.id, player.headers, fullReview), 403, 'FORBIDDEN');
  });

  describe('supersede', () => {
    const supersede = (id: string, headers: Record<string, string>) => {
      const { payload, headers: mp } = multipartPayload(
        { reason: 'better quality recording' },
        { filename: 'v2.png', contentType: 'image/png', data: pngBytes(40) },
      );
      return t().app.inject({ method: 'POST', url: `/api/v1/evidence/${id}/supersede`, headers: { ...headers, ...mp }, payload });
    };

    it('creates a linked replacement exactly once', async () => {
      const { evidence, uploaderSession } = await uploadedEvidence();
      const res = await supersede(evidence.id, uploaderSession.headers);
      expect(res.statusCode).toBe(201);
      const replacement = res.json();
      expect(replacement.supersedes_evidence_id).toBe(evidence.id);

      const old = await t().db.selectFrom('evidence').select('superseded_by_evidence_id').where('id', '=', evidence.id).executeTakeFirstOrThrow();
      expect(old.superseded_by_evidence_id).toBe(replacement.id);

      const audit = await t()
        .db.selectFrom('audit_events')
        .selectAll()
        .where('action', '=', 'EVIDENCE_SUPERSEDED')
        .where('target_id', '=', evidence.id)
        .executeTakeFirst();
      expect(audit).toBeDefined();

      // Superseding an already superseded object is rejected.
      expectError(await supersede(evidence.id, uploaderSession.headers), 409, 'EVIDENCE_ALREADY_SUPERSEDED');
    });

    it('applies the upload permission', async () => {
      const { evidence } = await uploadedEvidence();
      const player = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
      expectError(await supersede(evidence.id, player.headers), 403, 'FORBIDDEN');
    });
  });
});
