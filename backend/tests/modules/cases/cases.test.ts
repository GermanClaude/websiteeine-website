/**
 * Cases module: creation & numbering, staff/server scoping, review actions,
 * verdict rules (§11.2), reopen, public view (leak checks), audit events.
 */
import { describe, expect, it } from 'vitest';

import { allocateCaseNumber } from '../../../src/db/sequences';
import type { Deps } from '../../../src/container';
import type { CaseRow, PlayerRow, ServerRow, UserRow } from '../../../src/db/types';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

// ---------------------------------------------------------------------------
// Local fixtures (direct rows so the tests do not depend on other modules)
// ---------------------------------------------------------------------------

async function makeCase(
  deps: Deps,
  player: PlayerRow,
  overrides: Partial<{
    status: CaseRow['status'];
    verdict: CaseRow['current_verdict'];
    reason: string;
    publicSummary: string | null;
  }> = {},
): Promise<CaseRow> {
  const now = deps.clock.now();
  const caseNumber = await allocateCaseNumber(deps.db, now.getUTCFullYear());
  const status = overrides.status ?? 'open';
  return deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: player.id,
      reason: overrides.reason ?? 'internal-reason-text',
      public_summary: overrides.publicSummary ?? null,
      status,
      current_verdict: overrides.verdict ?? 'unknown',
      closed_at: status === 'closed' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addReport(
  deps: Deps,
  caseRow: CaseRow,
  options: { reporter?: UserRow; server?: ServerRow; status?: 'open' | 'under_review' | 'resolved' | 'rejected' } = {},
) {
  const now = deps.clock.now();
  // DB check: user reports need reporter_user_id, server reports need server_id.
  const reporter = options.server !== undefined ? options.reporter : (options.reporter ?? (await createUser(deps)).user);
  return deps.db
    .insertInto('reports')
    .values({
      case_id: caseRow.id,
      player_id: caseRow.player_id,
      server_id: options.server?.id ?? null,
      reporter_type: options.server !== undefined && reporter === undefined ? 'server' : 'user',
      reporter_user_id: reporter?.id ?? null,
      reason: 'aimbot',
      status: options.status ?? 'open',
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addLinkEvidence(
  deps: Deps,
  caseRow: CaseRow,
  statuses: Partial<{ status: string; cheating: string; authenticity: string }> = {},
) {
  const now = deps.clock.now();
  return deps.db
    .insertInto('evidence')
    .values({
      case_id: caseRow.id,
      type: 'link',
      title: 'clip',
      external_url: 'https://example.com/clip',
      status: (statuses.status ?? 'pending') as never,
      cheating_status: (statuses.cheating ?? 'pending') as never,
      authenticity_status: (statuses.authenticity ?? 'pending') as never,
      uploaded_at: now,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function reviewer() {
  const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
  return { user, session: await loginAs(t().app, user) };
}

async function moderator() {
  const { user } = await createUser(t().deps, { role: 'moderator', totp: true });
  return { user, session: await loginAs(t().app, user) };
}

async function auditActions(caseId: string): Promise<string[]> {
  const rows = await t()
    .db.selectFrom('audit_events')
    .select('action')
    .where('case_id', '=', caseId)
    .orderBy('seq', 'asc')
    .execute();
  return rows.map((r) => r.action);
}

// ---------------------------------------------------------------------------
// Creation & numbering
// ---------------------------------------------------------------------------

describe('POST /cases', () => {
  it('creates a case with a sequential number and audits CASE_CREATED', async () => {
    const { session } = await moderator();
    const player = await createPlayer(t().deps);
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/cases',
      headers: session.headers,
      body: {
        player: { type: player.id_type, id: player.external_id },
        reason: 'cheating in raid',
        public_summary: 'Public info',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.case_number).toMatch(/^CASE-2026-\d{6}$/);
    expect(body.status).toBe('open');
    expect(body.verdict).toBe('unknown');
    const row = await t().db.selectFrom('cases').selectAll().where('case_number', '=', body.case_number).executeTakeFirstOrThrow();
    expect(row.public_summary).toBe('Public info');
    expect(await auditActions(row.id)).toEqual(['CASE_CREATED']);
  });

  it('rejects a second open case for the same player with ALREADY_EXISTS', async () => {
    const { session } = await moderator();
    const player = await createPlayer(t().deps);
    await makeCase(t().deps, player);
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/cases',
      headers: session.headers,
      body: { player: { type: player.id_type, id: player.external_id }, reason: 'again' },
    });
    expectError(res, 409, 'ALREADY_EXISTS');
  });

  it('is forbidden for reviewers (case:create is moderation) and anonymous users', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const body = { player: { type: player.id_type, id: player.external_id }, reason: 'nope' };
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/cases', headers: session.headers, body }),
      403,
      'FORBIDDEN',
    );
    expectError(await t().app.inject({ method: 'POST', url: '/api/v1/cases', body }), 401, 'UNAUTHENTICATED');
  });

  it('rejects an invalid player id with validation details', async () => {
    const { session } = await moderator();
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/cases',
      headers: session.headers,
      body: { player: { type: 'steam', id: 'not-a-steamid' }, reason: 'invalid' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Listing & scoping
// ---------------------------------------------------------------------------

describe('GET /cases', () => {
  it('reviewers see all cases; filters by status, verdict and player work', async () => {
    const { session } = await reviewer();
    const p1 = await createPlayer(t().deps);
    const p2 = await createPlayer(t().deps);
    const c1 = await makeCase(t().deps, p1, { status: 'closed', verdict: 'confirmed' });
    const c2 = await makeCase(t().deps, p2);
    await addReport(t().deps, c2);

    const all = await t().app.inject({ method: 'GET', url: '/api/v1/cases', headers: session.headers });
    expect(all.statusCode).toBe(200);
    const numbers = all.json().items.map((i: { case_number: string }) => i.case_number);
    expect(numbers).toContain(c1.case_number);
    expect(numbers).toContain(c2.case_number);

    const closed = await t().app.inject({ method: 'GET', url: '/api/v1/cases?status=closed', headers: session.headers });
    expect(closed.json().items.map((i: { case_number: string }) => i.case_number)).toContain(c1.case_number);
    expect(closed.json().items.map((i: { case_number: string }) => i.case_number)).not.toContain(c2.case_number);

    const byPlayer = await t().app.inject({
      method: 'GET',
      url: `/api/v1/cases?player=${encodeURIComponent(`${p2.external_id}@${p2.id_type}`)}`,
      headers: session.headers,
    });
    expect(byPlayer.json().items).toHaveLength(1);
    expect(byPlayer.json().items[0].case_number).toBe(c2.case_number);
    expect(byPlayer.json().items[0].report_count).toBe(1);
    expect(byPlayer.json().items[0].open_report_count).toBe(1);
  });

  it('server team members only see cases their servers reported or confirmed', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const ownerSession = await loginAs(t().app, owner);
    const pMine = await createPlayer(t().deps);
    const pOther = await createPlayer(t().deps);
    const mine = await makeCase(t().deps, pMine);
    await addReport(t().deps, mine, { server });
    const other = await makeCase(t().deps, pOther);

    const res = await t().app.inject({ method: 'GET', url: '/api/v1/cases', headers: ownerSession.headers });
    expect(res.statusCode).toBe(200);
    const numbers = res.json().items.map((i: { case_number: string }) => i.case_number);
    expect(numbers).toContain(mine.case_number);
    expect(numbers).not.toContain(other.case_number);

    // Staff detail of an unrelated case → 403 (web UI falls back to public view).
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/cases/${other.case_number}`, headers: ownerSession.headers }),
      403,
      'FORBIDDEN',
    );
    // Their own server's case is visible.
    const detail = await t().app.inject({
      method: 'GET',
      url: `/api/v1/cases/${mine.case_number}`,
      headers: ownerSession.headers,
    });
    expect(detail.statusCode).toBe(200);
  });

  it('players without membership get 403 for list and staff detail', async () => {
    const { user } = await createUser(t().deps);
    const session = await loginAs(t().app, user);
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player);
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/cases', headers: session.headers }), 403, 'FORBIDDEN');
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/cases/${row.case_number}`, headers: session.headers }),
      403,
      'FORBIDDEN',
    );
  });
});

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

describe('review actions', () => {
  it('start review, note, reopen: state machine + reviews rows + audit', async () => {
    const { session } = await reviewer();
    const mod = await moderator();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player);

    const start = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/reviews/start`,
      headers: session.headers,
      body: { comment: 'taking a look' },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe('under_review');

    // Starting twice is an invalid state.
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${row.case_number}/reviews/start`,
        headers: session.headers,
        body: { comment: 'again' },
      }),
      409,
      'INVALID_STATE',
    );

    const note = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/notes`,
      headers: session.headers,
      body: { comment: 'suspicious flick at 0:42' },
    });
    expect(note.statusCode).toBe(200);

    // Reopen only closed cases.
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${row.case_number}/reopen`,
        headers: mod.session.headers,
        body: { comment: 'not closed yet' },
      }),
      409,
      'INVALID_STATE',
    );
    await t().db.updateTable('cases').set({ status: 'closed', closed_at: t().clock.now() }).where('id', '=', row.id).execute();
    const reopen = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/reopen`,
      headers: mod.session.headers,
      body: { comment: 'new evidence' },
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().status).toBe('under_review');

    const reviews = await t().db.selectFrom('reviews').select(['kind']).where('case_id', '=', row.id).orderBy('created_at').execute();
    expect(reviews.map((r) => r.kind)).toEqual(['review_started', 'note', 'reopened']);
    expect(await auditActions(row.id)).toEqual(['REVIEW_STARTED', 'CASE_NOTE_ADDED', 'CASE_REOPENED']);
  });

  it('review actions are forbidden for plain players and unknown cases are 404', async () => {
    const { user } = await createUser(t().deps);
    const session = await loginAs(t().app, user);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/cases/CASE-2026-000001/reviews/start',
        headers: session.headers,
        body: { comment: 'nope' },
      }),
      403,
      'FORBIDDEN',
    );
    const { session: rev } = await reviewer();
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/cases/CASE-2026-999999/reviews/start',
        headers: rev.headers,
        body: { comment: 'ghost' },
      }),
      404,
      'NOT_FOUND',
    );
  });
});

// ---------------------------------------------------------------------------
// Verdicts (§11.2)
// ---------------------------------------------------------------------------

describe('POST /cases/{caseNumber}/verdict', () => {
  it('confirmed without verified authentic cheating evidence → 422 INSUFFICIENT_EVIDENCE', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    // Only partially verified evidence exists.
    await addLinkEvidence(t().deps, row, { cheating: 'verified', authenticity: 'pending' });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${row.case_number}/verdict`,
        headers: session.headers,
        body: { verdict: 'confirmed', comment: 'clearly cheating' },
      }),
      422,
      'INSUFFICIENT_EVIDENCE',
    );
  });

  it('superseded verified evidence does not satisfy the rule', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    const oldEvidence = await addLinkEvidence(t().deps, row, { cheating: 'verified', authenticity: 'verified' });
    const successor = await t()
      .db.insertInto('evidence')
      .values({
        case_id: row.id,
        type: 'link',
        title: 'replacement',
        external_url: 'https://example.com/clip2',
        supersedes_evidence_id: oldEvidence.id,
        uploaded_at: t().clock.now(),
        created_at: t().clock.now(),
        updated_at: t().clock.now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await t()
      .db.updateTable('evidence')
      .set({ superseded_by_evidence_id: successor.id })
      .where('id', '=', oldEvidence.id)
      .execute();
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${row.case_number}/verdict`,
        headers: session.headers,
        body: { verdict: 'confirmed', comment: 'evidence got superseded' },
      }),
      422,
      'INSUFFICIENT_EVIDENCE',
    );
  });

  it('a reviewer who reported on the case gets 409 CONFLICT_OF_INTEREST', async () => {
    const { user, session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    await addReport(t().deps, row, { reporter: user as unknown as UserRow });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${row.case_number}/verdict`,
        headers: session.headers,
        body: { verdict: 'rejected', comment: 'I reported this myself' },
      }),
      409,
      'CONFLICT_OF_INTEREST',
    );
  });

  it('valid confirm closes the case, resolves reports, writes review + audit', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    const report = await addReport(t().deps, row);
    await addLinkEvidence(t().deps, row, { status: 'verified', cheating: 'verified', authenticity: 'verified' });

    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'confirmed', comment: 'verified overwatch clip', public_summary: 'Confirmed cheating' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'closed', verdict: 'confirmed' });

    const updated = await t().db.selectFrom('cases').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
    expect(updated.closed_at).not.toBeNull();
    expect(updated.verdict_set_by).not.toBeNull();
    expect(updated.public_summary).toBe('Confirmed cheating');

    const reportRow = await t().db.selectFrom('reports').selectAll().where('id', '=', report.id).executeTakeFirstOrThrow();
    expect(reportRow.status).toBe('resolved');

    const review = await t().db.selectFrom('reviews').selectAll().where('case_id', '=', row.id).executeTakeFirstOrThrow();
    expect(review).toMatchObject({ kind: 'verdict_set', previous_verdict: 'unknown', new_verdict: 'confirmed' });
    expect(await auditActions(row.id)).toEqual(['VERDICT_CHANGED']);
  });

  it('rejected verdict rejects open reports', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    const report = await addReport(t().deps, row);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'rejected', comment: 'no evidence at all' },
    });
    expect(res.statusCode).toBe(200);
    const reportRow = await t().db.selectFrom('reports').selectAll().where('id', '=', report.id).executeTakeFirstOrThrow();
    expect(reportRow.status).toBe('rejected');
  });

  it('closed cases, missing 2FA sessions and plain players are rejected', async () => {
    const player = await createPlayer(t().deps);
    const closed = await makeCase(t().deps, player, { status: 'closed', verdict: 'rejected' });
    const { session } = await reviewer();
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${closed.case_number}/verdict`,
        headers: session.headers,
        body: { verdict: 'confirmed', comment: 'already closed' },
      }),
      409,
      'INVALID_STATE',
    );

    // Session without completed 2FA.
    const { user: rev2 } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const weakSession = await loginAs(t().app, rev2, { mfa_verified: false });
    const open = await makeCase(t().deps, await createPlayer(t().deps), { status: 'under_review' });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${open.case_number}/verdict`,
        headers: weakSession.headers,
        body: { verdict: 'rejected', comment: 'no mfa' },
      }),
      403,
      'FORBIDDEN',
    );

    const { user: plain } = await createUser(t().deps);
    const plainSession = await loginAs(t().app, plain);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${open.case_number}/verdict`,
        headers: plainSession.headers,
        body: { verdict: 'rejected', comment: 'not staff' },
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('verdict "unknown" is rejected by validation', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'unknown', comment: 'not settable' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Staff view content & public view (leak checks)
// ---------------------------------------------------------------------------

describe('case views', () => {
  it('staff view contains reports, evidence, reviews and pseudonymous reviewers', async () => {
    const { user: rev, session } = await reviewer();
    const player = await createPlayer(t().deps, undefined, { display_name: 'CheaterMan' });
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    await addReport(t().deps, row);
    await addLinkEvidence(t().deps, row, { status: 'verified', cheating: 'verified', authenticity: 'verified' });
    await t()
      .db.insertInto('reviews')
      .values({
        case_id: row.id,
        reviewer_user_id: rev.id,
        kind: 'note',
        comment: 'internal note',
        created_at: t().clock.now(),
      })
      .execute();

    const res = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${row.case_number}`, headers: session.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reason).toBe('internal-reason-text');
    expect(body.reports).toHaveLength(1);
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ cheating_status: 'verified', authenticity_status: 'verified' });
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].reviewer.pseudonym).toMatch(/^Reviewer #\d+$/);
    // Reviewer identity never leaks into the reviews list.
    expect(JSON.stringify(body.reviews)).not.toContain(rev.username);
    expect(JSON.stringify(body)).not.toContain(rev.email);
  });

  it('public view exposes no internal data and needs no session', async () => {
    const { user: rev, session } = await reviewer();
    const player = await createPlayer(t().deps, undefined, { display_name: 'PubTarget' });
    const row = await makeCase(t().deps, player, {
      status: 'under_review',
      reason: 'super-secret-internal-reason',
      publicSummary: 'Public summary text',
    });
    await addReport(t().deps, row, { reporter: rev as unknown as UserRow });
    await addLinkEvidence(t().deps, row, { status: 'verified', cheating: 'verified', authenticity: 'verified' });

    const res = await t().app.inject({ method: 'GET', url: `/api/v1/public/cases/${row.case_number}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      case_number: row.case_number,
      status: 'under_review',
      public_summary: 'Public summary text',
      report_count: 1,
      evidence_count: 1,
      verified_evidence_count: 1,
    });
    expect(body.player.display_name).toBe('PubTarget');
    const raw = res.body;
    expect(raw).not.toContain('super-secret-internal-reason');
    expect(raw).not.toContain(rev.username);
    expect(raw).not.toContain(rev.email);
    expect(raw).not.toContain('storage');
    expect(body.reason).toBeUndefined();
    expect(body.reports).toBeUndefined();
    expect(body.evidence).toBeUndefined();
    void session;
  });

  it('public view 404s for unknown cases', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/public/cases/CASE-2026-999998' }), 404, 'NOT_FOUND');
  });

  it('public timeline lists selected events with reviewer pseudonyms only', async () => {
    const { session } = await reviewer();
    const player = await createPlayer(t().deps);
    const row = await makeCase(t().deps, player, { status: 'under_review' });
    await addLinkEvidence(t().deps, row, { status: 'verified', cheating: 'verified', authenticity: 'verified' });
    const verdict = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${row.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'confirmed', comment: 'verified evidence' },
    });
    expect(verdict.statusCode).toBe(200);

    const res = await t().app.inject({ method: 'GET', url: `/api/v1/public/cases/${row.case_number}` });
    const timeline = res.json().timeline as Array<{ action: string; actor: string | null }>;
    expect(timeline.map((e) => e.action)).toContain('VERDICT_CHANGED');
    const verdictEvent = timeline.find((e) => e.action === 'VERDICT_CHANGED')!;
    expect(verdictEvent.actor).toMatch(/^Reviewer #\d+$/);
  });
});
