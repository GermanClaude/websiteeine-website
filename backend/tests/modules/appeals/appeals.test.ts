/**
 * Appeals (§11.5): creation rules, listing scope, assignment, independence,
 * verdict effects for all three decisions, withdrawal, audit events.
 */
import { describe, expect, it } from 'vitest';

import { allocateCaseNumber } from '../../../src/db/sequences';
import type { Deps } from '../../../src/container';
import type { CaseRow, PlayerRow } from '../../../src/db/types';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function makeCase(
  deps: Deps,
  player: PlayerRow,
  overrides: Partial<{
    status: CaseRow['status'];
    verdict: CaseRow['current_verdict'];
    verdictSetBy: string | null;
  }> = {},
): Promise<CaseRow> {
  const now = deps.clock.now();
  const caseNumber = await allocateCaseNumber(deps.db, now.getUTCFullYear());
  const verdict = overrides.verdict ?? 'confirmed';
  const status = overrides.status ?? (verdict === 'unknown' ? 'open' : 'closed');
  return deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: player.id,
      reason: 'appeal testing',
      status,
      current_verdict: verdict,
      verdict_set_by: overrides.verdictSetBy ?? null,
      verdict_set_at: overrides.verdictSetBy != null ? now : null,
      closed_at: status === 'closed' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function linkedUser(deps: Deps, player: PlayerRow) {
  return createUser(deps, { playerId: player.id });
}

async function createAppealVia(app: import('fastify').FastifyInstance, headers: Record<string, string>, caseNumber: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/appeals',
    headers,
    body: { case_id: caseNumber, statement: 'I did not cheat, please review the demo again.' },
  });
}

async function addReport(deps: Deps, caseRow: CaseRow, reporterUserId: string) {
  const now = deps.clock.now();
  await deps.db
    .insertInto('reports')
    .values({
      case_id: caseRow.id,
      player_id: caseRow.player_id,
      reporter_type: 'user',
      reporter_user_id: reporterUserId,
      reason: 'cheating suspicion',
      status: 'resolved',
      created_at: now,
      updated_at: now,
    })
    .execute();
}

describe('POST /appeals', () => {
  it('linked player appeals a confirmed case (audited, view returned)', async () => {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player);
    const session = await loginAs(t().app, user);

    const res = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      case_number: caseRow.case_number,
      status: 'open',
      decision: null,
      conflict_override: false,
      submitted_by: { id: user.id },
    });

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'case_id'])
      .where('target_type', '=', 'appeal')
      .execute();
    expect(audit).toEqual([{ action: 'APPEAL_CREATED', case_id: caseRow.id }]);
  });

  it('rejects users without a linked player', async () => {
    const player = await createPlayer(t().deps);
    const caseRow = await makeCase(t().deps, player);
    const { user } = await createUser(t().deps);
    const session = await loginAs(t().app, user);
    const res = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expectError(res, 403, 'PLAYER_NOT_LINKED');
  });

  it('rejects a user linked to a different player', async () => {
    const player = await createPlayer(t().deps);
    const otherPlayer = await createPlayer(t().deps);
    const caseRow = await makeCase(t().deps, player);
    const { user } = await linkedUser(t().deps, otherPlayer);
    const session = await loginAs(t().app, user);
    const res = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expectError(res, 403, 'FORBIDDEN');
  });

  it.each(['unknown', 'rejected'] as const)('verdict %s is not appealable', async (verdict) => {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player, { verdict, status: verdict === 'unknown' ? 'open' : 'closed' });
    const session = await loginAs(t().app, user);
    const res = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expectError(res, 409, 'APPEAL_NOT_ALLOWED');
  });

  it('allows only one open appeal per case', async () => {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player, { verdict: 'inconclusive' });
    const session = await loginAs(t().app, user);
    expect((await createAppealVia(t().app, session.headers, caseRow.case_number)).statusCode).toBe(201);
    const res = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expectError(res, 409, 'ALREADY_EXISTS');
  });

  it('requires authentication and rejects an unknown case', async () => {
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      body: { case_id: 'CASE-2026-000001', statement: 'long enough appeal statement text' },
    });
    expectError(res, 401, 'UNAUTHENTICATED');

    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const session = await loginAs(t().app, user);
    const missing = await createAppealVia(t().app, session.headers, 'CASE-2026-999999');
    expectError(missing, 404, 'NOT_FOUND');
  });
});

describe('GET /appeals & GET /appeals/{id}', () => {
  it('deciders see all appeals; submitters only their own; strangers are refused the detail', async () => {
    const playerA = await createPlayer(t().deps);
    const playerB = await createPlayer(t().deps);
    const { user: userA } = await linkedUser(t().deps, playerA);
    const { user: userB } = await linkedUser(t().deps, playerB);
    const caseA = await makeCase(t().deps, playerA);
    const caseB = await makeCase(t().deps, playerB);
    const sessionA = await loginAs(t().app, userA);
    const sessionB = await loginAs(t().app, userB);
    const idA = (await createAppealVia(t().app, sessionA.headers, caseA.case_number)).json().id as string;
    await createAppealVia(t().app, sessionB.headers, caseB.case_number);

    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const reviewerSession = await loginAs(t().app, reviewer);
    const all = await t().app.inject({ method: 'GET', url: '/api/v1/appeals', headers: reviewerSession.headers });
    const allNumbers = all.json().items.map((a: { case_number: string }) => a.case_number);
    expect(allNumbers).toEqual(expect.arrayContaining([caseA.case_number, caseB.case_number]));

    const own = await t().app.inject({ method: 'GET', url: '/api/v1/appeals', headers: sessionA.headers });
    expect(own.json().total).toBe(1);
    expect(own.json().items[0].case_number).toBe(caseA.case_number);

    // case filter for deciders
    const filtered = await t().app.inject({
      method: 'GET',
      url: `/api/v1/appeals?case=${caseB.case_number}`,
      headers: reviewerSession.headers,
    });
    expect(filtered.json().items.map((a: { case_number: string }) => a.case_number)).toEqual([caseB.case_number]);

    // detail access
    expect((await t().app.inject({ method: 'GET', url: `/api/v1/appeals/${idA}`, headers: sessionA.headers })).statusCode).toBe(200);
    expect((await t().app.inject({ method: 'GET', url: `/api/v1/appeals/${idA}`, headers: reviewerSession.headers })).statusCode).toBe(200);
    const stranger = await t().app.inject({ method: 'GET', url: `/api/v1/appeals/${idA}`, headers: sessionB.headers });
    expectError(stranger, 403, 'FORBIDDEN');
  });
});

describe('POST /appeals/{id}/assign', () => {
  async function openAppeal(verdictSetBy: string | null = null) {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player, { verdictSetBy });
    const session = await loginAs(t().app, user);
    const id = (await createAppealVia(t().app, session.headers, caseRow.case_number)).json().id as string;
    return { id, caseRow, submitter: user, submitterSession: session };
  }

  it('assigns to a reviewer with appeal:decide and moves to under_review (audited)', async () => {
    const { id } = await openAppeal();
    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, moderator);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${id}/assign`,
      headers: session.headers,
      body: { reviewer_user_id: reviewer.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'under_review' });
    expect(res.json().assigned_reviewer).not.toBeNull();

    const audit = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('APPEAL_ASSIGNED');
  });

  it('rejects assignees without appeal:decide and conflicted assignees; reviewers cannot assign', async () => {
    const { user: verdictSetter } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const { id } = await openAppeal(verdictSetter.id);
    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const session = await loginAs(t().app, moderator);

    const { user: plainPlayer } = await createUser(t().deps);
    const noPerm = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${id}/assign`,
      headers: session.headers,
      body: { reviewer_user_id: plainPlayer.id },
    });
    expectError(noPerm, 400, 'VALIDATION_FAILED');

    const conflicted = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${id}/assign`,
      headers: session.headers,
      body: { reviewer_user_id: verdictSetter.id },
    });
    expectError(conflicted, 409, 'CONFLICT_OF_INTEREST');

    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const reviewerSession = await loginAs(t().app, reviewer);
    const forbidden = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${id}/assign`,
      headers: reviewerSession.headers,
      body: { reviewer_user_id: reviewer.id },
    });
    expectError(forbidden, 403, 'FORBIDDEN');
  });
});

describe('POST /appeals/{id}/decision', () => {
  async function openAppeal(options: { verdict?: CaseRow['current_verdict']; verdictSetBy?: string | null } = {}) {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player, {
      verdict: options.verdict ?? 'confirmed',
      verdictSetBy: options.verdictSetBy ?? null,
    });
    const session = await loginAs(t().app, user);
    const id = (await createAppealVia(t().app, session.headers, caseRow.case_number)).json().id as string;
    return { id, caseRow, submitter: user };
  }

  function decide(headers: Record<string, string>, id: string, decision: string, extra: Record<string, unknown> = {}) {
    return t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${id}/decision`,
      headers,
      body: { decision, reason: 'independent second look at the evidence', ...extra },
    });
  }

  it('confirm keeps the verdict but records an appeal_decision review', async () => {
    const { id, caseRow } = await openAppeal();
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer);
    const res = await decide(session.headers, id, 'confirm');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'decided', decision: 'confirm', conflict_override: false });

    const fresh = await t().db.selectFrom('cases').selectAll().where('id', '=', caseRow.id).executeTakeFirstOrThrow();
    expect(fresh.current_verdict).toBe('confirmed');

    const reviews = await t()
      .db.selectFrom('reviews')
      .select(['kind', 'appeal_id'])
      .where('case_id', '=', caseRow.id)
      .execute();
    expect(reviews).toEqual([{ kind: 'appeal_decision', appeal_id: id }]);

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('case_id', '=', caseRow.id).execute()
    ).map((a) => a.action);
    expect(actions).toContain('APPEAL_RESOLVED');
    expect(actions).not.toContain('VERDICT_CHANGED');
  });

  it('reverse sets the verdict to rejected (VERDICT_CHANGED + APPEAL_RESOLVED)', async () => {
    const { id, caseRow } = await openAppeal();
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer);
    const res = await decide(session.headers, id, 'reverse');
    expect(res.statusCode).toBe(200);

    const fresh = await t().db.selectFrom('cases').selectAll().where('id', '=', caseRow.id).executeTakeFirstOrThrow();
    expect(fresh.current_verdict).toBe('rejected');
    expect(fresh.status).toBe('closed');

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('case_id', '=', caseRow.id).execute()
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['VERDICT_CHANGED', 'APPEAL_RESOLVED']));
  });

  it('inconclusive changes the verdict accordingly', async () => {
    const { id, caseRow } = await openAppeal({ verdict: 'confirmed' });
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer);
    expect((await decide(session.headers, id, 'inconclusive')).statusCode).toBe(200);
    const fresh = await t().db.selectFrom('cases').selectAll().where('id', '=', caseRow.id).executeTakeFirstOrThrow();
    expect(fresh.current_verdict).toBe('inconclusive');
  });

  it('the verdict setter cannot decide; a reporter cannot decide', async () => {
    const { user: setter } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const { id: id1 } = await openAppeal({ verdictSetBy: setter.id });
    const setterSession = await loginAs(t().app, setter);
    expectError(await decide(setterSession.headers, id1, 'confirm'), 409, 'CONFLICT_OF_INTEREST');

    const { id: id2, caseRow } = await openAppeal();
    const { user: reporter } = await createUser(t().deps, { role: 'reviewer', totp: true });
    await addReport(t().deps, caseRow, reporter.id);
    const reporterSession = await loginAs(t().app, reporter);
    expectError(await decide(reporterSession.headers, id2, 'confirm'), 409, 'CONFLICT_OF_INTEREST');
  });

  it('super_admin may override a conflict; the override is recorded and audited', async () => {
    const { user: superAdmin } = await createUser(t().deps, { role: 'super_admin', totp: true });
    const { id } = await openAppeal({ verdictSetBy: superAdmin.id });
    const session = await loginAs(t().app, superAdmin);

    // without the flag the conflict still blocks
    expectError(await decide(session.headers, id, 'confirm'), 409, 'CONFLICT_OF_INTEREST');

    const res = await decide(session.headers, id, 'confirm', { override_conflict: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().conflict_override).toBe(true);

    const event = await t()
      .db.selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'APPEAL_RESOLVED')
      .where('target_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(event.metadata).toMatchObject({ conflict_override: true });
  });

  it('an admin (not super_admin) cannot override a conflict', async () => {
    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const { id } = await openAppeal({ verdictSetBy: admin.id });
    const session = await loginAs(t().app, admin);
    expectError(await decide(session.headers, id, 'confirm', { override_conflict: true }), 409, 'CONFLICT_OF_INTEREST');
  });

  it('a decided appeal cannot be decided again; players cannot decide', async () => {
    const { id, submitter } = await openAppeal();
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer);
    expect((await decide(session.headers, id, 'confirm')).statusCode).toBe(200);
    expectError(await decide(session.headers, id, 'reverse'), 409, 'INVALID_STATE');

    const playerSession = await loginAs(t().app, submitter);
    expectError(await decide(playerSession.headers, id, 'confirm'), 403, 'FORBIDDEN');
  });
});

describe('POST /appeals/{id}/withdraw', () => {
  it('submitter withdraws an open appeal (audited); others cannot; decided cannot be withdrawn', async () => {
    const player = await createPlayer(t().deps);
    const { user } = await linkedUser(t().deps, player);
    const caseRow = await makeCase(t().deps, player);
    const session = await loginAs(t().app, user);
    const id = (await createAppealVia(t().app, session.headers, caseRow.case_number)).json().id as string;

    const { user: other } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const otherSession = await loginAs(t().app, other);
    expectError(
      await t().app.inject({ method: 'POST', url: `/api/v1/appeals/${id}/withdraw`, headers: otherSession.headers, body: {} }),
      403,
      'FORBIDDEN',
    );

    const res = await t().app.inject({ method: 'POST', url: `/api/v1/appeals/${id}/withdraw`, headers: session.headers, body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('withdrawn');

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('target_id', '=', id).execute()
    ).map((a) => a.action);
    expect(actions).toContain('APPEAL_WITHDRAWN');

    expectError(
      await t().app.inject({ method: 'POST', url: `/api/v1/appeals/${id}/withdraw`, headers: session.headers, body: {} }),
      409,
      'INVALID_STATE',
    );

    // a withdrawn appeal frees the case for a new appeal
    const again = await createAppealVia(t().app, session.headers, caseRow.case_number);
    expect(again.statusCode).toBe(201);
  });
});
