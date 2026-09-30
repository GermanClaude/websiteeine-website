/**
 * Web server management (§13 "Servers"): list/create/detail/update, registration
 * tokens, keys, members, admin status/trust, permission matrix and the key-retire job.
 */
import { describe, expect, it } from 'vitest';

import type { ServerMemberRole, UserRole } from '@scpsl-trust/shared';

import { registerJobs } from '../../../src/modules/servers';
import {
  addServerKey,
  createServerWithKey,
  createUser,
  expectError,
  sessionFor,
  useTestApp,
  type TestSession,
} from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

async function userWithSession(role: UserRole = 'player', totp = false) {
  const { user } = await createUser(t().deps, { role, ...(totp ? { totp: true } : {}) });
  const session = await sessionFor(t().deps, user, totp ? { mfa_verified: true } : {});
  return { user, session };
}

async function addMemberRow(serverUuid: string, userId: string, role: ServerMemberRole, createdBy: string) {
  await t()
    .db.insertInto('server_members')
    .values({ server_id: serverUuid, user_id: userId, role, created_by: createdBy })
    .execute();
}

function get(url: string, session: TestSession) {
  return t().app.inject({ method: 'GET', url: `/api/v1${url}`, headers: session.headers });
}
function post(url: string, session: TestSession, body?: unknown) {
  return t().app.inject({ method: 'POST', url: `/api/v1${url}`, headers: session.headers, body: body as object });
}

describe('GET/POST /servers', () => {
  it('requires authentication', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/servers' }), 401, 'UNAUTHENTICATED');
  });

  it('players cannot create servers; server_admin can; token shown exactly once', async () => {
    const player = await userWithSession('player');
    expectError(await post('/servers', player.session, { name: 'Nope' }), 403, 'FORBIDDEN');

    const creator = await userWithSession('server_admin');
    const res = await post('/servers', creator.session, { name: 'My SCP Server', description: 'EU west' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.registration_token).toMatch(/^sreg_/);
    expect(body.server.status).toBe('pending');
    expect(body.server.member_role).toBe('owner');
    expect(body.server.owner.id).toBe(creator.user.id);

    // Detail view never exposes the token; DB stores only the hash.
    const detail = await get(`/servers/${body.server.server_id}`, creator.session);
    expect(detail.statusCode).toBe(200);
    expect(JSON.stringify(detail.json())).not.toContain(body.registration_token);
    const tokenRow = await t().db.selectFrom('server_registration_tokens').selectAll().executeTakeFirstOrThrow();
    expect(tokenRow.token_hash).not.toBe(body.registration_token);
    expect(tokenRow.token_hash).toMatch(/^[0-9a-f]{64}$/);

    // Audits.
    const actions = await t().db.selectFrom('audit_events').select('action').orderBy('seq').execute();
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['SERVER_CREATED', 'SERVER_REGISTRATION_TOKEN_CREATED']),
    );
  });

  it('lists own memberships only; server:manage_any sees all; filters work', async () => {
    const a = await createServerWithKey(t().deps, { name: 'Alpha Server' });
    const b = await createServerWithKey(t().deps, { name: 'Beta Server' });
    const ownerSession = await sessionFor(t().deps, a.owner);

    const mine = await get('/servers', ownerSession);
    expect(mine.statusCode).toBe(200);
    const mineBody = mine.json();
    expect(mineBody.items).toHaveLength(1);
    expect(mineBody.items[0]).toMatchObject({
      server_id: a.server.server_id,
      member_role: 'owner',
      key_fingerprint: a.fingerprint,
      status: 'active',
    });

    const admin = await userWithSession('admin', true);
    const all = await get('/servers?page_size=100', admin.session);
    expect(all.json().total).toBeGreaterThanOrEqual(2);
    const names = all.json().items.map((i: { name: string }) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Alpha Server', 'Beta Server']));
    expect(all.json().items.every((i: { member_role: null }) => i.member_role === null)).toBe(true);

    const filtered = await get('/servers?q=beta', admin.session);
    expect(filtered.json().items).toHaveLength(1);
    expect(filtered.json().items[0].server_id).toBe(b.server.server_id);

    const byStatus = await get('/servers?status=suspended', admin.session);
    expect(byStatus.json().items).toHaveLength(0);
  });
});

describe('permission matrix on /servers/{id}', () => {
  it('enforces membership and override rules', async () => {
    const identity = await createServerWithKey(t().deps);
    const sid = identity.server.server_id;

    // Unrelated player: 403 on view.
    const stranger = await userWithSession('player');
    expectError(await get(`/servers/${sid}`, stranger.session), 403, 'FORBIDDEN');

    // Non-member server_admin (global role) has no access either.
    const otherServerAdmin = await userWithSession('server_admin');
    expectError(await get(`/servers/${sid}`, otherServerAdmin.session), 403, 'FORBIDDEN');

    // Member moderator (global role player): may view, may not manage.
    const mod = await userWithSession('player');
    await addMemberRow(identity.server.id, mod.user.id, 'moderator', identity.owner.id);
    expect((await get(`/servers/${sid}`, mod.session)).statusCode).toBe(200);
    expectError(
      await t().app.inject({
        method: 'PATCH',
        url: `/api/v1/servers/${sid}`,
        headers: mod.session.headers,
        body: { name: 'Renamed' },
      }),
      403,
      'FORBIDDEN',
    );

    // Owner may manage.
    const ownerSession = await sessionFor(t().deps, identity.owner);
    const patch = await t().app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${sid}`,
      headers: ownerSession.headers,
      body: { name: 'Renamed Server', description: '' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().name).toBe('Renamed Server');
    expect(patch.json().description).toBeNull(); // '' clears

    // Global admin (server:manage_any) may manage without membership.
    const admin = await userWithSession('admin', true);
    const adminPatch = await t().app.inject({
      method: 'PATCH',
      url: `/api/v1/servers/${sid}`,
      headers: admin.session.headers,
      body: { accepts_whitelist_requests: false },
    });
    expect(adminPatch.statusCode).toBe(200);
    expect(adminPatch.json().accepts_whitelist_requests).toBe(false);

    const audit = await t().db.selectFrom('audit_events').select('action').where('action', '=', 'SERVER_UPDATED').execute();
    expect(audit).toHaveLength(2);

    // Unknown server id → 404.
    expectError(await get('/servers/srv_zzzzzzzzzzzzzzzz', admin.session), 404, 'NOT_FOUND');
  });
});

describe('keys endpoints', () => {
  it('lists keys with statuses and never leaks secrets; revoke validates state', async () => {
    const identity = await createServerWithKey(t().deps);
    const retiring = await addServerKey(t().deps, identity.server, {
      status: 'retiring',
      retiringUntil: new Date(t().clock.now().getTime() + 600_000),
    });
    const ownerSession = await sessionFor(t().deps, identity.owner);
    const res = await get(`/servers/${identity.server.server_id}/keys`, ownerSession);
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items.map((k) => k.status).sort()).toEqual(['active', 'retiring']);

    // Revoke the retiring key.
    const keyId = items.find((k) => k.status === 'retiring')!.id as string;
    expect(keyId).toBeDefined();
    const revoke = await post(`/servers/${identity.server.server_id}/keys/${keyId}/revoke`, ownerSession, {
      reason: 'no longer needed',
    });
    expect(revoke.statusCode).toBe(200);
    // Double revoke → 409.
    expectError(
      await post(`/servers/${identity.server.server_id}/keys/${keyId}/revoke`, ownerSession, { reason: 'again' }),
      409,
      'INVALID_STATE',
    );
    // A key of another server → 404.
    const other = await createServerWithKey(t().deps);
    const otherKey = await t()
      .db.selectFrom('server_keys')
      .select('id')
      .where('server_id', '=', other.server.id)
      .executeTakeFirstOrThrow();
    expectError(
      await post(`/servers/${identity.server.server_id}/keys/${otherKey.id}/revoke`, ownerSession, { reason: 'nope' }),
      404,
      'NOT_FOUND',
    );
    void retiring;
  });
});

describe('members endpoints', () => {
  it('add/list/remove members with audit; owner protected; duplicates rejected', async () => {
    const identity = await createServerWithKey(t().deps);
    const sid = identity.server.server_id;
    const ownerSession = await sessionFor(t().deps, identity.owner);
    const { user: newMod } = await createUser(t().deps, { username: 'TeamModerator' });

    // Add by username (case-insensitive).
    const add = await post(`/servers/${sid}/members`, ownerSession, { username: 'teammoderator', role: 'moderator' });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toMatchObject({
      user: { id: newMod.id, username: 'TeamModerator' },
      role: 'moderator',
      created_by: { id: identity.owner.id },
    });

    // Unknown user → 404; duplicate → 409.
    expectError(await post(`/servers/${sid}/members`, ownerSession, { username: 'ghost', role: 'admin' }), 404, 'NOT_FOUND');
    expectError(
      await post(`/servers/${sid}/members`, ownerSession, { username: 'TeamModerator', role: 'admin' }),
      409,
      'ALREADY_EXISTS',
    );
    // Role owner is not assignable (schema).
    expectError(
      await post(`/servers/${sid}/members`, ownerSession, { username: 'TeamModerator', role: 'owner' }),
      400,
      'VALIDATION_FAILED',
    );

    const list = await get(`/servers/${sid}/members`, ownerSession);
    expect(list.json().items).toHaveLength(2);

    // The moderator member cannot manage members.
    const modSession = await sessionFor(t().deps, newMod);
    expectError(
      await post(`/servers/${sid}/members`, modSession, { username: 'TeamModerator', role: 'admin' }),
      403,
      'FORBIDDEN',
    );

    // Owner cannot be removed.
    expectError(
      await t().app.inject({
        method: 'DELETE',
        url: `/api/v1/servers/${sid}/members/${identity.owner.id}`,
        headers: ownerSession.headers,
      }),
      409,
      'INVALID_STATE',
    );

    // Remove the moderator.
    const del = await t().app.inject({
      method: 'DELETE',
      url: `/api/v1/servers/${sid}/members/${newMod.id}`,
      headers: ownerSession.headers,
    });
    expect(del.statusCode).toBe(200);
    expect((await get(`/servers/${sid}/members`, ownerSession)).json().items).toHaveLength(1);

    const actions = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('action', 'in', ['SERVER_MEMBER_ADDED', 'SERVER_MEMBER_REMOVED'])
      .orderBy('seq')
      .execute();
    expect(actions.map((a) => a.action)).toEqual(['SERVER_MEMBER_ADDED', 'SERVER_MEMBER_REMOVED']);
  });
});

describe('admin status/trust endpoints', () => {
  it('status change needs server:manage_any; revoked also revokes keys', async () => {
    const identity = await createServerWithKey(t().deps);
    const sid = identity.server.server_id;

    // The owner does NOT have the global permission.
    const ownerSession = await sessionFor(t().deps, identity.owner);
    expectError(
      await post(`/servers/${sid}/status`, ownerSession, { status: 'suspended', reason: 'because I can' }),
      403,
      'FORBIDDEN',
    );

    const admin = await userWithSession('admin', true);
    const suspend = await post(`/servers/${sid}/status`, admin.session, { status: 'suspended', reason: 'ToS violation' });
    expect(suspend.statusCode).toBe(200);
    expect(suspend.json().status).toBe('suspended');
    // Same status again → 409.
    expectError(
      await post(`/servers/${sid}/status`, admin.session, { status: 'suspended', reason: 'again' }),
      409,
      'CONFLICT',
    );

    const revoke = await post(`/servers/${sid}/status`, admin.session, { status: 'revoked', reason: 'permanent removal' });
    expect(revoke.statusCode).toBe(200);
    const keys = await t()
      .db.selectFrom('server_keys')
      .select('status')
      .where('server_id', '=', identity.server.id)
      .execute();
    expect(keys.every((k) => k.status === 'revoked')).toBe(true);

    const audits = await t()
      .db.selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('action', '=', 'SERVER_STATUS_CHANGED')
      .orderBy('seq')
      .execute();
    expect(audits).toHaveLength(2);
    expect(audits[1]!.metadata).toMatchObject({ from: 'suspended', to: 'revoked', revoked_keys: 1 });
  });

  it('trust flag needs server:trust and is audited', async () => {
    const identity = await createServerWithKey(t().deps);
    const sid = identity.server.server_id;
    const moderator = await userWithSession('moderator', true);
    expectError(await post(`/servers/${sid}/trust`, moderator.session, { is_trusted: true }), 403, 'FORBIDDEN');

    const admin = await userWithSession('admin', true);
    const res = await post(`/servers/${sid}/trust`, admin.session, { is_trusted: true, reason: 'well established' });
    expect(res.statusCode).toBe(200);
    expect(res.json().is_trusted).toBe(true);
    const audit = await t()
      .db.selectFrom('audit_events')
      .select('metadata')
      .where('action', '=', 'SERVER_TRUST_CHANGED')
      .executeTakeFirstOrThrow();
    expect(audit.metadata).toMatchObject({ from: false, to: true });
  });
});

describe('server-keys-retire job', () => {
  it('moves expired retiring keys to retired', async () => {
    const identity = await createServerWithKey(t().deps);
    await addServerKey(t().deps, identity.server, {
      status: 'retiring',
      retiringUntil: new Date(t().clock.now().getTime() + 60_000),
    });
    t().clock.advanceSeconds(120);
    registerJobs(t().deps.scheduler, t().deps);
    const result = await t().deps.scheduler.runNow('server-keys-retire');
    expect(result.result).toBe('succeeded');
    expect(result.details).toMatchObject({ retired: 1 });
    const statuses = await t()
      .db.selectFrom('server_keys')
      .select(['status', 'retired_at'])
      .where('server_id', '=', identity.server.id)
      .orderBy('status')
      .execute();
    expect(statuses.map((s) => s.status).sort()).toEqual(['active', 'retired']);
    expect(statuses.find((s) => s.status === 'retired')!.retired_at).not.toBeNull();
  });
});
