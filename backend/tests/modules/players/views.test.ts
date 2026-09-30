/**
 * Web player endpoints (§13 "Players"): GET /players search (player:view_staff)
 * and GET /players/{userId} public vs staff view. Anonymous viewers never see
 * signals/links; hashes and IPs never appear in any response.
 */
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../../src/container';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';
const HEX64 = 'f'.repeat(64);

let seedSeq = 0;

async function seedPlayerWorld(deps: Deps) {
  seedSeq += 1;
  const caseNumber = `CASE-2026-7${String(seedSeq).padStart(5, '0')}`;
  const player = await createPlayer(deps, undefined, { display_name: 'Suspicious Sam' });
  const other = await createPlayer(deps, undefined, { display_name: 'Linked Larry' });
  const srv = await createServerWithKey(deps);
  const now = deps.clock.now();

  const caseRow = await deps.db
    .insertInto('cases')
    .values({
      case_number: caseNumber,
      player_id: player.id,
      current_verdict: 'confirmed',
      status: 'closed',
      closed_at: now,
      reason: 'internal reason text',
      public_summary: 'Confirmed aimbot',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const reporter = (await createUser(deps)).user;
  await deps.db
    .insertInto('reports')
    .values({ case_id: caseRow.id, player_id: player.id, reporter_type: 'user', reporter_user_id: reporter.id, reason: 'aimbot', status: 'resolved' })
    .execute();
  await deps.db
    .insertInto('case_server_confirmations')
    .values({ case_id: caseRow.id, server_id: srv.server.id, confirmed_by_user_id: srv.owner.id })
    .execute();

  // Signals, links, sightings, bypasses (staff-only data).
  await deps.db
    .insertInto('player_signals')
    .values({
      player_id: player.id,
      server_id: srv.server.id,
      signal: 'possible_alt_account',
      confidence: 'medium',
      source: 'alt',
      detail_codes: ['same_network_identifier'],
      created_at: now,
    })
    .execute();
  await deps.db
    .insertInto('player_links')
    .values({ player_id: player.id, linked_player_id: other.id, signal: 'same_network_identifier', first_detected_at: now, last_detected_at: now, occurrences: 3 })
    .execute();
  await deps.db
    .insertInto('player_network_observations')
    .values({ player_id: player.id, network_hash: HEX64, prefix_hash: HEX64, server_id: srv.server.id, first_seen_at: now, last_seen_at: now, seen_count: 4 })
    .execute();
  await deps.db
    .insertInto('player_server_sightings')
    .values({ player_id: player.id, server_id: srv.server.id, first_seen_at: now, last_seen_at: now, join_count: 5 })
    .execute();
  const admin = (await createUser(deps, { role: 'admin' })).user;
  await deps.db
    .insertInto('bypasses')
    .values({ player_id: player.id, scope: 'server', server_id: srv.server.id, type: 'vpn_whitelist', reason: 'trusted regular', granted_by_user_id: admin.id })
    .execute();
  await deps.db
    .updateTable('players')
    .set({ account_created_at: new Date('2026-09-20T12:00:00.000Z'), account_age_source: 'steam', account_age_checked_at: now })
    .where('id', '=', player.id)
    .execute();

  return { player, other, srv, caseRow, caseNumber };
}

describe('GET /players/{userId}', () => {
  const t = useTestApp({ now: NOW });

  it('anonymous viewers get the public view without signals, links or internal data', async () => {
    const { player, caseNumber } = await seedPlayerWorld(t().deps);
    const res = await t().app.inject({ method: 'GET', url: `/api/v1/players/${player.external_id}@steam` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.view).toBe('public');
    expect(body.player).toEqual({
      user_id: `${player.external_id}@steam`,
      type: 'steam',
      id: player.external_id,
      display_name: 'Suspicious Sam',
      first_seen_at: NOW,
    });
    expect(body.global_status).toBe('confirmed');
    expect(body.case_id).toBe(caseNumber);
    expect(body.cases[0]).toMatchObject({
      case_number: caseNumber,
      verdict: 'confirmed',
      public_summary: 'Confirmed aimbot',
      report_count: 1,
      confirmed_servers: 1,
      appeal_status: null,
    });
    // Public view never carries staff data or internals.
    for (const key of ['signals', 'links', 'sightings', 'bypasses', 'recent_reports', 'linked_user']) {
      expect(body).not.toHaveProperty(key);
    }
    const raw = res.body;
    expect(raw).not.toContain('internal reason text');
    expect(raw).not.toMatch(/[0-9a-f]{64}/); // no hashes of any kind
  });

  it('a player-role viewer without a linked identity also gets the public view (no appeal status)', async () => {
    const { player } = await seedPlayerWorld(t().deps);
    const viewer = await createUser(t().deps);
    const session = await loginAs(t().app, viewer.user);
    const body = (
      await t().app.inject({ method: 'GET', url: `/api/v1/players/${player.external_id}@steam`, headers: session.headers })
    ).json();
    expect(body.view).toBe('public');
    expect(body.cases[0].appeal_status).toBeNull();
  });

  it('shows appeal status to the linked player themself', async () => {
    const { player, caseRow } = await seedPlayerWorld(t().deps);
    const owner = await createUser(t().deps, { playerId: player.id });
    await t()
      .db.insertInto('appeals')
      .values({
        case_id: caseRow.id,
        player_id: player.id,
        submitted_by_user_id: owner.user.id,
        statement: 'I did not cheat, I promise, please review.',
        status: 'open',
      })
      .execute();
    const session = await loginAs(t().app, owner.user);
    const body = (
      await t().app.inject({ method: 'GET', url: `/api/v1/players/${player.external_id}@steam`, headers: session.headers })
    ).json();
    expect(body.view).toBe('public');
    expect(body.cases[0].appeal_status).toBe('open');
  });

  it('staff (player:view_staff) get the full staff view — without hashes or IPs', async () => {
    const { player, other, srv } = await seedPlayerWorld(t().deps);
    const reviewer = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer.user);
    const res = await t().app.inject({ method: 'GET', url: `/api/v1/players/${player.external_id}@steam`, headers: session.headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.view).toBe('staff');
    expect(body.player).toMatchObject({
      account_created_at: '2026-09-20T12:00:00.000Z',
      account_age_days: 9,
      account_age_source: 'steam',
    });
    expect(body.cases[0]).toMatchObject({ reason: 'internal reason text', open_report_count: 0, evidence_count: 0 });
    expect(body.signals).toHaveLength(1);
    expect(body.signals[0]).toMatchObject({
      signal: 'possible_alt_account',
      confidence: 'medium',
      source: 'alt',
      detail_codes: ['same_network_identifier'],
      server: { server_id: srv.server.server_id, name: srv.server.name },
    });
    expect(body.links).toHaveLength(1);
    expect(body.links[0]).toMatchObject({
      linked_player: { user_id: `${other.external_id}@steam`, display_name: 'Linked Larry' },
      signal: 'same_network_identifier',
      occurrences: 3,
      linked_confirmed_cases: [],
    });
    expect(body.sightings[0]).toMatchObject({ join_count: 5, server: { server_id: srv.server.server_id } });
    expect(body.bypasses[0]).toMatchObject({ type: 'vpn_whitelist', active: true, scope: 'server' });
    expect(body.recent_reports).toHaveLength(1);
    // Never hashes, never IPs — even in the staff view.
    expect(res.body).not.toMatch(/[0-9a-f]{64}/);
    expect(res.body).not.toContain(HEX64);
  });

  it('a reviewer who still must enroll 2FA is degraded to the public view', async () => {
    const { player } = await seedPlayerWorld(t().deps);
    const reviewer = await createUser(t().deps, { role: 'reviewer' }); // no totp → enrollment required
    const session = await loginAs(t().app, reviewer.user);
    const body = (
      await t().app.inject({ method: 'GET', url: `/api/v1/players/${player.external_id}@steam`, headers: session.headers })
    ).json();
    expect(body.view).toBe('public');
  });

  it('404 for unknown players, 400 for malformed ids', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/players/76561198999999999@steam' }), 404, 'NOT_FOUND');
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/players/garbage' }), 400, 'VALIDATION_FAILED');
  });
});

describe('GET /players (search)', () => {
  const t = useTestApp({ now: NOW });

  it('requires authentication and player:view_staff', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/players?q=sam' }), 401, 'UNAUTHENTICATED');
    const player = await createUser(t().deps);
    const playerSession = await loginAs(t().app, player.user);
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/players?q=sam', headers: playerSession.headers }), 403, 'FORBIDDEN');
    const serverAdmin = await createUser(t().deps, { role: 'server_admin' });
    const saSession = await loginAs(t().app, serverAdmin.user);
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/players?q=sam', headers: saSession.headers }), 403, 'FORBIDDEN');
  });

  it('searches by display name, external id and canonical user id; filters by global_status', async () => {
    const { player } = await seedPlayerWorld(t().deps);
    await createPlayer(t().deps, undefined, { display_name: 'Innocent Ida' });
    const reviewer = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer.user);
    const get = async (qs: string) => {
      const res = await t().app.inject({ method: 'GET', url: `/api/v1/players?${qs}`, headers: session.headers });
      expect(res.statusCode).toBe(200);
      return res.json();
    };

    const byName = await get('q=suspicious');
    expect(byName.total).toBe(1);
    expect(byName.items[0]).toMatchObject({
      display_name: 'Suspicious Sam',
      global_status: 'confirmed',
      case_count: 1,
      open_case_count: 0,
    });

    const byId = await get(`q=${player.external_id}`);
    expect(byId.total).toBe(1);
    const byUserId = await get(`q=${encodeURIComponent(`${player.external_id}@steam`)}`);
    expect(byUserId.total).toBe(1);

    const confirmedOnly = await get('global_status=confirmed');
    expect(confirmedOnly.items.every((i: { global_status: string }) => i.global_status === 'confirmed')).toBe(true);
    expect(confirmedOnly.total).toBe(1);
    const noneStatus = await get('global_status=none&page_size=5');
    expect(noneStatus.items.length).toBeGreaterThan(0);
    expect(noneStatus.page_size).toBe(5);

    // ILIKE wildcards from user input are escaped.
    const wildcard = await get('q=%25');
    expect(wildcard.total).toBe(0);
  });

  it('paginates', async () => {
    for (let i = 0; i < 3; i += 1) await createPlayer(t().deps, undefined, { display_name: `Page Player ${i}` });
    const reviewer = await createUser(t().deps, { role: 'reviewer', totp: true });
    const session = await loginAs(t().app, reviewer.user);
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/players?q=page+player&page=2&page_size=2', headers: session.headers });
    const body = res.json();
    expect(body).toMatchObject({ page: 2, page_size: 2, total: 3 });
    expect(body.items).toHaveLength(1);
  });
});
