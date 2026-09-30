/**
 * Adversarial security review — confirmation tests.
 *
 * Every test here reproduces a finding of the security review and is marked `it.fails`:
 * it FAILS today (the vulnerable behaviour is observed) and must PASS once the finding is
 * fixed — then remove `.fails`. Each test was first run as a plain `it` to make sure it fails
 * at the security assertion and not during setup.
 */
import { describe, expect, it } from 'vitest';

import { generateTotpCode } from '../../src/auth/totp';
import { allocateCaseNumber } from '../../src/db/sequences';
import type { Deps } from '../../src/container';
import type { CaseRow, PlayerRow, UserRow } from '../../src/db/types';
import { createPlayer, createServerWithKey, createUser, sessionFor, signedRequest, useTestApp } from '../helpers';
import { multipartPayload, pngBytes } from '../modules/evidence/helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function makeCase(
  deps: Deps,
  player: PlayerRow,
  opts: { status?: CaseRow['status']; verdict?: CaseRow['current_verdict']; verdictSetBy?: string | null } = {},
): Promise<CaseRow> {
  const now = deps.clock.now();
  const verdict = opts.verdict ?? 'unknown';
  const status = opts.status ?? (verdict === 'unknown' ? 'open' : 'closed');
  return deps.db
    .insertInto('cases')
    .values({
      case_number: await allocateCaseNumber(deps.db, now.getUTCFullYear()),
      player_id: player.id,
      reason: 'security review case',
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

async function addUserReport(deps: Deps, caseRow: CaseRow, reporter: UserRow): Promise<void> {
  const now = deps.clock.now();
  await deps.db
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
    .execute();
}

async function uploadPng(headers: Record<string, string>, caseNumber: string) {
  const { payload, headers: mp } = multipartPayload(
    { type: 'image', title: 'screenshot' },
    { filename: 'shot.png', contentType: 'image/png', data: pngBytes(64) },
  );
  return t().app.inject({
    method: 'POST',
    url: `/api/v1/cases/${caseNumber}/evidence`,
    headers: { ...headers, ...mp },
    payload,
  });
}

describe('security review', () => {
  // SECURITY-REVIEW: expected to fail until SR-01 is fixed
  it.fails('SR-01: a mere reporter cannot supersede evidence uploaded by a reviewer', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player, { status: 'under_review' });

    const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const reviewerSession = await sessionFor(deps, reviewer);
    const upload = await uploadPng(reviewerSession.headers, caseRow.case_number);
    expect(upload.statusCode).toBe(201);
    const evidenceId = (upload.json() as { id: string }).id;

    // Any verified player (e.g. the accused player's friend) files a report → reporter on the case.
    const { user: reporter } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter);
    const reporterSession = await sessionFor(deps, reporter);

    const { payload, headers: mp } = multipartPayload(
      { reason: 'replacing this with a better file' },
      { filename: 'junk.png', contentType: 'image/png', data: pngBytes(8) },
    );
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/evidence/${evidenceId}/supersede`,
      headers: { ...reporterSession.headers, ...mp },
      payload,
    });
    // Today: 201 — the reviewer's evidence is marked superseded by the reporter's junk.
    expect(res.statusCode).toBe(403);
  });

  // SECURITY-REVIEW: expected to fail until SR-02 is fixed
  it.fails('SR-02: a reviewer cannot decide an appeal on a case about their own linked player', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const { user: otherReviewer } = await createUser(deps, { role: 'reviewer', totp: true });
    const caseRow = await makeCase(deps, player, { verdict: 'confirmed', verdictSetBy: otherReviewer.id });

    // The accused player is (also) a reviewer whose web account is linked to that player.
    const { user: accusedReviewer } = await createUser(deps, { role: 'reviewer', totp: true, playerId: player.id });
    const session = await sessionFor(deps, accusedReviewer);

    const created = await t().app.inject({
      method: 'POST',
      url: '/api/v1/appeals',
      headers: session.headers,
      body: { case_id: caseRow.case_number, statement: 'I did not cheat, please review the demo again.' },
    });
    expect(created.statusCode).toBe(201);
    const appealId = (created.json() as { id: string }).id;

    const decided = await t().app.inject({
      method: 'POST',
      url: `/api/v1/appeals/${appealId}/decision`,
      headers: session.headers,
      body: { decision: 'reverse', reason: 'Reversing my own confirmed verdict.' },
    });
    // Today: 200 and the case verdict becomes `rejected`.
    expect(decided.statusCode).toBe(409);
  });

  // SECURITY-REVIEW: expected to fail until SR-02 is fixed
  it.fails('SR-02b: a reviewer cannot set the verdict of a case about their own linked player', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player, { status: 'under_review' });
    const { user: accusedReviewer } = await createUser(deps, { role: 'reviewer', totp: true, playerId: player.id });
    const session = await sessionFor(deps, accusedReviewer, { mfa_verified: true });

    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseRow.case_number}/verdict`,
      headers: session.headers,
      body: { verdict: 'rejected', comment: 'Nothing to see here, closing my own case.' },
    });
    // Today: 200 — the accused reviewer closes their own case as rejected.
    expect(res.statusCode).toBe(409);
  });

  // SECURITY-REVIEW: expected to fail until SR-03 is fixed
  it.fails('SR-03a: staff without enrolled 2FA cannot download evidence content with the session cookie', async () => {
    const { deps } = t();
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player, { status: 'under_review' });
    const { user: uploader } = await createUser(deps, { role: 'reviewer', totp: true });
    const upload = await uploadPng((await sessionFor(deps, uploader)).headers, caseRow.case_number);
    expect(upload.statusCode).toBe(201);
    const evidenceId = (upload.json() as { id: string }).id;

    // Reviewer whose password was phished; 2FA never enrolled → mfa_enrollment_required.
    const { user: unenrolled } = await createUser(deps, { role: 'reviewer' });
    const session = await sessionFor(deps, unenrolled);
    const gated = await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${evidenceId}`, headers: session.headers });
    expect(gated.statusCode).toBe(403); // metadata route is gated correctly …

    const res = await t().app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${evidenceId}/content`,
      headers: { cookie: session.cookie },
    });
    // … but today the content route answers 200 with the file.
    expect(res.statusCode).toBe(403);
  });

  // SECURITY-REVIEW: expected to fail until SR-03 is fixed
  it.fails('SR-03b: staff without enrolled 2FA do not get expected proof codes (proof:view_code)', async () => {
    const { deps } = t();
    const identity = await createServerWithKey(deps);
    const target = { type: 'steam' as const, id: '76561198000000101' };
    const spectator = { type: 'steam' as const, id: '76561198000000102' };
    const started = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/overwatch/sessions',
      body: { target_player: target, spectator },
    });
    expect(started.statusCode).toBe(201);

    const { user: unenrolled } = await createUser(deps, { role: 'reviewer' });
    const session = await sessionFor(deps, unenrolled);
    const query = new URLSearchParams({
      server_id: identity.server.server_id,
      player_id: `${target.id}@steam`,
      spectator_id: `${spectator.id}@steam`,
      timestamp: String(deps.clock.now().getTime()),
    });
    const res = await t().app.inject({ method: 'GET', url: `/api/v1/evidence/proof?${query}`, headers: { cookie: session.cookie } });
    // Today: 200 { valid: true, code: "XXX-XXX" } — the code oracle is open to a session that
    // every other staff route rejects with MFA_ENROLLMENT_REQUIRED.
    expect(res.statusCode === 200 && (res.json() as { code?: string }).code !== undefined).toBe(false);
  });

  // SECURITY-REVIEW: expected to fail until SR-04 is fixed
  it.fails('SR-04: a server owner cannot self-grant the staff view of an unrelated case by confirming it', async () => {
    const { deps } = t();
    const identity = await createServerWithKey(deps); // owner = fresh server_admin
    const player = await createPlayer(deps);
    const caseRow = await makeCase(deps, player, { status: 'under_review' });
    const { user: reporter } = await createUser(deps);
    await addUserReport(deps, caseRow, reporter);

    const session = await sessionFor(deps, identity.owner);
    const before = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${caseRow.case_number}`, headers: session.headers });
    expect(before.statusCode).toBe(403);

    await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseRow.case_number}/confirmations`,
      headers: session.headers,
      body: { server_id: identity.server.server_id, note: null },
    });
    const after = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${caseRow.case_number}`, headers: session.headers });
    // Today: 201 on the confirmation, then 200 with reports (reporter identities), appeal
    // statements, reviews and audit history of a case the server never saw.
    expect(after.statusCode).toBe(403);
  });

  // SECURITY-REVIEW: expected to fail until SR-05 is fixed
  it.fails('SR-05: an mfa_token is invalidated after repeated wrong 2FA codes', async () => {
    const { deps } = t();
    const { user, password, totpSecret } = await createUser(deps, { role: 'reviewer', totp: true });
    const login = await t().app.inject({ method: 'POST', url: '/api/v1/auth/login', body: { email: user.email, password } });
    expect(login.statusCode).toBe(200);
    const mfaToken = (login.json() as { mfa_token: string }).mfa_token;

    for (let i = 0; i < 25; i += 1) {
      const wrong = await t().app.inject({
        method: 'POST',
        url: '/api/v1/auth/login/2fa',
        body: { mfa_token: mfaToken, code: String(100000 + i) },
      });
      expect(wrong.statusCode).toBe(401);
    }
    const correct = await t().app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/2fa',
      body: { mfa_token: mfaToken, code: generateTotpCode(totpSecret!, deps.clock.now()) },
    });
    // Today: 200 — 25 wrong guesses on one token, no per-account counter, no lockout, no audit.
    expect(correct.statusCode).not.toBe(200);
  });
});
