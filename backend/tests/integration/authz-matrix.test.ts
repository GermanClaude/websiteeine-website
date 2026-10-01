/**
 * Authorization matrix (integration), iterating over ALL registered web routes:
 *
 *  1. Completeness: every registered route has a matrix entry (adding an endpoint
 *     without extending this matrix fails the suite).
 *  2. Unauthenticated requests → 401 UNAUTHENTICATED, except the explicitly public
 *     endpoints (which must never answer UNAUTHENTICATED).
 *  3. Signed plugin routes without a signature → 401.
 *  4. Unsafe methods with a session cookie but no X-CSRF-Token → 403 CSRF_TOKEN_INVALID
 *     (CSRF runs in preValidation, before body validation — no body needed).
 *  5. Per role (player, server_admin, reviewer+2FA, moderator+2FA, admin+2FA,
 *     super_admin+2FA) a representative forbidden call per permission → 403.
 *  6. MFA gates: staff role without 2FA enrollment → 403 MFA_ENROLLMENT_REQUIRED;
 *     verdict without an MFA-verified session → 403.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { CSRF_HEADER_LOWER } from '@scpsl-trust/shared';

import { buildTestApp, createServerWithKey, createUser, sessionFor, type TestApp, type TestSession } from '../helpers';

interface CollectedRoute {
  method: string;
  url: string;
}

interface RouteSpec {
  /** Works without a session (must never answer UNAUTHENTICATED). */
  public?: boolean;
  /** Signed plugin route (requireServerSignature): unsigned → 401. */
  signed?: boolean;
  /** Schema-valid body so validation passes and the auth guard answers. */
  body?: unknown;
  /** Concrete path override (defaults to generic parameter substitution). */
  path?: string;
}

const UUID = '2c3e4f60-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const CASE = 'CASE-2026-000001';
const PLAYER_USER_ID = '76561198000000001@steam';
const REF = { type: 'steam', id: '76561198000000001' } as const;
const REF2 = { type: 'steam', id: '76561198000000002' } as const;
const B64_32 = Buffer.alloc(32, 7).toString('base64');
const B64_64 = Buffer.alloc(64, 7).toString('base64');
const REASON = 'authz matrix probe reason';
const COMMENT = 'authz matrix probe comment';

const collected: CollectedRoute[] = [];
let t: TestApp;
let srv: string; // real public srv_ id (so membership checks answer 403, not 404)
let sessions: Record<'player' | 'server_admin' | 'reviewer' | 'moderator' | 'admin' | 'super_admin', TestSession>;
let reviewerNoTotp: TestSession;
let reviewerUnverified: TestSession; // 2FA enrolled, session not MFA-verified
let adminTargetId: string; // admin user targeted by the admin→admin PATCH probe
let superAdminId: string;

/** Matrix over every route pattern the app registers (key: "METHOD /pattern"). */
const SPECS: Record<string, RouteSpec> = {
  // Ops + docs (public)
  'GET /healthz': { public: true },
  'GET /readyz': { public: true },
  'GET /api/v1/time': { public: true },

  // Auth — public flows
  'POST /api/v1/auth/register': {
    public: true,
    body: { email: 'authz-matrix@example.com', username: 'authzmatrixuser', password: 'Str0ng-Passw0rd-42' },
  },
  'POST /api/v1/auth/login': { public: true, body: { email: 'nobody@example.com', password: 'Wrong-Password-42' } },
  'POST /api/v1/auth/login/2fa': { public: true, body: { mfa_token: 'a'.repeat(24), code: '123456' } },
  'POST /api/v1/auth/verify-email': { public: true, body: { token: 'a'.repeat(43) } },
  'POST /api/v1/auth/resend-verification': { public: true, body: { email: 'nobody@example.com' } },
  'POST /api/v1/auth/password/forgot': { public: true, body: { email: 'nobody@example.com' } },
  'POST /api/v1/auth/password/reset': { public: true, body: { token: 'a'.repeat(43), password: 'Str0ng-Passw0rd-43' } },
  // Auth — session required
  'GET /api/v1/auth/session': {},
  'POST /api/v1/auth/logout': { body: {} },
  'GET /api/v1/auth/sessions': {},
  'POST /api/v1/auth/sessions/:id/revoke': { body: {} },
  'POST /api/v1/auth/password/change': { body: { current_password: 'Old-Password-42', new_password: 'New-Passw0rd-42x' } },
  'POST /api/v1/auth/2fa/setup': { body: {} },
  'POST /api/v1/auth/2fa/enable': { body: { code: '123456' } },
  'POST /api/v1/auth/2fa/disable': { body: { password: 'Some-Passw0rd-42', code: '123456' } },
  'POST /api/v1/auth/2fa/recovery-codes': { body: { password: 'Some-Passw0rd-42', code: '123456' } },

  // Me
  'GET /api/v1/me': {},
  'POST /api/v1/me/player-link': { body: {} },
  'DELETE /api/v1/me/player-link': {},

  // Dashboard
  'GET /api/v1/dashboard': {},

  // Cases
  'GET /api/v1/cases': {},
  'POST /api/v1/cases': { body: { player: REF, reason: REASON } },
  'GET /api/v1/cases/:caseNumber': {},
  'POST /api/v1/cases/:caseNumber/reviews/start': { body: { comment: COMMENT } },
  'POST /api/v1/cases/:caseNumber/notes': { body: { comment: COMMENT } },
  'POST /api/v1/cases/:caseNumber/verdict': { body: { verdict: 'confirmed', comment: COMMENT } },
  'POST /api/v1/cases/:caseNumber/reopen': { body: { comment: COMMENT } },
  'POST /api/v1/cases/:caseNumber/confirmations': { body: () => ({ server_id: srv }) as never },
  'DELETE /api/v1/cases/:caseNumber/confirmations/:id': {},
  'GET /api/v1/public/cases/:caseNumber': { public: true },

  // Reports
  'GET /api/v1/reports': {},
  'POST /api/v1/reports': { body: { player: REF, reason: REASON } },
  'GET /api/v1/reports/:id': {},
  'POST /api/v1/reports/:id/status': { body: { status: 'under_review', note: REASON } },

  // Evidence
  'POST /api/v1/cases/:caseNumber/evidence': { body: {} }, // multipart; guard answers before parsing
  'POST /api/v1/cases/:caseNumber/evidence/link': { body: { url: 'https://example.com/clip', title: 'clip' } },
  'GET /api/v1/evidence': {},
  'GET /api/v1/evidence/:id': {},
  'POST /api/v1/evidence/:id/ticket': { body: {} },
  // Session OR ?ticket= authenticate in the service (media elements send no cookie);
  // an anonymous request without a ticket on an existing object → 401 (evidence tests).
  'GET /api/v1/evidence/:id/content': { public: true },
  'POST /api/v1/evidence/:id/reviews': {
    body: { status: 'verified', identity_status: 'verified', authenticity_status: 'verified', cheating_status: 'verified', comment: COMMENT },
  },
  'POST /api/v1/evidence/:id/supersede': { body: {} },
  'GET /api/v1/evidence/proof': { public: true },

  // Players
  'GET /api/v1/players': {},
  'GET /api/v1/players/:userId': { public: true },

  // Servers (web)
  'GET /api/v1/servers': {},
  'POST /api/v1/servers': { body: { name: 'Authz Probe Server' } },
  'GET /api/v1/servers/:id': {},
  'PATCH /api/v1/servers/:id': { body: { name: 'Authz Probe Server' } },
  'POST /api/v1/servers/:id/registration-token': { body: {} },
  'GET /api/v1/servers/:id/keys': {},
  'POST /api/v1/servers/:id/keys/:keyId/revoke': { body: { reason: REASON } },
  'POST /api/v1/servers/:id/keys/rotation-request': { body: {} },
  'GET /api/v1/servers/:id/policy': {},
  'PUT /api/v1/servers/:id/policy': { body: { rules: [] } },
  'POST /api/v1/servers/:id/policy/preview': {
    body: {
      input: {
        global_status: 'none',
        case_id: null,
        confirmed_servers: 0,
        open_reports: 0,
        account_age: { days: null },
        vpn: { confidence: 'not_detected' },
        alt_account: { possible: false, confidence: 'none', linked_confirmed_cases: [] },
        bypass: { types: [] },
      },
    },
  },
  'GET /api/v1/servers/:id/policy/history': {},
  'GET /api/v1/servers/:id/members': {},
  'POST /api/v1/servers/:id/members': { body: { username: 'someuser', role: 'moderator' } },
  'DELETE /api/v1/servers/:id/members/:userId': {},
  'GET /api/v1/servers/:id/bypasses': {},
  'POST /api/v1/servers/:id/bypasses': { body: { player: REF, type: 'vpn_whitelist', reason: REASON } },
  'POST /api/v1/bypasses/:id/revoke': { body: { reason: REASON } },
  'POST /api/v1/servers/:id/status': { body: { status: 'suspended', reason: REASON } },
  'POST /api/v1/servers/:id/trust': { body: { is_trusted: true } },

  // Appeals
  'GET /api/v1/appeals': {},
  'POST /api/v1/appeals': { body: { case_id: CASE, statement: 'authz matrix probe appeal statement' } },
  'GET /api/v1/appeals/:id': {},
  'POST /api/v1/appeals/:id/assign': { body: { reviewer_user_id: UUID } },
  'POST /api/v1/appeals/:id/decision': { body: { decision: 'confirm', reason: 'authz matrix decision reason' } },
  'POST /api/v1/appeals/:id/withdraw': { body: {} },

  // Whitelist
  'GET /api/v1/whitelist-requests': {},
  'POST /api/v1/whitelist-requests': { body: () => ({ server_id: srv, type: 'vpn_whitelist', reason: 'authz matrix whitelist reason' }) as never },
  'GET /api/v1/whitelist-requests/:id': {},
  'POST /api/v1/whitelist-requests/:id/decision': { body: { decision: 'reject' } },
  'POST /api/v1/whitelist-requests/:id/revoke': { body: { reason: REASON } },

  // Overwatch (web)
  'GET /api/v1/overwatch/sessions': {},
  'GET /api/v1/overwatch/sessions/:id': {},

  // Admin
  'GET /api/v1/admin/users': {},
  'PATCH /api/v1/admin/users/:id': { body: { role: 'player' } },
  'GET /api/v1/admin/audit': {},
  'GET /api/v1/admin/audit/verify': {},
  'GET /api/v1/admin/bypasses': {},
  'POST /api/v1/admin/bypasses': { body: { player: REF, type: 'vpn_whitelist', reason: REASON } },
  'GET /api/v1/admin/security/events': {},
  'GET /api/v1/admin/security/blocks': {},
  'POST /api/v1/admin/security/blocks/:id/clear': { body: {} },
  'GET /api/v1/admin/security/summary': {},

  // Plugin (signed)
  'POST /api/v1/servers/register': {
    public: true,
    body: {
      registration_token: `sreg_${'A'.repeat(43)}`,
      public_key: B64_32,
      plugin_version: '1.0.0',
      timestamp: Date.now(),
      pop_signature: B64_64,
    },
  },
  'POST /api/v1/servers/heartbeat': { signed: true, body: { plugin_version: '1.0.0' } },
  'POST /api/v1/servers/keys/rotate': { signed: true, body: { new_public_key: B64_32, timestamp: Date.now(), pop_signature: B64_64 } },
  'GET /api/v1/servers/policy': { signed: true },
  'POST /api/v1/player/check': { signed: true, body: { player: REF } },
  'POST /api/v1/player/bypass/check': { signed: true, body: { player: REF } },
  'POST /api/v1/player/link': { signed: true, body: { player: REF, code: 'LNK-ABCDEF' } },
  'POST /api/v1/server/reports': { signed: true, body: { player: REF, reason: REASON } },
  'POST /api/v1/overwatch/sessions': { signed: true, body: { target_player: REF, spectator: REF2 } },
  'POST /api/v1/overwatch/sessions/:id/heartbeat': { signed: true, body: {} },
  'POST /api/v1/overwatch/sessions/:id/end': { signed: true, body: { reason: 'manual' } },
};

function specKey(route: CollectedRoute): string {
  return `${route.method} ${route.url}`;
}

function concretePath(pattern: string): string {
  return pattern
    .replace('/admin/security/blocks/:id/clear', '/admin/security/blocks/network.abc/clear')
    .replace('/servers/:id', `/servers/${srv}`)
    .replace(':caseNumber', CASE)
    .replace('/players/:userId', `/players/${encodeURIComponent(PLAYER_USER_ID)}`)
    .replace(':keyId', UUID)
    .replace(':userId', UUID)
    .replace(':id', UUID);
}

function bodyOf(spec: RouteSpec): unknown {
  return typeof spec.body === 'function' ? (spec.body as () => unknown)() : spec.body;
}

function errorCode(res: { statusCode: number; body: string }): string | undefined {
  try {
    return (JSON.parse(res.body) as { error?: { code?: string } }).error?.code;
  } catch {
    return undefined;
  }
}

beforeAll(async () => {
  t = await buildTestApp({
    onRoute(route) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        if (method === 'HEAD' || method === 'OPTIONS') continue;
        if (route.url.startsWith('/api/docs')) continue; // OpenAPI/Swagger UI (dev only)
        collected.push({ method, url: route.url });
      }
    },
  });
  const { deps } = t;
  const identity = await createServerWithKey(deps);
  srv = identity.server.server_id;

  const mk = async (role: 'player' | 'server_admin' | 'reviewer' | 'moderator' | 'admin' | 'super_admin', totp: boolean) => {
    const { user } = await createUser(deps, { role, verified: true, totp });
    return { user, session: await sessionFor(deps, user, { mfa_verified: totp }) };
  };
  const player = await mk('player', false);
  const serverAdmin = await mk('server_admin', false);
  const reviewer = await mk('reviewer', true);
  const moderator = await mk('moderator', true);
  const admin = await mk('admin', true);
  const superAdmin = await mk('super_admin', true);
  superAdminId = superAdmin.user.id;
  sessions = {
    player: player.session,
    server_admin: serverAdmin.session,
    reviewer: reviewer.session,
    moderator: moderator.session,
    admin: admin.session,
    super_admin: superAdmin.session,
  };

  const noTotp = await createUser(deps, { role: 'reviewer', verified: true });
  reviewerNoTotp = await sessionFor(deps, noTotp.user, { mfa_verified: false });
  const unverified = await createUser(deps, { role: 'reviewer', verified: true, totp: true });
  reviewerUnverified = await sessionFor(deps, unverified.user, { mfa_verified: false });

  const adminTarget = await createUser(deps, { role: 'admin', verified: true, totp: true });
  adminTargetId = adminTarget.user.id;
}, 120_000);

afterAll(async () => {
  await t.close();
});

describe('authz matrix', () => {
  it('every registered route has a matrix entry', () => {
    const missing = collected.map(specKey).filter((key) => SPECS[key] === undefined);
    expect(missing, `routes without a matrix entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('unauthenticated requests are rejected with 401 on every non-public route', async () => {
    for (const route of collected) {
      const spec = SPECS[specKey(route)];
      if (spec === undefined || spec.public === true || spec.signed === true) continue;
      const body = bodyOf(spec);
      const res = await t.app.inject({
        method: route.method as 'GET',
        url: concretePath(route.url),
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      expect(res.statusCode, `${specKey(route)} → ${res.statusCode} ${res.body}`).toBe(401);
      expect(errorCode(res), specKey(route)).toBe('UNAUTHENTICATED');
    }
  });

  it('public routes never demand a session', async () => {
    for (const route of collected) {
      const spec = SPECS[specKey(route)];
      if (spec?.public !== true) continue;
      const body = bodyOf(spec);
      const res = await t.app.inject({
        method: route.method as 'GET',
        url: concretePath(route.url),
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      expect(errorCode(res), `${specKey(route)} → ${res.statusCode} ${res.body}`).not.toBe('UNAUTHENTICATED');
      expect(res.statusCode, specKey(route)).toBeLessThan(500);
    }
  });

  it('signed plugin routes reject unsigned requests with 401', async () => {
    for (const route of collected) {
      const spec = SPECS[specKey(route)];
      if (spec?.signed !== true) continue;
      const body = bodyOf(spec);
      const res = await t.app.inject({
        method: route.method as 'GET',
        url: concretePath(route.url),
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      expect(res.statusCode, `${specKey(route)} → ${res.statusCode} ${res.body}`).toBe(401);
    }
  });

  it('unsafe methods with a session but no CSRF token → 403 CSRF_TOKEN_INVALID', async () => {
    for (const route of collected) {
      if (route.method === 'GET') continue;
      const res = await t.app.inject({
        method: route.method as 'POST',
        url: concretePath(route.url),
        headers: { cookie: sessions.player.cookie },
      });
      expect(res.statusCode, `${specKey(route)} → ${res.statusCode} ${res.body}`).toBe(403);
      expect(errorCode(res), specKey(route)).toBe('CSRF_TOKEN_INVALID');
    }
  });

  it('per-role representative forbidden calls → 403', async () => {
    // [role, method, pattern, expected code]
    const probes: Array<[keyof typeof sessions, string, string, string?]> = [
      // player — lacks every staff/management permission
      ['player', 'GET', '/api/v1/cases'],
      ['player', 'POST', '/api/v1/cases'],
      ['player', 'POST', '/api/v1/cases/:caseNumber/reviews/start'],
      ['player', 'POST', '/api/v1/cases/:caseNumber/verdict'],
      ['player', 'POST', '/api/v1/cases/:caseNumber/reopen'],
      ['player', 'GET', '/api/v1/players'],
      ['player', 'GET', '/api/v1/evidence'],
      ['player', 'POST', '/api/v1/evidence/:id/reviews'],
      ['player', 'POST', '/api/v1/reports/:id/status'],
      ['player', 'GET', '/api/v1/overwatch/sessions'],
      ['player', 'POST', '/api/v1/servers'],
      ['player', 'PATCH', '/api/v1/servers/:id'], // not a member of srv
      ['player', 'POST', '/api/v1/servers/:id/status'],
      ['player', 'POST', '/api/v1/servers/:id/trust'],
      ['player', 'POST', '/api/v1/appeals/:id/assign'],
      ['player', 'POST', '/api/v1/appeals/:id/decision'],
      ['player', 'GET', '/api/v1/admin/users'],
      ['player', 'PATCH', '/api/v1/admin/users/:id'],
      ['player', 'GET', '/api/v1/admin/audit'],
      ['player', 'GET', '/api/v1/admin/audit/verify'],
      ['player', 'GET', '/api/v1/admin/bypasses'],
      ['player', 'POST', '/api/v1/admin/bypasses'],
      // server_admin — staff case scope but no reviewer/global admin permissions
      ['server_admin', 'GET', '/api/v1/players'],
      ['server_admin', 'POST', '/api/v1/cases/:caseNumber/verdict'],
      ['server_admin', 'POST', '/api/v1/servers/:id/status'],
      ['server_admin', 'GET', '/api/v1/admin/users'],
      ['server_admin', 'GET', '/api/v1/admin/audit'],
      ['server_admin', 'POST', '/api/v1/admin/bypasses'],
      // reviewer — no case:create, appeal:assign, user:view, server or audit administration
      ['reviewer', 'POST', '/api/v1/cases'],
      ['reviewer', 'POST', '/api/v1/cases/:caseNumber/reopen'],
      ['reviewer', 'POST', '/api/v1/appeals/:id/assign'],
      ['reviewer', 'POST', '/api/v1/servers'],
      ['reviewer', 'POST', '/api/v1/servers/:id/status'],
      ['reviewer', 'GET', '/api/v1/admin/users'],
      ['reviewer', 'GET', '/api/v1/admin/audit'],
      ['reviewer', 'POST', '/api/v1/admin/bypasses'],
      ['reviewer', 'GET', '/api/v1/admin/security/events'],
      ['reviewer', 'POST', '/api/v1/admin/security/blocks/:id/clear'],
      // moderator — no user:manage, audit:view/verify, global bypasses, server administration
      ['moderator', 'PATCH', '/api/v1/admin/users/:id'],
      ['moderator', 'GET', '/api/v1/admin/audit'],
      ['moderator', 'GET', '/api/v1/admin/audit/verify'],
      ['moderator', 'GET', '/api/v1/admin/bypasses'],
      ['moderator', 'POST', '/api/v1/admin/bypasses'],
      ['moderator', 'POST', '/api/v1/servers'],
      ['moderator', 'POST', '/api/v1/servers/:id/status'],
      ['moderator', 'POST', '/api/v1/servers/:id/trust'],
    ];
    for (const [role, method, pattern] of probes) {
      const key = `${method} ${pattern}`;
      const spec = SPECS[key];
      expect(spec, key).toBeDefined();
      const body = bodyOf(spec ?? {});
      const res = await t.app.inject({
        method: method as 'GET',
        url: concretePath(pattern),
        headers: sessions[role].headers,
        ...(body !== undefined ? { payload: body as Record<string, unknown> } : {}),
      });
      expect(res.statusCode, `${role} ${key} → ${res.statusCode} ${res.body}`).toBe(403);
      expect(errorCode(res), `${role} ${key}`).toBe('FORBIDDEN');
    }
  });

  it('admin cannot manage another admin (user:manage_admins boundary)', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${adminTargetId}`,
      headers: sessions.admin.headers,
      payload: { role: 'player' },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('super_admin cannot change their own role/status', async () => {
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${superAdminId}`,
      headers: sessions.super_admin.headers,
      payload: { role: 'admin' },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('staff role without 2FA enrollment → 403 MFA_ENROLLMENT_REQUIRED', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/cases', headers: reviewerNoTotp.headers });
    expect(res.statusCode, res.body).toBe(403);
    expect(errorCode(res)).toBe('MFA_ENROLLMENT_REQUIRED');
  });

  it('optional-auth routes apply the enrollment gate to unenrolled staff sessions (SR-03)', async () => {
    const content = await t.app.inject({
      method: 'GET',
      url: concretePath('/api/v1/evidence/:id/content'),
      headers: { cookie: reviewerNoTotp.cookie },
    });
    expect(content.statusCode, content.body).toBe(403);
    expect(errorCode(content)).toBe('MFA_ENROLLMENT_REQUIRED');

    // Proof API: treated like a caller without proof:view_code (code required, never revealed).
    const proof = await t.app.inject({
      method: 'GET',
      url: `/api/v1/evidence/proof?server_id=srv_0000000000000000&player_id=${PLAYER_USER_ID}&spectator_id=${PLAYER_USER_ID}&timestamp=${Date.now()}`,
      headers: { cookie: reviewerNoTotp.cookie },
    });
    expect(proof.statusCode, proof.body).toBe(400);
    expect(errorCode(proof)).toBe('VALIDATION_FAILED');
  });

  it('appeal decisions require an MFA-verified session (SPEC-6)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: concretePath('/api/v1/appeals/:id/decision'),
      headers: reviewerUnverified.headers,
      payload: { decision: 'confirm', reason: REASON },
    });
    expect(res.statusCode, res.body).toBe(403);
  });

  it('verdict requires an MFA-verified session', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: concretePath('/api/v1/cases/:caseNumber/verdict'),
      headers: reviewerUnverified.headers,
      payload: { verdict: 'confirmed', comment: COMMENT },
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});
