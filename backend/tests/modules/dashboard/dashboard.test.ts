/**
 * Dashboard (§13 "Dashboard"): per-role scoping of counts, server list and
 * recent audit events; null counts for inaccessible areas.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { allocateCaseNumber } from '../../../src/db/sequences';
import type { Deps } from '../../../src/container';
import type { CaseRow, PlayerRow } from '../../../src/db/types';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function makeCase(deps: Deps, player: PlayerRow, status: CaseRow['status'], verdict: CaseRow['current_verdict'] = 'unknown') {
  const now = deps.clock.now();
  const caseNumber = await allocateCaseNumber(deps.db, now.getUTCFullYear());
  return deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: player.id,
      reason: 'dashboard testing',
      status,
      current_verdict: verdict,
      closed_at: status === 'closed' ? now : null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function addServerReport(deps: Deps, caseRow: CaseRow, serverUuid: string) {
  const now = deps.clock.now();
  await deps.db
    .insertInto('reports')
    .values({
      case_id: caseRow.id,
      player_id: caseRow.player_id,
      reporter_type: 'server',
      server_id: serverUuid,
      reason: 'in-game report',
      status: 'open',
      created_at: now,
      updated_at: now,
    })
    .execute();
}

interface Fixture {
  serverA: Awaited<ReturnType<typeof createServerWithKey>>;
  serverB: Awaited<ReturnType<typeof createServerWithKey>>;
  player: PlayerRow;
  playerUser: Awaited<ReturnType<typeof createUser>>['user'];
}

let fx: Fixture;

beforeAll(async () => {
  const deps = t().deps;
  const serverA = await createServerWithKey(deps, { name: 'Server A' });
  const serverB = await createServerWithKey(deps, { name: 'Server B' });
  const player = await createPlayer(deps);
  const { user: playerUser } = await createUser(deps, { playerId: player.id });

  // one open case per server (involvement via server report)
  const caseA = await makeCase(deps, player, 'open');
  await addServerReport(deps, caseA, serverA.server.id);
  const otherPlayer = await createPlayer(deps);
  const caseB = await makeCase(deps, otherPlayer, 'open');
  await addServerReport(deps, caseB, serverB.server.id);

  // player's own open user report
  await deps.db
    .insertInto('reports')
    .values({
      case_id: caseA.id,
      player_id: otherPlayer.id,
      reporter_type: 'user',
      reporter_user_id: playerUser.id,
      reason: 'suspicious player',
      status: 'open',
      created_at: deps.clock.now(),
      updated_at: deps.clock.now(),
    })
    .execute();

  // player's appeal on a confirmed case
  const confirmed = await makeCase(deps, player, 'closed', 'confirmed');
  const session = await loginAs(t().app, playerUser);
  const appealRes = await t().app.inject({
    method: 'POST',
    url: '/api/v1/appeals',
    headers: session.headers,
    body: { case_id: confirmed.case_number, statement: 'please have another look at this case' },
  });
  expect(appealRes.statusCode).toBe(201);

  // pending whitelist request for server A (creates an audited server_id event)
  const wlRes = await t().app.inject({
    method: 'POST',
    url: '/api/v1/whitelist-requests',
    headers: session.headers,
    body: { server_id: serverA.server.server_id, type: 'vpn_whitelist', reason: 'VPN needed for privacy' },
  });
  expect(wlRes.statusCode).toBe(201);

  fx = { serverA, serverB, player, playerUser };
});

async function dashboardFor(user: Parameters<typeof loginAs>[1]) {
  const session = await loginAs(t().app, user);
  const res = await t().app.inject({ method: 'GET', url: '/api/v1/dashboard', headers: session.headers });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /dashboard', () => {
  it('requires authentication', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/dashboard' }), 401, 'UNAUTHENTICATED');
  });

  it('players see their own submissions, null staff counts, no servers, no audit', async () => {
    const body = await dashboardFor(fx.playerUser as never);
    expect(body.counts).toEqual({
      open_cases: null,
      cases_under_review: null,
      pending_reports: 1,
      pending_appeals: 1,
      evidence_awaiting_review: null,
      pending_whitelist_requests: 1,
    });
    expect(body.servers).toEqual([]);
    expect(body.recent_audit_events).toEqual([]);
    expect(body.generated_at).toBe('2026-09-29T12:00:00.000Z');
  });

  it('server team members see only their servers (counts, server status, audit events)', async () => {
    const body = await dashboardFor(fx.serverA.owner as never);
    expect(body.counts.open_cases).toBe(1); // only case A involves server A
    expect(body.counts.pending_reports).toBe(1); // server A's open report
    expect(body.counts.pending_whitelist_requests).toBe(1);
    expect(body.counts.evidence_awaiting_review).toBeNull();
    expect(body.counts.pending_appeals).toBe(0); // own submissions only

    expect(body.servers).toHaveLength(1);
    expect(body.servers[0]).toMatchObject({
      server_id: fx.serverA.server.server_id,
      name: 'Server A',
      status: 'active',
      member_role: 'owner',
    });

    expect(body.recent_audit_events.length).toBeGreaterThanOrEqual(1);
    const actions = body.recent_audit_events.map((e: { action: string }) => e.action);
    expect(actions).toContain('BYPASS_REQUESTED');
    // no events of server B (its SERVER_REGISTERED/report events carry server B's id)
    for (const event of body.recent_audit_events) {
      expect(event).not.toHaveProperty('metadata');
    }
    const bOwnerBody = await dashboardFor(fx.serverB.owner as never);
    const bActions = bOwnerBody.recent_audit_events.map((e: { action: string }) => e.action);
    expect(bActions).not.toContain('BYPASS_REQUESTED');
    expect(bOwnerBody.counts.pending_whitelist_requests).toBe(0);
    expect(bOwnerBody.counts.open_cases).toBe(1);
  });

  it('staff (dashboard:staff) see global counts; without audit:view no audit feed, without memberships no servers', async () => {
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const body = await dashboardFor(reviewer as never);
    expect(body.counts.open_cases).toBe(2);
    expect(body.counts.cases_under_review).toBe(0);
    expect(body.counts.pending_reports).toBe(3); // 2 server reports + 1 user report
    expect(body.counts.pending_appeals).toBe(1);
    expect(body.counts.evidence_awaiting_review).toBe(0);
    // reviewers do not hold whitelist:decide_any → they only see their own requests
    expect(body.counts.pending_whitelist_requests).toBe(0);
    expect(body.servers).toEqual([]);
    expect(body.recent_audit_events).toEqual([]);

    // moderators (whitelist:decide_any) see the global pending count
    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const modBody = await dashboardFor(moderator as never);
    expect(modBody.counts.pending_whitelist_requests).toBe(1);
  });

  it('admins see all servers and the global audit feed', async () => {
    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const body = await dashboardFor(admin as never);
    const names = body.servers.map((s: { name: string }) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Server A', 'Server B']));
    expect(body.servers.find((s: { name: string }) => s.name === 'Server A').member_role).toBeNull();
    expect(body.recent_audit_events.length).toBeGreaterThanOrEqual(1);
    expect(body.recent_audit_events.length).toBeLessThanOrEqual(20);
    expect(body.counts.open_cases).toBe(2);
  });
});
