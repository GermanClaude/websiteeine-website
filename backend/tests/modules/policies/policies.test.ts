/**
 * Server policies (§4.3, §7): default materialization, versioned saves, validation,
 * history, preview, plugin GET /servers/policy and permissions.
 */
import { describe, expect, it } from 'vitest';

import type { PolicyEvaluationInput } from '@scpsl-trust/shared';

import {
  createServerWithKey,
  createUser,
  expectError,
  sessionFor,
  signedRequest,
  useTestApp,
  type TestSession,
} from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

const sampleInput: PolicyEvaluationInput = {
  global_status: 'confirmed',
  case_id: 'CASE-2026-000001',
  confirmed_servers: 3,
  open_reports: 1,
  account_age: { days: 2 },
  vpn: { confidence: 'likely' },
  alt_account: { possible: false, confidence: 'none', linked_confirmed_cases: [] },
  bypass: { types: [] },
};

const kickVpnRules = [
  {
    signal: 'vpn',
    action: 'kick',
    min_vpn_confidence: 'likely',
    message: 'No VPNs on this server.',
  },
];

function putPolicy(sid: string, session: TestSession, body: Record<string, unknown>) {
  return t().app.inject({
    method: 'PUT',
    url: `/api/v1/servers/${sid}/policy`,
    headers: session.headers,
    body: { backend_unavailable_action: 'allow', notify_on_enforcement: true, honor_global_bypasses: false, whitelist_url: null, rules: [], ...body },
  });
}

describe('GET/PUT /servers/{id}/policy', () => {
  it('materializes the default policy (v1) on first read', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const res = await t().app.inject({
      method: 'GET',
      url: `/api/v1/servers/${identity.server.server_id}/policy`,
      headers: session.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.is_active).toBe(true);
    expect(body.server_id).toBe(identity.server.server_id);
    expect(body.rules).toHaveLength(4);
    expect(body.rules.every((r: { action: string }) => r.action === 'admin_notify')).toBe(true);
    expect(body.backend_unavailable_action).toBe('allow');
  });

  it('saves a new version, deactivates the old one, audits POLICY_UPDATED', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;

    // Materialize v1 first.
    await t().app.inject({ method: 'GET', url: `/api/v1/servers/${sid}/policy`, headers: session.headers });

    const res = await putPolicy(sid, session, { rules: kickVpnRules, base_version: 1 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(2);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]).toMatchObject({ signal: 'vpn', action: 'kick', message: 'No VPNs on this server.' });
    expect(body.created_by).toMatchObject({ id: identity.owner.id });

    const versions = await t()
      .db.selectFrom('server_policies')
      .select(['version', 'is_active'])
      .where('server_id', '=', identity.server.id)
      .orderBy('version')
      .execute();
    expect(versions).toEqual([
      { version: 1, is_active: false },
      { version: 2, is_active: true },
    ]);

    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'POLICY_UPDATED')
      .executeTakeFirstOrThrow();
    expect(audit.metadata).toMatchObject({ from_version: 1, to_version: 2, rule_count: 1 });
    expect(audit.server_id).toBe(identity.server.id);
    expect(audit.actor_id).toBe(identity.owner.id);
  });

  it('rejects a stale base_version with 409 CONFLICT', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;
    await t().app.inject({ method: 'GET', url: `/api/v1/servers/${sid}/policy`, headers: session.headers });
    expect((await putPolicy(sid, session, { rules: [] })).statusCode).toBe(200); // → v2
    const stale = await putPolicy(sid, session, { rules: kickVpnRules, base_version: 1 });
    const err = expectError(stale, 409, 'CONFLICT');
    expect(err.details).toMatchObject({ active_version: 2, base_version: 1 });
  });

  it('rejects invalid rules: wrong condition fields, unknown action, too many rules, long message', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;

    // vpn rule with an account_age condition field.
    expectError(
      await putPolicy(sid, session, {
        rules: [{ signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely', max_account_age_days: 7 }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Unknown action.
    expectError(
      await putPolicy(sid, session, { rules: [{ signal: 'vpn', action: 'explode', min_vpn_confidence: 'likely' }] }),
      400,
      'VALIDATION_FAILED',
    );
    // Unknown signal.
    expectError(
      await putPolicy(sid, session, { rules: [{ signal: 'phase_of_moon', action: 'kick' }] }),
      400,
      'VALIDATION_FAILED',
    );
    // min_vpn_confidence value that would match everyone.
    expectError(
      await putPolicy(sid, session, { rules: [{ signal: 'vpn', action: 'kick', min_vpn_confidence: 'not_detected' }] }),
      400,
      'VALIDATION_FAILED',
    );
    // ban_duration_minutes on a non-ban rule.
    expectError(
      await putPolicy(sid, session, {
        rules: [{ signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely', ban_duration_minutes: 60 }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    // 51 rules.
    expectError(
      await putPolicy(sid, session, {
        rules: Array.from({ length: 51 }, () => ({ signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely' })),
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Message longer than 256 characters.
    expectError(
      await putPolicy(sid, session, {
        rules: [{ signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely', message: 'x'.repeat(257) }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    // Nothing was saved.
    const count = await t()
      .db.selectFrom('server_policies')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('server_id', '=', identity.server.id)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(0);
  });

  it('permissions: member moderator reads but cannot save; non-member forbidden; manage_any may save', async () => {
    const identity = await createServerWithKey(t().deps);
    const sid = identity.server.server_id;

    const { user: modUser } = await createUser(t().deps);
    await t()
      .db.insertInto('server_members')
      .values({ server_id: identity.server.id, user_id: modUser.id, role: 'moderator', created_by: identity.owner.id })
      .execute();
    const modSession = await sessionFor(t().deps, modUser);
    expect(
      (await t().app.inject({ method: 'GET', url: `/api/v1/servers/${sid}/policy`, headers: modSession.headers }))
        .statusCode,
    ).toBe(200);
    expectError(await putPolicy(sid, modSession, { rules: [] }), 403, 'FORBIDDEN');

    const { user: stranger } = await createUser(t().deps);
    const strangerSession = await sessionFor(t().deps, stranger);
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/servers/${sid}/policy`, headers: strangerSession.headers }),
      403,
      'FORBIDDEN',
    );

    const { user: admin } = await createUser(t().deps, { role: 'admin', totp: true });
    const adminSession = await sessionFor(t().deps, admin, { mfa_verified: true });
    expect((await putPolicy(sid, adminSession, { rules: kickVpnRules })).statusCode).toBe(200);
  });
});

describe('GET /servers/{id}/policy/history', () => {
  it('lists versions newest first with their rules', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;
    await t().app.inject({ method: 'GET', url: `/api/v1/servers/${sid}/policy`, headers: session.headers });
    expect((await putPolicy(sid, session, { rules: kickVpnRules })).statusCode).toBe(200);

    const res = await t().app.inject({
      method: 'GET',
      url: `/api/v1/servers/${sid}/policy/history`,
      headers: session.headers,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items.map((i: { version: number }) => i.version)).toEqual([2, 1]);
    expect(body.items[0].is_active).toBe(true);
    expect(body.items[0].rules).toHaveLength(1);
    expect(body.items[1].is_active).toBe(false);
    expect(body.items[1].rules).toHaveLength(4);
  });
});

describe('POST /servers/{id}/policy/preview', () => {
  it('evaluates the stored policy (no side effects) and a supplied draft', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;

    // Stored (default) policy: everything admin_notify.
    const stored = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${sid}/policy/preview`,
      headers: session.headers,
      body: { input: sampleInput },
    });
    expect(stored.statusCode).toBe(200);
    expect(stored.json().policy_version).toBe(1);
    expect(stored.json().decision.action).toBe('admin_notify');
    expect(stored.json().decision.notify_admins).toBe(true);

    // Draft: vpn kick wins.
    const draft = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${sid}/policy/preview`,
      headers: session.headers,
      body: {
        input: sampleInput,
        policy: {
          backend_unavailable_action: 'allow',
          notify_on_enforcement: true,
          honor_global_bypasses: false,
          whitelist_url: null,
          rules: [{ id: 'r1', signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely' }],
        },
      },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().policy_version).toBeNull();
    expect(draft.json().decision).toMatchObject({ action: 'kick' });
    expect(draft.json().decision.applied).toHaveLength(1);

    // Pure: no new policy rows, no audit events.
    const versions = await t()
      .db.selectFrom('server_policies')
      .select('version')
      .where('server_id', '=', identity.server.id)
      .execute();
    expect(versions).toHaveLength(1);
    const audits = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('action', '=', 'POLICY_UPDATED')
      .where('server_id', '=', identity.server.id)
      .execute();
    expect(audits).toHaveLength(0);
  });
});

describe('plugin GET /servers/policy (signed)', () => {
  it('returns the latest active policy in the plugin wire shape', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const sid = identity.server.server_id;

    const first = await signedRequest(t().app, identity, { method: 'GET', url: '/api/v1/servers/policy' });
    expect(first.statusCode).toBe(200);
    expect(first.json().version).toBe(1);
    expect(first.json().rules).toHaveLength(4);
    expect(first.json()).not.toHaveProperty('id');
    expect(first.json()).not.toHaveProperty('is_active');

    expect((await putPolicy(sid, session, { rules: kickVpnRules, whitelist_url: 'https://example.org/wl' })).statusCode).toBe(200);

    const second = await signedRequest(t().app, identity, { method: 'GET', url: '/api/v1/servers/policy' });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.version).toBe(2);
    expect(body.whitelist_url).toBe('https://example.org/wl');
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]).toMatchObject({ signal: 'vpn', action: 'kick', min_vpn_confidence: 'likely' });

    // Heartbeat reports the new version.
    const hb = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expect(hb.json().policy_version).toBe(2);
  });

  it('requires a valid signature', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/servers/policy' });
    expect(res.statusCode).toBe(401);
  });
});
