/**
 * Reports module: web reports (attach vs new case, duplicates, server rule,
 * numbering under concurrency), signed plugin reports incl. log-excerpt evidence,
 * listing scope, status transitions, permission matrix, audit events.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPlayer, createServerWithKey, createUser, expectError, loginAs, randomSteamId, signedRequest, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

function steamRef(id?: string) {
  return { type: 'steam' as const, id: id ?? randomSteamId() };
}

async function verifiedUser() {
  const { user } = await createUser(t().deps); // verified player by default
  return { user, session: await loginAs(t().app, user) };
}

async function reviewer() {
  const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
  return { user, session: await loginAs(t().app, user) };
}

async function postReport(headers: Record<string, string>, body: unknown) {
  return t().app.inject({ method: 'POST', url: '/api/v1/reports', headers, body: body as never });
}

// ---------------------------------------------------------------------------
// Web reports
// ---------------------------------------------------------------------------

describe('POST /reports', () => {
  it('creates player, case and report; audits CASE_CREATED + REPORT_CREATED', async () => {
    const { session } = await verifiedUser();
    const player = steamRef();
    const res = await postReport(session.headers, { player, reason: 'blatant aimbot', description: 'round 3' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.case_id).toMatch(/^CASE-2026-\d{6}$/);

    const report = await t().db.selectFrom('reports').selectAll().where('id', '=', body.report_id).executeTakeFirstOrThrow();
    expect(report).toMatchObject({ reporter_type: 'user', status: 'open', reason: 'blatant aimbot', description: 'round 3' });

    const actions = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('case_id', '=', report.case_id)
      .orderBy('seq')
      .execute();
    expect(actions.map((a) => a.action)).toEqual(['CASE_CREATED', 'REPORT_CREATED']);
  });

  it('attaches a second report to the existing open case, a new case after closing', async () => {
    const a = await verifiedUser();
    const b = await verifiedUser();
    const player = steamRef();
    const first = (await postReport(a.session.headers, { player, reason: 'aimbot' })).json();
    const second = (await postReport(b.session.headers, { player, reason: 'wallhack' })).json();
    expect(second.case_id).toBe(first.case_id);

    await t().db.updateTable('cases').set({ status: 'closed', closed_at: t().clock.now() }).where('case_number', '=', first.case_id).execute();
    const c = await verifiedUser();
    const third = (await postReport(c.session.headers, { player, reason: 'again' })).json();
    expect(third.case_id).not.toBe(first.case_id);
  });

  it('rejects a duplicate open report by the same reporter with OPEN_REPORT_EXISTS', async () => {
    const { session } = await verifiedUser();
    const player = steamRef();
    expect((await postReport(session.headers, { player, reason: 'aimbot' })).statusCode).toBe(201);
    expectError(await postReport(session.headers, { player, reason: 'still aimbot' }), 409, 'OPEN_REPORT_EXISTS');
    // A different player is fine.
    expect((await postReport(session.headers, { player: steamRef(), reason: 'other guy' })).statusCode).toBe(201);
  });

  it('server_id must name an active server', async () => {
    const { session } = await verifiedUser();
    const suspended = await createServerWithKey(t().deps, { status: 'suspended' });
    expectError(
      await postReport(session.headers, { player: steamRef(), reason: 'xxx', server_id: suspended.server.server_id }),
      409,
      'SERVER_NOT_ACTIVE',
    );
    const active = await createServerWithKey(t().deps);
    const ok = await postReport(session.headers, { player: steamRef(), reason: 'xxx', server_id: active.server.server_id });
    expect(ok.statusCode).toBe(201);
    const report = await t().db.selectFrom('reports').selectAll().where('id', '=', ok.json().report_id).executeTakeFirstOrThrow();
    expect(report.server_id).toBe(active.server.id);
  });

  it('requires a verified email and authentication', async () => {
    const { user } = await createUser(t().deps, { verified: false });
    const session = await loginAs(t().app, user);
    expectError(await postReport(session.headers, { player: steamRef(), reason: 'xxx' }), 403, 'EMAIL_NOT_VERIFIED');
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/reports', body: { player: steamRef(), reason: 'xxx' } }),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('parallel reports for different players get unique sequential case numbers', async () => {
    const { session } = await verifiedUser();
    const players = Array.from({ length: 6 }, () => steamRef());
    const responses = await Promise.all(players.map((player) => postReport(session.headers, { player, reason: 'load test' })));
    for (const res of responses) expect(res.statusCode).toBe(201);
    const numbers = responses.map((res) => res.json().case_id as string);
    expect(new Set(numbers).size).toBe(numbers.length);
    const counters = numbers.map((n) => Number(n.slice('CASE-2026-'.length))).sort((x, y) => x - y);
    for (let i = 1; i < counters.length; i += 1) expect(counters[i]).toBe(counters[i - 1]! + 1);
  });
});

// ---------------------------------------------------------------------------
// Signed plugin reports (§6.5)
// ---------------------------------------------------------------------------

describe('POST /server/reports (signed)', () => {
  it('creates case + report; log excerpt becomes hashed log evidence', async () => {
    const identity = await createServerWithKey(t().deps);
    const excerpt = 'player fired 40 headshots in 2 seconds\nline two';
    const res = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: {
        player: steamRef(),
        reporter: steamRef(),
        reason: 'aimbot',
        description: 'auto-report',
        log_excerpt: excerpt,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();

    const report = await t().db.selectFrom('reports').selectAll().where('id', '=', body.report_id).executeTakeFirstOrThrow();
    expect(report).toMatchObject({ reporter_type: 'server', server_id: identity.server.id });
    expect(report.reporter_player_id).not.toBeNull();

    const evidence = await t().db.selectFrom('evidence').selectAll().where('case_id', '=', report.case_id).executeTakeFirstOrThrow();
    const expectedHash = createHash('sha256').update(Buffer.from(excerpt, 'utf8')).digest('hex');
    expect(evidence).toMatchObject({
      type: 'log',
      mime_type: 'text/plain',
      sha256: expectedHash,
      size_bytes: Buffer.byteLength(excerpt),
      uploader_server_id: identity.server.id,
      report_id: report.id,
    });
    expect(evidence.storage_key).toMatch(/^evidence\/2026\/09\/[0-9a-f-]{36}$/);

    // Stored object matches the hash.
    const stream = await t().deps.storage.get(evidence.storage_key!);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(expectedHash);

    const actions = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'actor_type', 'actor_id'])
      .where('case_id', '=', report.case_id)
      .orderBy('seq')
      .execute();
    expect(actions.map((a) => a.action)).toEqual(['CASE_CREATED', 'REPORT_CREATED', 'EVIDENCE_UPLOADED']);
    expect(actions.every((a) => a.actor_type === 'server' && a.actor_id === identity.server.server_id)).toBe(true);
  });

  it('works without reporter and log excerpt; duplicate open server report is rejected', async () => {
    const identity = await createServerWithKey(t().deps);
    const player = steamRef();
    const first = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player, reason: 'suspicious' },
    });
    expect(first.statusCode).toBe(201);
    const firstReport = await t()
      .db.selectFrom('reports')
      .select('case_id')
      .where('id', '=', first.json().report_id)
      .executeTakeFirstOrThrow();
    expect(await t().db.selectFrom('evidence').selectAll().where('case_id', '=', firstReport.case_id).execute()).toHaveLength(0);

    const dup = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player, reason: 'still suspicious' },
    });
    expectError(dup, 409, 'OPEN_REPORT_EXISTS');
  });

  it('rejects unsigned and tampered requests', async () => {
    const identity = await createServerWithKey(t().deps);
    const body = { player: steamRef(), reason: 'xxx' };
    const unsigned = await t().app.inject({ method: 'POST', url: '/api/v1/server/reports', body });
    expect(unsigned.statusCode).toBe(401);
    const tampered = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body,
      sign: { body: JSON.stringify({ player: steamRef(), reason: 'other' }) },
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('rejects a self-report and an oversized log excerpt', async () => {
    const identity = await createServerWithKey(t().deps);
    const ref = steamRef();
    const self = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player: ref, reporter: ref, reason: 'self' },
    });
    expect(self.statusCode).toBe(400);

    // > 64 KiB excerpt fails validation; > 128 KiB bodies are cut off by bodyLimit (413).
    const big = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player: steamRef(), reason: 'big', log_excerpt: 'a'.repeat(65537) },
    });
    expect(big.statusCode).toBe(400);
    const huge = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/server/reports',
      body: { player: steamRef(), reason: 'huge', log_excerpt: 'a'.repeat(140000) },
    });
    expect(huge.statusCode).toBe(413);
  });
});

// ---------------------------------------------------------------------------
// Listing & detail
// ---------------------------------------------------------------------------

describe('GET /reports', () => {
  it('reviewers see all reports with filters; others only their own', async () => {
    const a = await verifiedUser();
    const b = await verifiedUser();
    const pa = steamRef();
    const reportA = (await postReport(a.session.headers, { player: pa, reason: 'from a' })).json();
    const reportB = (await postReport(b.session.headers, { player: steamRef(), reason: 'from b' })).json();

    const { session: rev } = await reviewer();
    const all = await t().app.inject({ method: 'GET', url: '/api/v1/reports', headers: rev.headers });
    const allIds = all.json().items.map((i: { id: string }) => i.id);
    expect(allIds).toContain(reportA.report_id);
    expect(allIds).toContain(reportB.report_id);

    const byCase = await t().app.inject({ method: 'GET', url: `/api/v1/reports?case=${reportA.case_id}`, headers: rev.headers });
    expect(byCase.json().items.map((i: { id: string }) => i.id)).toEqual([reportA.report_id]);

    const byPlayer = await t().app.inject({
      method: 'GET',
      url: `/api/v1/reports?player=${encodeURIComponent(`${pa.id}@steam`)}`,
      headers: rev.headers,
    });
    expect(byPlayer.json().items.map((i: { id: string }) => i.id)).toEqual([reportA.report_id]);

    const own = await t().app.inject({ method: 'GET', url: '/api/v1/reports', headers: a.session.headers });
    expect(own.json().items.map((i: { id: string }) => i.id)).toEqual([reportA.report_id]);
  });

  it('report detail is limited to reviewers and the reporter', async () => {
    const a = await verifiedUser();
    const b = await verifiedUser();
    const { session: rev } = await reviewer();
    const created = (await postReport(a.session.headers, { player: steamRef(), reason: 'mine' })).json();

    expect((await t().app.inject({ method: 'GET', url: `/api/v1/reports/${created.report_id}`, headers: a.session.headers })).statusCode).toBe(200);
    expect((await t().app.inject({ method: 'GET', url: `/api/v1/reports/${created.report_id}`, headers: rev.headers })).statusCode).toBe(200);
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/reports/${created.report_id}`, headers: b.session.headers }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t().app.inject({ method: 'GET', url: '/api/v1/reports/00000000-0000-4000-8000-000000000000', headers: rev.headers }),
      404,
      'NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

describe('POST /reports/{id}/status', () => {
  it('enforces §11.2 transitions and audits REPORT_STATUS_CHANGED', async () => {
    const a = await verifiedUser();
    const { session: rev } = await reviewer();
    const created = (await postReport(a.session.headers, { player: steamRef(), reason: 'flow' })).json();
    const url = `/api/v1/reports/${created.report_id}/status`;

    // open → resolved is not allowed.
    expectError(
      await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'resolved', note: 'skip review' } }),
      409,
      'INVALID_STATE',
    );

    const toReview = await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'under_review', note: 'looking' } });
    expect(toReview.statusCode).toBe(200);
    expect(toReview.json().status).toBe('under_review');

    const resolved = await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'resolved', note: 'handled' } });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toMatchObject({ status: 'resolved', resolution_note: 'handled' });
    expect(resolved.json().resolved_by.pseudonym).toMatch(/^Reviewer #\d+$/);

    // Terminal while the case is still open… only reopened cases go back.
    await t().db.updateTable('cases').set({ status: 'closed', closed_at: t().clock.now() }).where('case_number', '=', created.case_id).execute();
    expectError(
      await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'under_review', note: 'undo' } }),
      409,
      'INVALID_STATE',
    );
    await t().db.updateTable('cases').set({ status: 'under_review', closed_at: null }).where('case_number', '=', created.case_id).execute();
    const back = await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'under_review', note: 'case reopened' } });
    expect(back.statusCode).toBe(200);

    const audits = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('action', '=', 'REPORT_STATUS_CHANGED')
      .where('target_id', '=', created.report_id)
      .execute();
    expect(audits).toHaveLength(3);
  });

  it('requires report:review and a note', async () => {
    const a = await verifiedUser();
    const created = (await postReport(a.session.headers, { player: steamRef(), reason: 'perm' })).json();
    const url = `/api/v1/reports/${created.report_id}/status`;
    expectError(
      await t().app.inject({ method: 'POST', url, headers: a.session.headers, body: { status: 'rejected', note: 'not allowed' } }),
      403,
      'FORBIDDEN',
    );
    const { session: rev } = await reviewer();
    const noNote = await t().app.inject({ method: 'POST', url, headers: rev.headers, body: { status: 'rejected' } });
    expect(noNote.statusCode).toBe(400);
  });
});
