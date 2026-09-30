/**
 * Regression tests for the fixes of the security / spec review findings that go beyond the
 * original confirmation tests in security-review.test.ts (SR-01 … SR-09, SPEC-5/6/7/8).
 */
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../src/container';
import { allocateCaseNumber } from '../../src/db/sequences';
import type { CaseRow, PlayerRow, UserRow } from '../../src/db/types';
import { ipKey } from '../../src/http/rate-limit';
import { LINK_FAILURES_PER_HOUR } from '../../src/modules/users/service';
import {
  createPlayer,
  createServerWithKey,
  createUser,
  expectError,
  randomSteamId,
  sessionFor,
  signedRequest,
  useTestApp,
} from '../helpers';
import { multipartPayload, pngBytes } from '../modules/evidence/helpers';

const t = useTestApp({
  now: '2026-09-29T12:00:00.000Z',
  env: {
    EVIDENCE_UPLOADS_PER_HOUR_NON_STAFF: '3',
    EVIDENCE_MAX_BYTES_NON_STAFF: '4096',
    EVIDENCE_DAILY_BYTES_NON_STAFF: '1024',
  },
});

async function makeCase(
  deps: Deps,
  player: PlayerRow,
  opts: { status?: CaseRow['status']; verdict?: CaseRow['current_verdict']; verdictSetBy?: string | null } = {},
): Promise<CaseRow> {
  const now = deps.clock.now();
  const verdict = opts.verdict ?? 'unknown';
  const status = opts.status ?? (verdict === 'unknown' ? 'under_review' : 'closed');
  return deps.db
    .insertInto('cases')
    .values({
      case_number: await allocateCaseNumber(deps.db, now.getUTCFullYear()),
      player_id: player.id,
      reason: 'review fix case',
      status,
      current_verdict: verdict,
      verdict_set_by: opts.verdictSetBy ?? null,
      verdict_set_at: opts.verdictSetBy != null ? now : null,
      closed_at: status === 'closed' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addUserReport(deps: Deps, caseRow: CaseRow, reporter: UserRow): Promise<string> {
  const now = deps.clock.now();
  const row = await deps.db
    .insertInto('reports')
    .values({
      case_id: caseRow.id,
      player_id: caseRow.player_id,
      reporter_type: 'user',
      reporter_user_id: reporter.id,
      reason: 'suspected aimbot',
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function upload(headers: Record<string, string>, caseNumber: string, size = 64) {
  const { payload, headers: mp } = multipartPayload(
    { type: 'image', title: 'screenshot' },
    { filename: 'shot.png', contentType: 'image/png', data: pngBytes(size) },
  );
  return t().app.inject({ method: 'POST', url: `/api/v1/cases/${caseNumber}/evidence`, headers: { ...headers, ...mp }, payload });
}

function supersede(headers: Record<string, string>, evidenceId: string) {
  const { payload, headers: mp } = multipartPayload(
    { reason: 'better recording' },
    { filename: 'v2.png', contentType: 'image/png', data: pngBytes(16) },
  );
  return t().app.inject({ method: 'POST', url: `/api/v1/evidence/${evidenceId}/supersede`, headers: { ...headers, ...mp }, payload });
}

const fullReview = {
  status: 'verified',
  identity_status: 'verified',
  authenticity_status: 'verified',
  cheating_status: 'verified',
  comment: 'checked',
};

describe('SR-01 supersede authorization', () => {
  it('lets the uploader and reviewers supersede, blocks non-reviewers on closed cases', async () => {
    const { deps } = t();
    const caseRow = await makeCase(deps, await createPlayer(deps));
    const { user: reporter } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter);
    const reporterSession = await sessionFor(deps, reporter);

    const own = await upload(reporterSession.headers, caseRow.case_number);
    expect(own.statusCode).toBe(201);
    expect((await supersede(reporterSession.headers, own.json().id)).statusCode).toBe(201);

    const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const reviewerSession = await sessionFor(deps, reviewer);
    const second = await upload(reporterSession.headers, caseRow.case_number);
    expect(second.statusCode).toBe(201);
    // A reviewer (evidence:review) may supersede someone else's evidence.
    expect((await supersede(reviewerSession.headers, second.json().id)).statusCode).toBe(201);

    // The uploader (non-reviewer) cannot supersede once the case is closed.
    const third = await upload(reviewerSession.headers, caseRow.case_number);
    const ownThird = await upload(reporterSession.headers, caseRow.case_number);
    expect(ownThird.statusCode).toBe(429); // hourly non-staff limit (3) reached
    await deps.db.updateTable('cases').set({ status: 'closed', closed_at: deps.clock.now() }).where('id', '=', caseRow.id).execute();
    const { user: reporter2 } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter2);
    const s2 = await sessionFor(deps, reporter2);
    // Not the uploader → 403 (even with upload rights on the case).
    expectError(await supersede(s2.headers, third.json().id), 403, 'FORBIDDEN');
  });

  it('non-staff uploader on a closed case gets INVALID_STATE', async () => {
    const { deps } = t();
    const caseRow = await makeCase(deps, await createPlayer(deps));
    const { user: reporter } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter);
    const session = await sessionFor(deps, reporter);
    const own = await upload(session.headers, caseRow.case_number);
    expect(own.statusCode).toBe(201);
    await deps.db.updateTable('cases').set({ status: 'closed', closed_at: deps.clock.now() }).where('id', '=', caseRow.id).execute();
    expectError(await supersede(session.headers, own.json().id), 409, 'INVALID_STATE');
  });
});

describe('SR-02 / SPEC-1/2 self-dealing', () => {
  it('the case subject cannot be assigned their own appeal, and super_admin override does not bypass self-dealing', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const { user: setter } = await createUser(deps, { role: 'reviewer', totp: true });
    const caseRow = await makeCase(deps, player, { verdict: 'confirmed', verdictSetBy: setter.id });
    const { user: subject } = await createUser(deps, { role: 'super_admin', totp: true, playerId: player.id });
    const subjectSession = await sessionFor(deps, subject);
    const created = await t().app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      headers: subjectSession.headers,
      body: { case_id: caseRow.case_number, statement: 'Please look at this verdict again, it is wrong.' },
    });
    expect(created.statusCode).toBe(201);
    const appealId = created.json().id as string;

    const { user: moderator } = await createUser(deps, { role: 'moderator', totp: true });
    const modSession = await sessionFor(deps, moderator);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/appeals/${appealId}/assign`,
        headers: modSession.headers,
        body: { reviewer_user_id: subject.id },
      }),
      409,
      'CONFLICT_OF_INTEREST',
    );
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/appeals/${appealId}/decision`,
        headers: subjectSession.headers,
        body: { decision: 'reverse', reason: 'Overriding my own conflict.', override_conflict: true },
      }),
      409,
      'CONFLICT_OF_INTEREST',
    );
  });
});

describe('SR-03 enrollment gate on optional-auth routes', () => {
  it('unenrolled staff cannot obtain a download ticket either', async () => {
    const { deps } = t();
    const caseRow = await makeCase(deps, await createPlayer(deps));
    const { user: uploader } = await createUser(deps, { role: 'reviewer', totp: true });
    const up = await upload((await sessionFor(deps, uploader)).headers, caseRow.case_number);
    const { user: unenrolled } = await createUser(deps, { role: 'reviewer' });
    const session = await sessionFor(deps, unenrolled);
    expectError(
      await t().app.inject({ method: 'POST', url: `/api/v1/evidence/${up.json().id}/ticket`, headers: session.headers }),
      403,
      'MFA_ENROLLMENT_REQUIRED',
    );
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${up.json().id}/content`, headers: { cookie: session.cookie } }),
      403,
      'MFA_ENROLLMENT_REQUIRED',
    );
  });
});

describe('SR-04 / SPEC-3 server confirmations and own_servers projection', () => {
  it('a server that saw the player may confirm; the own_servers view is reduced', async () => {
    const { deps } = t();
    const identity = await createServerWithKey(deps);
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player);
    await deps.db
      .insertInto('player_server_sightings')
      .values({ player_id: player.id, server_id: identity.server.id, first_seen_at: deps.clock.now(), last_seen_at: deps.clock.now() })
      .execute();
    const { user: witness } = await createUser(deps, { username: `witness_${randomSteamId().slice(-6)}` });
    await addUserReport(deps, caseRow, witness);
    const witnessSession = await sessionFor(deps, witness);
    const ev = await upload(witnessSession.headers, caseRow.case_number);
    expect(ev.statusCode).toBe(201);

    const session = await sessionFor(deps, identity.owner);
    const confirm = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseRow.case_number}/confirmations`,
      headers: session.headers,
      body: { server_id: identity.server.server_id, note: null },
    });
    expect(confirm.statusCode).toBe(201);

    const view = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${caseRow.case_number}`, headers: session.headers });
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(body.reports).toHaveLength(1);
    expect(body.reports[0].reporter_user).toBeNull();
    expect(body.evidence).toEqual([]);
    expect(body.appeals).toEqual([]);
    expect(body.history).toEqual([]);

    // Reviewers still get the full view.
    const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const full = await t().app.inject({
      method: 'GET',
      url: `/api/v1/cases/${caseRow.case_number}`,
      headers: (await sessionFor(deps, reviewer)).headers,
    });
    expect(full.json().reports[0].reporter_user.username).toBe(witness.username);
    expect(full.json().evidence).toHaveLength(1);
    expect(full.json().history.length).toBeGreaterThan(0);
  });
});

describe('SR-05 2FA failures', () => {
  it('counts wrong codes toward the lockout and audits them', async () => {
    const { deps } = t();
    const { user, password } = await createUser(deps, { role: 'reviewer', totp: true });
    const login = await t().app.inject({ method: 'POST', url: '/api/v1/auth/login', body: { email: user.email, password } });
    const mfaToken = login.json().mfa_token as string;
    for (let i = 0; i < 5; i += 1) {
      const res = await t().app.inject({ method: 'POST', url: '/api/v1/auth/login/2fa', body: { mfa_token: mfaToken, code: String(200000 + i) } });
      expect(res.statusCode).toBe(401);
    }
    // The token is gone after 5 failures.
    expectError(
      await t().app.inject({ method: 'POST', url: '/api/v1/auth/login/2fa', body: { mfa_token: mfaToken, code: '123456' } }),
      401,
      'MFA_TOKEN_INVALID',
    );
    const row = await deps.db.selectFrom('users').select(['failed_login_count', 'locked_until']).where('id', '=', user.id).executeTakeFirstOrThrow();
    expect(row.failed_login_count).toBe(5);
    expect(row.locked_until).not.toBeNull();
    const failures = await deps.db
      .selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'USER_LOGIN_FAILED')
      .where('target_id', '=', user.id)
      .execute();
    expect(failures.every((f) => (f.metadata as { reason: string }).reason === 'invalid_mfa_code')).toBe(true);
    expect(failures).toHaveLength(5);
    // Locked: a fresh password login is refused.
    expectError(await t().app.inject({ method: 'POST', url: '/api/v1/auth/login', body: { email: user.email, password } }), 423, 'ACCOUNT_LOCKED');
  });
});

describe('SR-06 non-staff upload quotas', () => {
  it('caps file size, hourly count and daily bytes for non-staff uploaders', async () => {
    const { deps } = t();
    const caseRow = await makeCase(deps, await createPlayer(deps));
    const { user: reporter } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter);
    const session = await sessionFor(deps, reporter);
    // Per-file cap (EVIDENCE_MAX_BYTES_NON_STAFF = 4096) is bounded by the remaining daily bytes (1024).
    expectError(await upload(session.headers, caseRow.case_number, 2000), 413, 'PAYLOAD_TOO_LARGE');
    expect((await upload(session.headers, caseRow.case_number, 1024 - 67)).statusCode).toBe(201);
    // Daily byte quota (1024) is now used up.
    expectError(await upload(session.headers, caseRow.case_number, 16), 429, 'RATE_LIMITED');

    // Staff are not bound by the non-staff quotas.
    const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const staff = await sessionFor(deps, reviewer);
    for (let i = 0; i < 4; i += 1) expect((await upload(staff.headers, caseRow.case_number, 2000)).statusCode).toBe(201);
  });
});

describe('SR-07 player linking', () => {
  it('throttles failed link codes per server and lets a player re-claim an identity from a disabled account', async () => {
    const { deps } = t();
    const identity = await createServerWithKey(deps);
    const player = { type: 'steam' as const, id: randomSteamId() };
    for (let i = 0; i < LINK_FAILURES_PER_HOUR; i += 1) {
      const res = await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/player/link', body: { player, code: 'LNK-ZZZZZZ' } });
      expect(res.statusCode).not.toBe(200);
      expect(res.statusCode).not.toBe(429);
    }
    const throttled = await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/player/link', body: { player, code: 'LNK-ZZZZZZ' } });
    expect(throttled.statusCode).toBe(429);

    // Re-claim: the hijacking account is disabled by staff → the real player can link.
    const other = await createServerWithKey(deps);
    const victim = await createPlayer(deps);
    const { user: hijacker } = await createUser(deps, { playerId: victim.id });
    await deps.db.updateTable('users').set({ status: 'disabled' }).where('id', '=', hijacker.id).execute();
    const { user: real } = await createUser(deps);
    const realSession = await sessionFor(deps, real);
    const code = await t().app.inject({ method: 'POST', url: '/api/v1/me/player-link', headers: realSession.headers });
    expect(code.statusCode).toBe(200);
    const linked = await signedRequest(t().app, other, {
      method: 'POST',
      url: '/api/v1/player/link',
      body: { player: { type: victim.id_type, id: victim.external_id }, code: code.json().code },
    });
    expect(linked.statusCode).toBe(200);
    const rows = await deps.db.selectFrom('users').select(['id', 'player_id']).where('id', 'in', [hijacker.id, real.id]).execute();
    expect(rows.find((r) => r.id === hijacker.id)?.player_id).toBeNull();
    expect(rows.find((r) => r.id === real.id)?.player_id).toBe(victim.id);
  });
});

describe('SR-08 / SPEC-7 / SPEC-8 audit & rate-limit hygiene', () => {
  it('anonymous invalid proof lookups are not audited', async () => {
    const { deps } = t();
    const before = await deps.db.selectFrom('audit_events').select(deps.db.fn.countAll<string>().as('n')).where('action', '=', 'PROOF_VERIFIED').executeTakeFirstOrThrow();
    const identity = await createServerWithKey(deps);
    const query = new URLSearchParams({
      server_id: identity.server.server_id,
      player_id: `${randomSteamId()}@steam`,
      spectator_id: `${randomSteamId()}@steam`,
      timestamp: String(deps.clock.now().getTime()),
      code: 'AAA-AAA',
    });
    const res = await t().app.inject({ method: 'GET', url: `/api/v1/evidence/proof?${query}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(false);
    const after = await deps.db.selectFrom('audit_events').select(deps.db.fn.countAll<string>().as('n')).where('action', '=', 'PROOF_VERIFIED').executeTakeFirstOrThrow();
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('rate-limit keys never contain the raw IP', () => {
    const key = ipKey(t().deps.config, '203.0.113.7');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('203.0.113.7');
  });
});

describe('SR-09 evidence review conflicts', () => {
  it('reporters on the case and the case subject cannot review its evidence', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player);
    const { user: uploader } = await createUser(deps, { role: 'reviewer', totp: true });
    const ev = await upload((await sessionFor(deps, uploader)).headers, caseRow.case_number);
    const review = (headers: Record<string, string>) =>
      t().app.inject({ method: 'POST', url: `/api/v1/evidence/${ev.json().id}/reviews`, headers, payload: fullReview });

    const { user: reportingReviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    await addUserReport(deps, caseRow, reportingReviewer);
    expectError(await review((await sessionFor(deps, reportingReviewer)).headers), 409, 'CONFLICT_OF_INTEREST');

    const { user: subject } = await createUser(deps, { role: 'reviewer', totp: true, playerId: player.id });
    expectError(await review((await sessionFor(deps, subject)).headers), 409, 'CONFLICT_OF_INTEREST');

    const { user: independent } = await createUser(deps, { role: 'reviewer', totp: true });
    expect((await review((await sessionFor(deps, independent)).headers)).statusCode).toBe(201);
  });
});

describe('SPEC-5 / SPEC-6 verdict side effects', () => {
  it('audits each report resolved by a verdict', async () => {
    const { deps } = t();
    const caseRow = await makeCase(deps, await createPlayer(deps));
    const reportIds = [
      await addUserReport(deps, caseRow, (await createUser(deps)).user),
      await addUserReport(deps, caseRow, (await createUser(deps)).user),
    ];
    const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseRow.case_number}/verdict`,
      headers: (await sessionFor(deps, reviewer)).headers,
      body: { verdict: 'rejected', comment: 'no evidence of cheating' },
    });
    expect(res.statusCode).toBe(200);
    const events = await deps.db
      .selectFrom('audit_events')
      .select(['target_id', 'metadata'])
      .where('action', '=', 'REPORT_STATUS_CHANGED')
      .where('case_id', '=', caseRow.id)
      .execute();
    expect(events.map((e) => e.target_id).sort()).toEqual([...reportIds].sort());
    for (const e of events) expect(e.metadata).toMatchObject({ new_status: 'rejected', cause: 'verdict' });
    expect((await deps.audit.verifyChain({})).valid).toBe(true);
  });

  it('appeal decisions require a 2FA-verified session', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const { user: setter } = await createUser(deps, { role: 'reviewer', totp: true });
    const caseRow = await makeCase(deps, player, { verdict: 'confirmed', verdictSetBy: setter.id });
    const { user: appellant } = await createUser(deps, { playerId: player.id });
    const created = await t().app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      headers: (await sessionFor(deps, appellant)).headers,
      body: { case_id: caseRow.case_number, statement: 'I did not cheat, please review again.' },
    });
    expect(created.statusCode).toBe(201);
    const { user: decider } = await createUser(deps, { role: 'reviewer', totp: true });
    const noMfa = await sessionFor(deps, decider, { mfa_verified: false });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/appeals/${created.json().id}/decision`,
        headers: noMfa.headers,
        body: { decision: 'confirm', reason: 'Verdict stands.' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
