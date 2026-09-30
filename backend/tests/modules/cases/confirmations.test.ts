/**
 * Server confirmations (§11.4): membership authorization, active-server rule,
 * state rules, duplicates, revocation, distinct-owner counts, audit events.
 */
import { describe, expect, it } from 'vitest';

import { allocateCaseNumber } from '../../../src/db/sequences';
import { generateServerId } from '../../../src/lib/ids';
import type { Deps } from '../../../src/container';
import type { CaseRow, PlayerRow, ServerMemberRole } from '../../../src/db/types';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function makeCase(
  deps: Deps,
  player: PlayerRow,
  overrides: Partial<{ status: CaseRow['status']; verdict: CaseRow['current_verdict'] }> = {},
): Promise<CaseRow> {
  const now = deps.clock.now();
  const caseNumber = await allocateCaseNumber(deps.db, now.getUTCFullYear());
  const status = overrides.status ?? 'under_review';
  return deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: player.id,
      reason: 'confirmation testing',
      status,
      current_verdict: overrides.verdict ?? 'unknown',
      closed_at: status === 'closed' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addMember(deps: Deps, serverUuid: string, userId: string, role: ServerMemberRole, createdBy: string) {
  await deps.db
    .insertInto('server_members')
    .values({ server_id: serverUuid, user_id: userId, role, created_by: createdBy, created_at: deps.clock.now() })
    .execute();
}

function confirmUrl(caseNumber: string): string {
  return `/api/v1/cases/${caseNumber}/confirmations`;
}

describe('POST /cases/{caseNumber}/confirmations', () => {
  it('owner member of an active server confirms a case under review (audited)', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const session = await loginAs(t().app, owner);
    const row = await makeCase(t().deps, await createPlayer(t().deps));

    const res = await t().app.inject({
      method: 'POST',
      url: confirmUrl(row.case_number),
      headers: session.headers,
      body: { server_id: server.server_id, note: 'we saw it too' },
    });
    expect(res.statusCode).toBe(201);

    const confirmation = await t()
      .db.selectFrom('case_server_confirmations')
      .selectAll()
      .where('case_id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(confirmation).toMatchObject({ server_id: server.id, confirmed_by_user_id: owner.id, note: 'we saw it too' });

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'server_id'])
      .where('case_id', '=', row.id)
      .execute();
    expect(audit).toEqual([{ action: 'CASE_CONFIRMED_BY_SERVER', server_id: server.id }]);
  });

  it('admin member (global role player) may confirm; moderator member and non-members may not', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const row = await makeCase(t().deps, await createPlayer(t().deps));
    const body = { server_id: server.server_id, note: null };

    const { user: adminMember } = await createUser(t().deps); // global role: player
    await addMember(t().deps, server.id, adminMember.id, 'admin', owner.id);
    const adminSession = await loginAs(t().app, adminMember);
    const ok = await t().app.inject({ method: 'POST', url: confirmUrl(row.case_number), headers: adminSession.headers, body });
    expect(ok.statusCode).toBe(201);

    const row2 = await makeCase(t().deps, await createPlayer(t().deps));
    const { user: modMember } = await createUser(t().deps);
    await addMember(t().deps, server.id, modMember.id, 'moderator', owner.id);
    const modSession = await loginAs(t().app, modMember);
    expectError(
      await t().app.inject({ method: 'POST', url: confirmUrl(row2.case_number), headers: modSession.headers, body }),
      403,
      'FORBIDDEN',
    );

    const { user: outsider } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const outsiderSession = await loginAs(t().app, outsider);
    expectError(
      await t().app.inject({ method: 'POST', url: confirmUrl(row2.case_number), headers: outsiderSession.headers, body }),
      403,
      'FORBIDDEN',
    );
  });

  it('suspended servers cannot confirm', async () => {
    const { server, owner } = await createServerWithKey(t().deps, { status: 'suspended' });
    const session = await loginAs(t().app, owner);
    const row = await makeCase(t().deps, await createPlayer(t().deps));
    expectError(
      await t().app.inject({
        method: 'POST',
        url: confirmUrl(row.case_number),
        headers: session.headers,
        body: { server_id: server.server_id, note: null },
      }),
      409,
      'SERVER_NOT_ACTIVE',
    );
  });

  it('requires a confirmed verdict or a case under review', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const session = await loginAs(t().app, owner);
    const openCase = await makeCase(t().deps, await createPlayer(t().deps), { status: 'open' });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: confirmUrl(openCase.case_number),
        headers: session.headers,
        body: { server_id: server.server_id, note: null },
      }),
      409,
      'INVALID_STATE',
    );
    // Closed + confirmed verdict is allowed.
    const confirmedCase = await makeCase(t().deps, await createPlayer(t().deps), { status: 'closed', verdict: 'confirmed' });
    const ok = await t().app.inject({
      method: 'POST',
      url: confirmUrl(confirmedCase.case_number),
      headers: session.headers,
      body: { server_id: server.server_id, note: null },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('one active confirmation per server (duplicate → ALREADY_EXISTS); revoke allows a new one', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const session = await loginAs(t().app, owner);
    const row = await makeCase(t().deps, await createPlayer(t().deps));
    const body = { server_id: server.server_id, note: null };

    expect((await t().app.inject({ method: 'POST', url: confirmUrl(row.case_number), headers: session.headers, body })).statusCode).toBe(201);
    expectError(
      await t().app.inject({ method: 'POST', url: confirmUrl(row.case_number), headers: session.headers, body }),
      409,
      'ALREADY_EXISTS',
    );

    const confirmation = await t()
      .db.selectFrom('case_server_confirmations')
      .selectAll()
      .where('case_id', '=', row.id)
      .executeTakeFirstOrThrow();

    // Revoke (with reason) — audited, soft.
    const revoke = await t().app.inject({
      method: 'DELETE',
      url: `${confirmUrl(row.case_number)}/${confirmation.id}`,
      headers: session.headers,
      body: { reason: 'confirmed by mistake' },
    });
    expect(revoke.statusCode).toBe(200);
    const revoked = await t()
      .db.selectFrom('case_server_confirmations')
      .selectAll()
      .where('id', '=', confirmation.id)
      .executeTakeFirstOrThrow();
    expect(revoked.revoked_at).not.toBeNull();
    expect(revoked.revoked_by).toBe(owner.id);
    expect(revoked.revoke_reason).toBe('confirmed by mistake');

    // Revoking twice is invalid.
    expectError(
      await t().app.inject({
        method: 'DELETE',
        url: `${confirmUrl(row.case_number)}/${confirmation.id}`,
        headers: session.headers,
        body: {},
      }),
      409,
      'INVALID_STATE',
    );

    // A fresh confirmation is possible again.
    expect((await t().app.inject({ method: 'POST', url: confirmUrl(row.case_number), headers: session.headers, body })).statusCode).toBe(201);

    const actions = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('case_id', '=', row.id)
      .orderBy('seq')
      .execute();
    expect(actions.map((a) => a.action)).toEqual([
      'CASE_CONFIRMED_BY_SERVER',
      'CASE_CONFIRMATION_REVOKED',
      'CASE_CONFIRMED_BY_SERVER',
    ]);
  });

  it('revocation is only allowed for members of the confirming server', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const ownerSession = await loginAs(t().app, owner);
    const row = await makeCase(t().deps, await createPlayer(t().deps));
    await t().app.inject({
      method: 'POST',
      url: confirmUrl(row.case_number),
      headers: ownerSession.headers,
      body: { server_id: server.server_id, note: null },
    });
    const confirmation = await t()
      .db.selectFrom('case_server_confirmations')
      .select('id')
      .where('case_id', '=', row.id)
      .executeTakeFirstOrThrow();

    const { owner: otherOwner } = await createServerWithKey(t().deps);
    const otherSession = await loginAs(t().app, otherOwner);
    expectError(
      await t().app.inject({
        method: 'DELETE',
        url: `${confirmUrl(row.case_number)}/${confirmation.id}`,
        headers: otherSession.headers,
        body: {},
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('counts distinct servers and distinct owners in the staff view', async () => {
    const commonOwner = (await createUser(t().deps)).user;
    const s1 = await createServerWithKey(t().deps, { owner: commonOwner });
    const s2 = await createServerWithKey(t().deps, { owner: commonOwner });
    const s3 = await createServerWithKey(t().deps);
    const row = await makeCase(t().deps, await createPlayer(t().deps));

    const commonSession = await loginAs(t().app, commonOwner);
    const s3Session = await loginAs(t().app, s3.owner);
    for (const [session, server] of [
      [commonSession, s1.server],
      [commonSession, s2.server],
      [s3Session, s3.server],
    ] as const) {
      const res = await t().app.inject({
        method: 'POST',
        url: confirmUrl(row.case_number),
        headers: session.headers,
        body: { server_id: server.server_id, note: null },
      });
      expect(res.statusCode).toBe(201);
    }

    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const staffSession = await loginAs(t().app, reviewer);
    const view = await t().app.inject({ method: 'GET', url: `/api/v1/cases/${row.case_number}`, headers: staffSession.headers });
    expect(view.statusCode).toBe(200);
    const body = view.json();
    expect(body.confirmed_servers).toBe(3);
    expect(body.independent_confirmed_servers).toBe(2);
    expect(body.confirmations).toHaveLength(3);
    expect(body.confirmations.every((c: { active: boolean }) => c.active)).toBe(true);

    // Public view exposes the distinct server count.
    const publicView = await t().app.inject({ method: 'GET', url: `/api/v1/public/cases/${row.case_number}` });
    expect(publicView.json().confirmed_servers).toBe(3);
  });

  it('rejects confirmations for unknown servers and unknown cases', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const session = await loginAs(t().app, owner);
    const row = await makeCase(t().deps, await createPlayer(t().deps));
    expectError(
      await t().app.inject({
        method: 'POST',
        url: confirmUrl(row.case_number),
        headers: session.headers,
        body: { server_id: generateServerId(), note: null },
      }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await t().app.inject({
        method: 'POST',
        url: confirmUrl('CASE-2026-999997'),
        headers: session.headers,
        body: { server_id: server.server_id, note: null },
      }),
      404,
      'NOT_FOUND',
    );
  });
});
