/**
 * Whitelist requests (§11.6): full flow request → approve → server-scoped bypass
 * (verified via the signed /player/bypass/check), reject, revoke, expiry job,
 * self-decision and scope rules, audit events.
 */
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../../src/container';
import type { ServerMemberRole } from '../../../src/db/enums';
import type { PlayerRow } from '../../../src/db/types';
import {
  createPlayer,
  createServerWithKey,
  createUser,
  expectError,
  loginAs,
  signedRequest,
  useTestApp,
} from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function addMember(deps: Deps, serverUuid: string, userId: string, role: ServerMemberRole, createdBy: string) {
  await deps.db
    .insertInto('server_members')
    .values({ server_id: serverUuid, user_id: userId, role, created_by: createdBy, created_at: deps.clock.now() })
    .execute();
}

async function requesterFor(deps: Deps, player?: PlayerRow) {
  const p = player ?? (await createPlayer(deps));
  const { user } = await createUser(deps, { playerId: p.id });
  return { player: p, user };
}

function createRequest(
  headers: Record<string, string>,
  serverId: string,
  overrides: Record<string, unknown> = {},
) {
  return t().app.inject({
    method: 'POST',
    url: '/api/v1/whitelist-requests',
    headers,
    body: {
      server_id: serverId,
      type: 'vpn_whitelist',
      reason: 'I use a VPN for privacy at university',
      requested_days: 30,
      ...overrides,
    },
  });
}

function decide(headers: Record<string, string>, id: string, body: Record<string, unknown>) {
  return t().app.inject({ method: 'POST', url: `/api/v1/whitelist-requests/${id}/decision`, headers, body });
}

describe('POST /whitelist-requests', () => {
  it('creates a pending request with TTL expiry and audits BYPASS_REQUESTED', async () => {
    const { server } = await createServerWithKey(t().deps);
    const { user } = await requesterFor(t().deps);
    const session = await loginAs(t().app, user);
    const res = await createRequest(session.headers, server.server_id);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ status: 'pending', type: 'vpn_whitelist', requested_days: 30 });
    // WHITELIST_REQUEST_TTL_DAYS default 14
    expect(body.expires_at).toBe('2026-10-13T12:00:00.000Z');

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'server_id'])
      .where('target_id', '=', body.id)
      .execute();
    expect(audit).toEqual([{ action: 'BYPASS_REQUESTED', server_id: server.id }]);
  });

  it('requires a linked player', async () => {
    const { server } = await createServerWithKey(t().deps);
    const { user } = await createUser(t().deps);
    const session = await loginAs(t().app, user);
    expectError(await createRequest(session.headers, server.server_id), 403, 'PLAYER_NOT_LINKED');
  });

  it('rejects inactive servers and servers not accepting requests', async () => {
    const { user } = await requesterFor(t().deps);
    const session = await loginAs(t().app, user);

    const { server: suspended } = await createServerWithKey(t().deps, { status: 'suspended' });
    expectError(await createRequest(session.headers, suspended.server_id), 409, 'SERVER_NOT_ACTIVE');

    const { server: closed } = await createServerWithKey(t().deps, { acceptsWhitelistRequests: false });
    expectError(await createRequest(session.headers, closed.server_id), 403, 'WHITELIST_REQUESTS_DISABLED');
  });

  it('allows only one pending request per (player, server, type)', async () => {
    const { server } = await createServerWithKey(t().deps);
    const { user } = await requesterFor(t().deps);
    const session = await loginAs(t().app, user);
    expect((await createRequest(session.headers, server.server_id)).statusCode).toBe(201);
    expectError(await createRequest(session.headers, server.server_id), 409, 'ALREADY_EXISTS');
    // another type is fine
    const other = await createRequest(session.headers, server.server_id, { type: 'account_age_whitelist' });
    expect(other.statusCode).toBe(201);
  });
});

describe('GET /whitelist-requests (scope)', () => {
  it('requester sees own; members see their servers; decide_any sees all; strangers see nothing', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id)).json().id as string;

    const list = async (u: { id: string } & Parameters<typeof loginAs>[1], query = '') => {
      const s = await loginAs(t().app, u as never);
      const res = await t().app.inject({ method: 'GET', url: `/api/v1/whitelist-requests${query}`, headers: s.headers });
      expect(res.statusCode).toBe(200);
      return res.json().items.map((r: { id: string }) => r.id);
    };

    expect(await list(requester as never)).toContain(id);
    expect(await list(owner as never)).toContain(id);

    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    expect(await list(moderator as never)).toContain(id);

    const { user: stranger } = await createUser(t().deps);
    expect(await list(stranger as never)).toEqual([]);

    // server member with moderator member role
    const { user: memberMod } = await createUser(t().deps);
    await addMember(t().deps, server.id, memberMod.id, 'moderator', owner.id);
    expect(await list(memberMod as never)).toContain(id);

    // mine=true restricts a decider to their own submissions
    expect(await list(moderator as never, '?mine=true')).toEqual([]);

    // detail: stranger is refused
    const strangerSession = await loginAs(t().app, stranger);
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/whitelist-requests/${id}`, headers: strangerSession.headers }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('POST /whitelist-requests/{id}/decision', () => {
  it('owner approves → server-scoped bypass, visible on THAT server only via /player/bypass/check', async () => {
    const identity = await createServerWithKey(t().deps);
    const otherIdentity = await createServerWithKey(t().deps);
    const { player, user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, identity.server.server_id)).json().id as string;

    const ownerSession = await loginAs(t().app, identity.owner);
    const res = await decide(ownerSession.headers, id, { decision: 'approve', note: 'ok, verified' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: 'approved', decision_note: 'ok, verified' });
    expect(body.bypass_id).not.toBeNull();
    // days defaulted to requested_days = 30
    expect(body.bypass_expires_at).toBe('2026-10-29T12:00:00.000Z');

    const bypass = await t().db.selectFrom('bypasses').selectAll().where('id', '=', body.bypass_id).executeTakeFirstOrThrow();
    expect(bypass).toMatchObject({
      scope: 'server',
      server_id: identity.server.id,
      type: 'vpn_whitelist',
      whitelist_request_id: id,
      granted_by_user_id: identity.owner.id,
    });

    const playerRef = { type: player.id_type, id: player.external_id };
    const onServer = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/player/bypass/check',
      body: { server_id: identity.server.server_id, player: playerRef },
    });
    expect(onServer.statusCode).toBe(200);
    expect(onServer.json().bypass).toBe(true);
    expect(onServer.json().bypasses.map((b: { id: string }) => b.id)).toContain(body.bypass_id);

    const onOtherServer = await signedRequest(t().app, otherIdentity, {
      method: 'POST',
      url: '/api/v1/player/bypass/check',
      body: { server_id: otherIdentity.server.server_id, player: playerRef },
    });
    expect(onOtherServer.statusCode).toBe(200);
    expect(onOtherServer.json().bypass).toBe(false);

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('target_id', '=', id).execute()
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['BYPASS_REQUESTED', 'BYPASS_APPROVED']));
  });

  it('reject marks the request rejected (audited) and creates no bypass', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id)).json().id as string;

    const ownerSession = await loginAs(t().app, owner);
    const res = await decide(ownerSession.headers, id, { decision: 'reject', note: 'not enough detail' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'rejected', bypass_id: null });
    expect(
      await t().db.selectFrom('bypasses').selectAll().where('whitelist_request_id', '=', id).execute(),
    ).toHaveLength(0);
    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('target_id', '=', id).execute()
    ).map((a) => a.action);
    expect(actions).toContain('BYPASS_REJECTED');

    // no double decision
    expectError(await decide(ownerSession.headers, id, { decision: 'approve', note: null }), 409, 'INVALID_STATE');
  });

  it('a requester can never decide their own request, even as server owner', async () => {
    const identity = await createServerWithKey(t().deps);
    const player = await createPlayer(t().deps);
    await t().db.updateTable('users').set({ player_id: player.id }).where('id', '=', identity.owner.id).execute();
    const ownerSession = await loginAs(t().app, identity.owner);
    const id = (await createRequest(ownerSession.headers, identity.server.server_id)).json().id as string;
    expectError(await decide(ownerSession.headers, id, { decision: 'approve', note: null }), 403, 'FORBIDDEN');
  });

  it('non-member server_admins cannot decide; whitelist:decide_any can', async () => {
    const { server } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id)).json().id as string;

    const { user: unrelatedServerAdmin } = await createUser(t().deps, { role: 'server_admin' });
    const saSession = await loginAs(t().app, unrelatedServerAdmin);
    expectError(await decide(saSession.headers, id, { decision: 'approve', note: null }), 403, 'FORBIDDEN');

    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const modSession = await loginAs(t().app, moderator);
    const res = await decide(modSession.headers, id, { decision: 'approve', note: null, days: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');
  });

  it('permanent approval (days null) is allowed for owner/admin members but not moderator members', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id, { requested_days: null })).json().id as string;

    const { user: memberMod } = await createUser(t().deps);
    await addMember(t().deps, server.id, memberMod.id, 'moderator', owner.id);
    const modSession = await loginAs(t().app, memberMod);
    expectError(await decide(modSession.headers, id, { decision: 'approve', note: null }), 403, 'FORBIDDEN');

    const ownerSession = await loginAs(t().app, owner);
    const res = await decide(ownerSession.headers, id, { decision: 'approve', note: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().bypass_expires_at).toBeNull();
  });
});

describe('POST /whitelist-requests/{id}/revoke', () => {
  it('revokes the approved request and its bypass (audited); pending cannot be revoked', async () => {
    const identity = await createServerWithKey(t().deps);
    const { player, user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const pendingId = (await createRequest(session.headers, identity.server.server_id)).json().id as string;
    const ownerSession = await loginAs(t().app, identity.owner);

    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/whitelist-requests/${pendingId}/revoke`,
        headers: ownerSession.headers,
        body: { reason: 'not yet approved' },
      }),
      409,
      'INVALID_STATE',
    );

    const approved = (await decide(ownerSession.headers, pendingId, { decision: 'approve', note: null })).json();
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/whitelist-requests/${pendingId}/revoke`,
      headers: ownerSession.headers,
      body: { reason: 'abuse detected' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('revoked');

    const bypass = await t().db.selectFrom('bypasses').selectAll().where('id', '=', approved.bypass_id).executeTakeFirstOrThrow();
    expect(bypass.revoked_at).not.toBeNull();
    expect(bypass.revoked_by).toBe(identity.owner.id);
    expect(bypass.revoke_reason).toBe('abuse detected');

    const check = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/player/bypass/check',
      body: { server_id: identity.server.server_id, player: { type: player.id_type, id: player.external_id } },
    });
    expect(check.json().bypass).toBe(false);

    const actions = (
      await t().db.selectFrom('audit_events').select('action').where('target_id', '=', pendingId).execute()
    ).map((a) => a.action);
    expect(actions).toContain('BYPASS_REVOKED');
  });

  it('requesters cannot revoke', async () => {
    const { server, owner } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id)).json().id as string;
    const ownerSession = await loginAs(t().app, owner);
    await decide(ownerSession.headers, id, { decision: 'approve', note: null });
    expectError(
      await t().app.inject({
        method: 'POST',
        url: `/api/v1/whitelist-requests/${id}/revoke`,
        headers: session.headers,
        body: { reason: 'my own request' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

describe('whitelist expiry job', () => {
  it('expires pending requests past expires_at (idempotent, audited)', async () => {
    const { WhitelistService } = await import('../../../src/modules/whitelist');
    const { server } = await createServerWithKey(t().deps);
    const { user: requester } = await requesterFor(t().deps);
    const session = await loginAs(t().app, requester);
    const id = (await createRequest(session.headers, server.server_id)).json().id as string;

    const service = new WhitelistService(t().deps);
    expect(await service.processExpiredPending()).toEqual({ expired: 0 });

    t().clock.advance(15 * 24 * 60 * 60 * 1000); // past the 14-day TTL
    const first = await service.processExpiredPending();
    expect(first.expired).toBeGreaterThanOrEqual(1); // other tests' pending requests may expire too
    // idempotent
    expect(await service.processExpiredPending()).toEqual({ expired: 0 });

    const row = await t().db.selectFrom('whitelist_requests').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    expect(row.status).toBe('expired');

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'actor_type'])
      .where('target_id', '=', id)
      .where('action', '=', 'WHITELIST_REQUEST_EXPIRED')
      .execute();
    expect(audit).toEqual([{ action: 'WHITELIST_REQUEST_EXPIRED', actor_type: 'system' }]);

    // an expired request can no longer be decided
    const { user: moderator } = await createUser(t().deps, { role: 'moderator', totp: true });
    const modSession = await loginAs(t().app, moderator);
    expectError(await decide(modSession.headers, id, { decision: 'approve', note: null }), 409, 'INVALID_STATE');
  });
});
