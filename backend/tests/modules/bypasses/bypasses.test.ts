/**
 * Bypasses (§4.8, §11.6): server-scoped listing/creation, revocation rules,
 * global bypasses (admin), getActiveBypasses scoping, expiry job, audit events.
 */
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../../src/container';
import type { ServerMemberRole } from '../../../src/db/enums';
import { BypassService, getActiveBypasses } from '../../../src/modules/bypasses';
import { createPlayer, createServerWithKey, createUser, expectError, loginAs, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function addMember(deps: Deps, serverUuid: string, userId: string, role: ServerMemberRole, createdBy: string) {
  await deps.db
    .insertInto('server_members')
    .values({ server_id: serverUuid, user_id: userId, role, created_by: createdBy, created_at: deps.clock.now() })
    .execute();
}

function playerRef(player: { id_type: string; external_id: string }) {
  return { type: player.id_type, id: player.external_id };
}

function createBody(player: { id_type: string; external_id: string }, overrides: Record<string, unknown> = {}) {
  return { player: playerRef(player), type: 'vpn_whitelist', reason: 'trusted community member', ...overrides };
}

describe('POST /servers/{id}/bypasses', () => {
  it('owner grants a server-scoped bypass (audited); listing shows it', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const session = await loginAs(t().app, owner);

    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server.server_id}/bypasses`,
      headers: session.headers,
      body: createBody(player, { expires_at: '2026-12-01T00:00:00.000Z' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      scope: 'server',
      type: 'vpn_whitelist',
      active: true,
      server: { server_id: server.server_id },
      granted_by: { id: owner.id },
      expires_at: '2026-12-01T00:00:00.000Z',
    });

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'server_id'])
      .where('target_id', '=', body.id)
      .execute();
    expect(audit).toEqual([{ action: 'BYPASS_CREATED', server_id: server.id }]);

    const list = await t().app.inject({
      method: 'GET',
      url: `/api/v1/servers/${server.server_id}/bypasses?active=true`,
      headers: session.headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((b: { id: string }) => b.id)).toContain(body.id);
  });

  it('moderator members cannot grant; admins (server:manage_any) can; strangers cannot even list', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);

    const { user: memberMod } = await createUser(t().deps);
    await addMember(t().deps, server.id, memberMod.id, 'moderator', owner.id);
    const modSession = await loginAs(t().app, memberMod);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/servers/${server.server_id}/bypasses`,
        headers: modSession.headers,
        body: createBody(player),
      }),
      403,
      'FORBIDDEN',
    );
    // but a moderator member may list
    expect(
      (
        await t().app.inject({
          method: 'GET',
          url: `/api/v1/servers/${server.server_id}/bypasses`,
          headers: modSession.headers,
        })
      ).statusCode,
    ).toBe(200);

    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const adminSession = await loginAs(t().app, admin);
    expect(
      (
        await t().app.inject({
          method: 'POST',
          url: `/api/v1/servers/${server.server_id}/bypasses`,
          headers: adminSession.headers,
          body: createBody(player),
        })
      ).statusCode,
    ).toBe(201);

    const { user: stranger } = await createUser(t().deps);
    const strangerSession = await loginAs(t().app, stranger);
    expectError(
      await t().app.inject({
        method: 'GET',
        url: `/api/v1/servers/${server.server_id}/bypasses`,
        headers: strangerSession.headers,
      }),
      403,
      'FORBIDDEN',
    );
  });

  it('rejects an expires_at in the past', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const session = await loginAs(t().app, owner);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server.server_id}/bypasses`,
      headers: session.headers,
      body: createBody(player, { expires_at: '2020-01-01T00:00:00.000Z' }),
    });
    expectError(res, 400, 'VALIDATION_FAILED');
  });
});

describe('POST /bypasses/{id}/revoke', () => {
  async function grantServerBypass() {
    const { server, owner } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const session = await loginAs(t().app, owner);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server.server_id}/bypasses`,
      headers: session.headers,
      body: createBody(player),
    });
    return { server, owner, player, id: res.json().id as string, ownerSession: session };
  }

  it('owner revokes a server bypass (audited); double revoke is rejected', async () => {
    const { id, ownerSession, server } = await grantServerBypass();
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/bypasses/${id}/revoke`,
      headers: ownerSession.headers,
      body: { reason: 'no longer needed' },
    });
    expect(res.statusCode).toBe(200);

    const row = await t().db.selectFrom('bypasses').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.revoked_at).not.toBeNull();
    expect(row.revoke_reason).toBe('no longer needed');

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('target_id', '=', id).execute()
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['BYPASS_CREATED', 'BYPASS_REVOKED']));
    void server;

    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/bypasses/${id}/revoke`,
        headers: ownerSession.headers,
        body: { reason: 'again' },
      }),
      409,
      'INVALID_STATE',
    );
  });

  it('moderator members and strangers cannot revoke a server bypass', async () => {
    const { id, server, owner } = await grantServerBypass();
    const { user: memberMod } = await createUser(t().deps);
    await addMember(t().deps, server.id, memberMod.id, 'moderator', owner.id);
    for (const user of [memberMod, (await createUser(t().deps)).user]) {
      const session = await loginAs(t().app, user);
      expectError(
        await t().app.inject({
          method: 'POST',
          url: `/api/v1/bypasses/${id}/revoke`,
          headers: session.headers,
          body: { reason: 'should not work' },
        }),
        403,
        'FORBIDDEN',
      );
    }
  });

  it('global bypasses can only be revoked with bypass:manage_global', async () => {
    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const player = await createPlayer(t().deps);
    const adminSession = await loginAs(t().app, admin);
    const created = await t().app.inject({
      method: 'POST',
      url: '/api/v1/admin/bypasses',
      headers: adminSession.headers,
      body: createBody(player),
    });
    const id = created.json().id as string;

    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const modSession = await loginAs(t().app, moderator);
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/bypasses/${id}/revoke`,
        headers: modSession.headers,
        body: { reason: 'not allowed' },
      }),
      403,
      'FORBIDDEN',
    );

    expect(
      (
        await t().app.inject({
          method: 'POST',
          url: `/api/v1/bypasses/${id}/revoke`,
          headers: adminSession.headers,
          body: { reason: 'cleanup' },
        })
      ).statusCode,
    ).toBe(200);
  });
});

describe('GET/POST /admin/bypasses', () => {
  it('requires bypass:manage_global; creates global bypasses (audited, scope global)', async () => {
    const player = await createPlayer(t().deps);
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const reviewerSession = await loginAs(t().app, reviewer);
    expectError(
      await t().app.inject({ method: 'GET', url: '/api/v1/admin/bypasses', headers: reviewerSession.headers }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await t().app.inject({
        method: 'POST',
        url: '/api/v1/admin/bypasses',
        headers: reviewerSession.headers,
        body: createBody(player),
      }),
      403,
      'FORBIDDEN',
    );

    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const adminSession = await loginAs(t().app, admin);
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/admin/bypasses',
      headers: adminSession.headers,
      body: createBody(player, { type: 'verdict_override' }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scope: 'global', server: null, type: 'verdict_override', active: true });

    const list = await t().app.inject({ method: 'GET', url: '/api/v1/admin/bypasses', headers: adminSession.headers });
    expect(list.json().items.map((b: { id: string }) => b.id)).toContain(res.json().id);
  });
});

describe('getActiveBypasses', () => {
  it('scopes to the server and honors global only when asked; expired/revoked are excluded', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const { server: otherServer } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const now = t().clock.now();

    const insert = (values: Record<string, unknown>) =>
      t()
        .db.insertInto('bypasses')
        .values({
          player_id: player.id,
          scope: 'server',
          server_id: server.id,
          type: 'vpn_whitelist',
          reason: 'test',
          granted_by_user_id: owner.id,
          created_at: now,
          ...values,
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow();

    const active = await insert({});
    await insert({ type: 'account_age_whitelist', expires_at: new Date(now.getTime() - 1000) }); // expired
    await insert({ type: 'alt_account_whitelist', revoked_at: now, revoked_by: owner.id, revoke_reason: 'x' }); // revoked
    const global = await insert({ scope: 'global', server_id: null, type: 'verdict_override' });

    const forServer = await getActiveBypasses(t().db, player.id, server.id, { honorGlobal: false, now });
    expect(forServer.map((b) => b.id)).toEqual([active.id]);

    const withGlobal = await getActiveBypasses(t().db, player.id, server.id, { honorGlobal: true, now });
    expect(withGlobal.map((b) => b.id).sort()).toEqual([active.id, global.id].sort());

    const otherServerView = await getActiveBypasses(t().db, player.id, otherServer.id, { honorGlobal: false, now });
    expect(otherServerView).toEqual([]);
  });
});

describe('bypass expiry job', () => {
  it('marks expired bypasses processed, audits BYPASS_EXPIRED and expires approved requests', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    const { user: requester } = await createUser(t().deps, { playerId: player.id });
    const session = await loginAs(t().app, requester);
    const request = await t().app.inject({
      method: 'POST',
      url: '/api/v1/whitelist-requests',
      headers: session.headers,
      body: { server_id: server.server_id, type: 'vpn_whitelist', reason: 'temporary VPN usage', requested_days: 1 },
    });
    const requestId = request.json().id as string;
    const ownerSession = await loginAs(t().app, owner);
    const approved = await t().app.inject({
      method: 'POST',
      url: `/api/v1/whitelist-requests/${requestId}/decision`,
      headers: ownerSession.headers,
      body: { decision: 'approve', note: null },
    });
    const bypassId = approved.json().bypass_id as string;

    const service = new BypassService(t().deps);
    await service.processExpiredBypasses(); // clears rows other tests left expired
    const before = await t().db.selectFrom('bypasses').selectAll().where('id', '=', bypassId).executeTakeFirstOrThrow();
    expect(before.expired_processed_at).toBeNull();

    t().clock.advance(2 * 24 * 60 * 60 * 1000);
    const run = await service.processExpiredBypasses();
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect(run.requests_expired).toBeGreaterThanOrEqual(1);
    // idempotent
    expect(await service.processExpiredBypasses()).toEqual({ expired: 0, requests_expired: 0 });

    const bypass = await t().db.selectFrom('bypasses').selectAll().where('id', '=', bypassId).executeTakeFirstOrThrow();
    expect(bypass.expired_processed_at).not.toBeNull();
    expect(bypass.revoked_at).toBeNull();

    const requestRow = await t()
      .db.selectFrom('whitelist_requests')
      .selectAll()
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    expect(requestRow.status).toBe('expired');

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'actor_type'])
      .where('target_id', '=', bypassId)
      .where('action', '=', 'BYPASS_EXPIRED')
      .execute();
    expect(audit).toEqual([{ action: 'BYPASS_EXPIRED', actor_type: 'system' }]);
  });
});
