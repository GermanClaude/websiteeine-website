/**
 * Spec compliance (REQUIREMENTS §12/§29 "evidence should have controlled access", ARCHITECTURE §11.3:
 * evidence metadata → evidence:view, the uploader, members of the uploader server).
 *
 * A server_admin whose server reported on a case is denied GET /evidence/{id} for evidence uploaded by a
 * web user, but GET /cases/{caseNumber} returns the same evidence metadata including the uploader's
 * username (which the evidence endpoint deliberately redacts for non-reviewers). This leak (review
 * finding SPEC-3) is fixed: the own_servers staff view only lists evidence the caller may access.
 */
import { describe, expect, it } from 'vitest';

import { createServerWithKey, createUser, loginAs, randomSteamId, signedRequest, useTestApp } from '../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

describe('case staff view vs evidence access rule', () => {
  it('does not leak evidence the caller may not access', async () => {
    const identity = await createServerWithKey(t().deps); // owner has role server_admin
    const player = { type: 'steam' as const, id: randomSteamId() };
    const sr = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player, reason: 'aimbot' },
    });
    expect(sr.statusCode).toBe(201);
    const caseNumber = sr.json().case_id as string;

    const { user: reporter } = await createUser(t().deps, { username: 'secret_witness' });
    const rs = await loginAs(t().app, reporter);
    const rep = await t().app.inject({ method: 'POST', url: '/api/v1/reports', headers: rs.headers, body: { player, reason: 'aimbot too' } });
    expect(rep.statusCode).toBe(201);
    expect(rep.json().case_id).toBe(caseNumber);
    const ev = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseNumber}/evidence/link`,
      headers: rs.headers,
      body: { url: 'https://example.org/clip', title: 'my clip' },
    });
    expect(ev.statusCode).toBe(201);
    const evidenceId = ev.json().id as string;

    const os = await loginAs(t().app, identity.owner);
    const direct = await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${evidenceId}`, headers: os.headers });
    expect(direct.statusCode).toBe(403);

    const staff = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${caseNumber}`, headers: os.headers });
    expect(staff.statusCode).toBe(200);
    const leaked = (staff.json().evidence as { id: string; uploader_user: { username: string } | null }[]).find((e) => e.id === evidenceId);
    // Expected: either absent, or at least without the uploader identity.
    expect(leaked === undefined || leaked.uploader_user === null).toBe(true);
  });
});
