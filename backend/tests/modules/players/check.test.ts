/**
 * POST /api/v1/player/check end-to-end (§6.1): signed requests, case aggregation
 * for every global status, confirmations (distinct owners), policy version,
 * bypasses with honor_global_bypasses, no 'action' field (R1), raw IP never
 * persisted anywhere (§8.1).
 */
import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Deps } from '../../../src/container';
import {
  createPlayer,
  createServerWithKey,
  createUser,
  expectError,
  randomSteamId,
  signedRequest,
  useTestApp,
} from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';

type Identity = Awaited<ReturnType<typeof createServerWithKey>>;

async function check(app: unknown, identity: Identity, body: Record<string, unknown>) {
  return signedRequest(app as never, identity, { method: 'POST', url: '/api/v1/player/check', body });
}

let caseSeq = 0;
async function makeCase(
  deps: Deps,
  playerId: string,
  opts: { verdict?: 'unknown' | 'inconclusive' | 'confirmed' | 'rejected'; status?: 'open' | 'under_review' | 'closed'; createdAt?: Date } = {},
) {
  caseSeq += 1;
  const status = opts.status ?? 'open';
  return deps.db
    .insertInto('cases')
    .values({
      case_number: `CASE-2026-8${String(caseSeq).padStart(5, '0')}`,
      player_id: playerId,
      current_verdict: opts.verdict ?? 'unknown',
      status,
      closed_at: status === 'closed' ? deps.clock.now() : null,
      reason: 'test case',
      created_at: opts.createdAt ?? deps.clock.now(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function makeReport(deps: Deps, caseId: string, playerId: string, status: 'open' | 'under_review' | 'resolved' | 'rejected', reporter: { id: string }) {
  return deps.db
    .insertInto('reports')
    .values({
      case_id: caseId,
      player_id: playerId,
      reporter_type: 'user',
      reporter_user_id: reporter.id,
      reason: 'cheating suspicion',
      status,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

async function confirm(deps: Deps, caseId: string, server: { id: string; owner_user_id?: string }, byUserId: string) {
  await deps.db
    .insertInto('case_server_confirmations')
    .values({ case_id: caseId, server_id: server.id, confirmed_by_user_id: byUserId })
    .execute();
}

describe('POST /api/v1/player/check', () => {
  const t = useTestApp({ now: NOW });

  it('clean player: upserts player + sighting and answers with pure information', async () => {
    const identity = await createServerWithKey(t().deps);
    const steamId = randomSteamId();
    const res = await check(t().app, identity, {
      player: { type: 'steam', id: steamId },
      nickname: 'Fresh Player',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      player: { type: 'steam', id: steamId, user_id: `${steamId}@steam`, first_seen_at: NOW },
      global_status: 'none',
      case_id: null,
      cases: [],
      reports: 0,
      open_reports: 0,
      confirmed_servers: 0,
      independent_confirmed_servers: 0,
      account_age: { days: null, created_at: null, source: 'unknown' },
      vpn: { detected: false, confidence: 'not_detected', type: null, checked: false },
      bypass: { active: false, types: [], bypasses: [] },
      alt_account: { possible: false, confidence: 'none', signals: [], linked_confirmed_cases: [] },
      policy_version: 1, // no stored policy → default version 1
      checked_at: NOW,
    });
    // R1: strictly no enforcement action in the response.
    expect(body).not.toHaveProperty('action');
    expect(JSON.stringify(body)).not.toContain('"action"');

    const player = await t().db.selectFrom('players').selectAll().where('external_id', '=', steamId).executeTakeFirstOrThrow();
    expect(player.display_name).toBe('Fresh Player');
    expect(player.first_seen_at?.toISOString()).toBe(NOW);
    const sighting = await t()
      .db.selectFrom('player_server_sightings')
      .selectAll()
      .where('player_id', '=', player.id)
      .executeTakeFirstOrThrow();
    expect(sighting.server_id).toBe(identity.server.id);
    expect(sighting.join_count).toBe(1);

    // Second join: last_seen/join_count move, first_seen stays.
    t().clock.advance(60_000);
    await check(t().app, identity, { player: { type: 'steam', id: steamId }, nickname: 'Renamed' });
    const again = await t().db.selectFrom('players').selectAll().where('id', '=', player.id).executeTakeFirstOrThrow();
    expect(again.first_seen_at?.toISOString()).toBe(NOW);
    expect(again.last_seen_at!.getTime()).toBe(player.last_seen_at!.getTime() + 60_000);
    expect(again.display_name).toBe('Renamed');
  });

  it('uses the account_created_at hint as server_reported (provider yields nothing)', async () => {
    const identity = await createServerWithKey(t().deps);
    const res = await check(t().app, identity, {
      player: { type: 'steam', id: randomSteamId() },
      account_created_at: '2026-09-26T12:00:00.000Z',
    });
    expect(res.json().account_age).toEqual({ days: 3, created_at: '2026-09-26T12:00:00.000Z', source: 'server_reported' });
  });

  it('reported: open case with a non-rejected report', async () => {
    const identity = await createServerWithKey(t().deps);
    const reporter = (await createUser(t().deps)).user;
    const player = await createPlayer(t().deps);
    const c = await makeCase(t().deps, player.id, { status: 'open' });
    await makeReport(t().deps, c.id, player.id, 'open', reporter);
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.global_status).toBe('reported');
    expect(body.case_id).toBe(c.case_number);
    expect(body.reports).toBe(1);
    expect(body.open_reports).toBe(1);
    expect(body.cases).toEqual([{ case_id: c.case_number, verdict: 'unknown', status: 'open', confirmed_servers: 0 }]);
  });

  it('an open case with only rejected reports is not "reported"', async () => {
    const identity = await createServerWithKey(t().deps);
    const reporter = (await createUser(t().deps)).user;
    const player = await createPlayer(t().deps);
    const c = await makeCase(t().deps, player.id, { status: 'open' });
    await makeReport(t().deps, c.id, player.id, 'rejected', reporter);
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.global_status).toBe('none');
    expect(body.reports).toBe(0);
  });

  it('under_review beats reported', async () => {
    const identity = await createServerWithKey(t().deps);
    const reporter = (await createUser(t().deps)).user;
    const player = await createPlayer(t().deps);
    const open = await makeCase(t().deps, player.id, { status: 'open', createdAt: new Date('2026-09-01T00:00:00.000Z') });
    await makeReport(t().deps, open.id, player.id, 'open', reporter);
    const review = await makeCase(t().deps, player.id, { status: 'under_review' });
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.global_status).toBe('under_review');
    expect(body.case_id).toBe(review.case_number);
  });

  it('confirmed with confirmations: distinct servers and distinct owners counted on the producing case', async () => {
    const identity = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const c = await makeCase(t().deps, player.id, { verdict: 'confirmed', status: 'closed' });
    const s1 = await createServerWithKey(t().deps);
    const s2 = await createServerWithKey(t().deps);
    const s3 = await createServerWithKey(t().deps, { owner: s2.owner }); // same owner as s2
    await confirm(t().deps, c.id, s1.server, s1.owner.id);
    await confirm(t().deps, c.id, s2.server, s2.owner.id);
    await confirm(t().deps, c.id, s3.server, s2.owner.id);
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.global_status).toBe('confirmed');
    expect(body.case_id).toBe(c.case_number);
    expect(body.confirmed_servers).toBe(3);
    expect(body.independent_confirmed_servers).toBe(2);
    expect(body.cases[0].confirmed_servers).toBe(3);
  });

  it('revoked confirmations are not counted', async () => {
    const identity = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const c = await makeCase(t().deps, player.id, { verdict: 'confirmed', status: 'closed' });
    const s1 = await createServerWithKey(t().deps);
    await t()
      .db.insertInto('case_server_confirmations')
      .values({
        case_id: c.id,
        server_id: s1.server.id,
        confirmed_by_user_id: s1.owner.id,
        revoked_at: t().clock.now(),
        revoked_by: s1.owner.id,
        revoke_reason: 'mistake',
      })
      .execute();
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.confirmed_servers).toBe(0);
  });

  it('inconclusive and rejected map to their global statuses', async () => {
    const identity = await createServerWithKey(t().deps);
    for (const verdict of ['inconclusive', 'rejected'] as const) {
      const player = await createPlayer(t().deps);
      await makeCase(t().deps, player.id, { verdict, status: 'closed' });
      const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
      expect(body.global_status).toBe(verdict);
    }
  });

  it('confirmed wins over everything; the most recent confirmed case produces the status', async () => {
    const identity = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const oldConfirmed = await makeCase(t().deps, player.id, {
      verdict: 'confirmed',
      status: 'closed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newConfirmed = await makeCase(t().deps, player.id, {
      verdict: 'confirmed',
      status: 'closed',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    await makeCase(t().deps, player.id, { status: 'under_review' });
    const body = (await check(t().app, identity, { player: { type: player.id_type, id: player.external_id } })).json();
    expect(body.global_status).toBe('confirmed');
    expect(body.case_id).toBe(newConfirmed.case_number);
    expect(body.cases).toHaveLength(3);
    expect(body.cases.map((c: { case_id: string }) => c.case_id)).toContain(oldConfirmed.case_number);
  });

  it('reports the active policy version of the checking server', async () => {
    const identity = await createServerWithKey(t().deps);
    await t()
      .db.insertInto('server_policies')
      .values({ server_id: identity.server.id, version: 3, is_active: true, backend_unavailable_action: 'allow' })
      .execute();
    const body = (await check(t().app, identity, { player: { type: 'steam', id: randomSteamId() } })).json();
    expect(body.policy_version).toBe(3);
  });

  it('bypasses: server-scoped always, global only with honor_global_bypasses', async () => {
    const granter = (await createUser(t().deps, { role: 'admin' })).user;
    const player = await createPlayer(t().deps);
    const mine = await createServerWithKey(t().deps);
    const other = await createServerWithKey(t().deps);
    await t()
      .db.insertInto('bypasses')
      .values([
        { player_id: player.id, scope: 'server', server_id: mine.server.id, type: 'vpn_whitelist', reason: 'trusted', granted_by_user_id: granter.id },
        { player_id: player.id, scope: 'server', server_id: other.server.id, type: 'vpn_whitelist', reason: 'other server', granted_by_user_id: granter.id },
        { player_id: player.id, scope: 'global', server_id: null, type: 'account_age_whitelist', reason: 'global', granted_by_user_id: granter.id },
      ])
      .execute();
    const ref = { type: player.id_type, id: player.external_id };

    const withoutHonor = (await check(t().app, mine, { player: ref })).json();
    expect(withoutHonor.bypass.active).toBe(true);
    expect(withoutHonor.bypass.types).toEqual(['vpn_whitelist']);
    expect(withoutHonor.bypass.bypasses).toHaveLength(1);

    await t()
      .db.insertInto('server_policies')
      .values({ server_id: mine.server.id, version: 1, is_active: true, honor_global_bypasses: true })
      .execute();
    const withHonor = (await check(t().app, mine, { player: ref })).json();
    expect(withHonor.bypass.types.sort()).toEqual(['account_age_whitelist', 'vpn_whitelist']);
    expect(withHonor.bypass.bypasses).toHaveLength(2);
  });

  it('rejects a body server_id that does not match the signature header', async () => {
    const identity = await createServerWithKey(t().deps);
    const otherId = (await createServerWithKey(t().deps)).server.server_id;
    const res = await check(t().app, identity, { server_id: otherId, player: { type: 'steam', id: randomSteamId() } });
    expectError(res, 400, 'SERVER_ID_MISMATCH');
  });

  it('rejects unsigned requests and invalid bodies', async () => {
    const identity = await createServerWithKey(t().deps);
    const unsigned = await t().app.inject({ method: 'POST', url: '/api/v1/player/check', payload: { player: { type: 'steam', id: randomSteamId() } } });
    expect(unsigned.statusCode).toBe(401);
    const invalid = await check(t().app, identity, { player: { type: 'steam', id: 'not-a-steamid' } });
    expectError(invalid, 400, 'VALIDATION_FAILED');
  });

  it('never persists the raw IP anywhere in the database (§8.1)', async () => {
    const identity = await createServerWithKey(t().deps);
    const rawIp = '93.184.216.77';
    const res = await check(t().app, identity, {
      player: { type: 'steam', id: randomSteamId() },
      nickname: 'IpScan',
      ip: rawIp,
    });
    expect(res.statusCode).toBe(200);
    // Observations were written (hashes only)…
    const obs = await t().db.selectFrom('player_network_observations').selectAll().execute();
    expect(obs.length).toBeGreaterThan(0);
    // …and no text representation of the address exists in ANY row of ANY table.
    const tables = await t().deps.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    for (const { table_name } of tables.rows) {
      const hit = await t().deps.pool.query(`SELECT count(*) AS n FROM "${table_name}" t WHERE t::text LIKE '%${rawIp}%'`);
      expect({ table: table_name, hits: Number(hit.rows[0].n) }).toEqual({ table: table_name, hits: 0 });
    }
  });
});

describe('POST /api/v1/player/check with a cidr-list VPN provider', () => {
  const cidrFile = `${process.env.TMPDIR ?? '/tmp'}/scpsl-test-vpn-${process.pid}.txt`;
  writeFileSync(cidrFile, '# test vpn ranges\n45.132.88.0/24\n');
  const t = useTestApp({
    now: NOW,
    env: { VPN_PROVIDERS: 'cidr-list', VPN_CIDR_LIST_PATHS: cidrFile },
  });

  it('detects a listed network, feeds the alt VPN cap and records the signal', async () => {
    const identity = await createServerWithKey(t().deps);
    const body = (
      await check(t().app, identity, { player: { type: 'steam', id: randomSteamId() }, ip: '45.132.88.9' })
    ).json();
    expect(body.vpn).toEqual({ detected: true, confidence: 'likely', type: 'hosting', checked: true });
    const signals = await t().db.selectFrom('player_signals').selectAll().where('signal', '=', 'vpn_detected').execute();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.detail_codes).toEqual(['hosting']);
    expect(JSON.stringify(signals[0])).not.toContain('45.132.88.9');
  });

  it('does not check private addresses', async () => {
    const identity = await createServerWithKey(t().deps);
    const body = (await check(t().app, identity, { player: { type: 'steam', id: randomSteamId() }, ip: '10.0.0.5' })).json();
    expect(body.vpn).toEqual({ detected: false, confidence: 'not_detected', type: null, checked: false });
  });
});


