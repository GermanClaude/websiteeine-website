/**
 * Route coverage (integration): builds the full app and asserts that EVERY endpoint of
 * ARCHITECTURE §6 (plugin ⇄ backend, signed) and §13 (web API index) is registered,
 * and that the §6 signed endpoints actually carry the server-signature preHandler.
 *
 * The endpoint lists below are copied explicitly from docs/ARCHITECTURE.md so a route
 * that silently disappears (or is renamed) fails this test.
 */
import { describe, expect, it } from 'vitest';

import { buildTestApp, type TestApp } from '../helpers';

interface CollectedRoute {
  method: string;
  url: string;
  preHandler: unknown;
}

let t: TestApp;
const collected: CollectedRoute[] = [];

/** §6 — plugin ⇄ backend API. `signed: true` = must use requireServerSignature. */
const PLUGIN_ENDPOINTS: ReadonlyArray<{ method: string; url: string; signed: boolean }> = [
  { method: 'GET', url: '/api/v1/time', signed: false },
  { method: 'POST', url: '/api/v1/servers/register', signed: false }, // token + PoP
  { method: 'POST', url: '/api/v1/servers/heartbeat', signed: true },
  { method: 'POST', url: '/api/v1/servers/keys/rotate', signed: true },
  { method: 'GET', url: '/api/v1/servers/policy', signed: true },
  { method: 'POST', url: '/api/v1/player/check', signed: true },
  { method: 'POST', url: '/api/v1/player/bypass/check', signed: true },
  { method: 'POST', url: '/api/v1/player/link', signed: true },
  { method: 'POST', url: '/api/v1/server/reports', signed: true },
  { method: 'POST', url: '/api/v1/overwatch/sessions', signed: true },
  { method: 'POST', url: '/api/v1/overwatch/sessions/:id/heartbeat', signed: true },
  { method: 'POST', url: '/api/v1/overwatch/sessions/:id/end', signed: true },
];

/** §13 — web API endpoint index (plus §12.2 auth flows and the ops endpoints). */
const WEB_ENDPOINTS: ReadonlyArray<{ method: string; url: string }> = [
  // Ops
  { method: 'GET', url: '/healthz' },
  { method: 'GET', url: '/readyz' },
  // Auth (§12.2)
  { method: 'POST', url: '/api/v1/auth/register' },
  { method: 'POST', url: '/api/v1/auth/verify-email' },
  { method: 'POST', url: '/api/v1/auth/resend-verification' },
  { method: 'POST', url: '/api/v1/auth/login' },
  { method: 'POST', url: '/api/v1/auth/login/2fa' },
  { method: 'GET', url: '/api/v1/auth/session' },
  { method: 'POST', url: '/api/v1/auth/logout' },
  { method: 'GET', url: '/api/v1/auth/sessions' },
  { method: 'POST', url: '/api/v1/auth/sessions/:id/revoke' },
  { method: 'POST', url: '/api/v1/auth/password/forgot' },
  { method: 'POST', url: '/api/v1/auth/password/reset' },
  { method: 'POST', url: '/api/v1/auth/password/change' },
  { method: 'POST', url: '/api/v1/auth/2fa/setup' },
  { method: 'POST', url: '/api/v1/auth/2fa/enable' },
  { method: 'POST', url: '/api/v1/auth/2fa/disable' },
  { method: 'POST', url: '/api/v1/auth/2fa/recovery-codes' },
  // Me
  { method: 'GET', url: '/api/v1/me' },
  { method: 'POST', url: '/api/v1/me/player-link' },
  { method: 'DELETE', url: '/api/v1/me/player-link' },
  // Dashboard
  { method: 'GET', url: '/api/v1/dashboard' },
  // Cases
  { method: 'GET', url: '/api/v1/cases' },
  { method: 'POST', url: '/api/v1/cases' },
  { method: 'GET', url: '/api/v1/cases/:caseNumber' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/reviews/start' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/notes' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/verdict' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/reopen' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/confirmations' },
  { method: 'DELETE', url: '/api/v1/cases/:caseNumber/confirmations/:id' },
  { method: 'GET', url: '/api/v1/public/cases/:caseNumber' },
  // Reports
  { method: 'GET', url: '/api/v1/reports' },
  { method: 'POST', url: '/api/v1/reports' },
  { method: 'GET', url: '/api/v1/reports/:id' },
  { method: 'POST', url: '/api/v1/reports/:id/status' },
  // Evidence
  { method: 'POST', url: '/api/v1/cases/:caseNumber/evidence' },
  { method: 'POST', url: '/api/v1/cases/:caseNumber/evidence/link' },
  { method: 'GET', url: '/api/v1/evidence' },
  { method: 'GET', url: '/api/v1/evidence/:id' },
  { method: 'POST', url: '/api/v1/evidence/:id/ticket' },
  { method: 'GET', url: '/api/v1/evidence/:id/content' },
  { method: 'POST', url: '/api/v1/evidence/:id/reviews' },
  { method: 'POST', url: '/api/v1/evidence/:id/supersede' },
  { method: 'GET', url: '/api/v1/evidence/proof' },
  // Players
  { method: 'GET', url: '/api/v1/players' },
  { method: 'GET', url: '/api/v1/players/:userId' },
  // Servers
  { method: 'GET', url: '/api/v1/servers' },
  { method: 'POST', url: '/api/v1/servers' },
  { method: 'GET', url: '/api/v1/servers/:id' },
  { method: 'PATCH', url: '/api/v1/servers/:id' },
  { method: 'POST', url: '/api/v1/servers/:id/registration-token' },
  { method: 'GET', url: '/api/v1/servers/:id/keys' },
  { method: 'POST', url: '/api/v1/servers/:id/keys/:keyId/revoke' },
  { method: 'POST', url: '/api/v1/servers/:id/keys/rotation-request' },
  { method: 'GET', url: '/api/v1/servers/:id/policy' },
  { method: 'PUT', url: '/api/v1/servers/:id/policy' },
  { method: 'POST', url: '/api/v1/servers/:id/policy/preview' },
  { method: 'GET', url: '/api/v1/servers/:id/members' },
  { method: 'POST', url: '/api/v1/servers/:id/members' },
  { method: 'DELETE', url: '/api/v1/servers/:id/members/:userId' },
  { method: 'GET', url: '/api/v1/servers/:id/bypasses' },
  { method: 'POST', url: '/api/v1/servers/:id/bypasses' },
  { method: 'POST', url: '/api/v1/bypasses/:id/revoke' },
  { method: 'POST', url: '/api/v1/servers/:id/status' },
  { method: 'POST', url: '/api/v1/servers/:id/trust' },
  // Appeals
  { method: 'GET', url: '/api/v1/appeals' },
  { method: 'POST', url: '/api/v1/appeals' },
  { method: 'GET', url: '/api/v1/appeals/:id' },
  { method: 'POST', url: '/api/v1/appeals/:id/assign' },
  { method: 'POST', url: '/api/v1/appeals/:id/decision' },
  { method: 'POST', url: '/api/v1/appeals/:id/withdraw' },
  // Whitelist
  { method: 'GET', url: '/api/v1/whitelist-requests' },
  { method: 'POST', url: '/api/v1/whitelist-requests' },
  { method: 'GET', url: '/api/v1/whitelist-requests/:id' },
  { method: 'POST', url: '/api/v1/whitelist-requests/:id/decision' },
  { method: 'POST', url: '/api/v1/whitelist-requests/:id/revoke' },
  // Overwatch (web)
  { method: 'GET', url: '/api/v1/overwatch/sessions' },
  { method: 'GET', url: '/api/v1/overwatch/sessions/:id' },
  // Admin
  { method: 'GET', url: '/api/v1/admin/users' },
  { method: 'PATCH', url: '/api/v1/admin/users/:id' },
  { method: 'GET', url: '/api/v1/admin/audit' },
  { method: 'GET', url: '/api/v1/admin/audit/verify' },
  { method: 'GET', url: '/api/v1/admin/bypasses' },
  { method: 'POST', url: '/api/v1/admin/bypasses' },
];

function routeKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

describe('route coverage (ARCHITECTURE §6 + §13)', () => {
  it('registers every documented endpoint', async () => {
    t = await buildTestApp({
      onRoute(route) {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) {
          if (method === 'HEAD' || method === 'OPTIONS') continue;
          collected.push({ method, url: route.url, preHandler: route.preHandler });
        }
      },
    });
    try {
      const registered = new Map(collected.map((r) => [routeKey(r.method, r.url), r]));

      const missing: string[] = [];
      for (const endpoint of [...PLUGIN_ENDPOINTS, ...WEB_ENDPOINTS]) {
        if (!registered.has(routeKey(endpoint.method, endpoint.url))) missing.push(routeKey(endpoint.method, endpoint.url));
      }
      expect(missing, `endpoints missing from the app: ${missing.join(', ')}`).toEqual([]);

      // §6: every signed endpoint carries the requireServerSignature preHandler.
      const signatureHandler = t.app.requireServerSignature;
      expect(typeof signatureHandler).toBe('function');
      for (const endpoint of PLUGIN_ENDPOINTS) {
        const route = registered.get(routeKey(endpoint.method, endpoint.url));
        expect(route).toBeDefined();
        const pre = route?.preHandler;
        const preList = Array.isArray(pre) ? pre : pre !== undefined ? [pre] : [];
        const signed = preList.includes(signatureHandler);
        expect(signed, `${routeKey(endpoint.method, endpoint.url)} signed=${String(signed)}`).toBe(endpoint.signed);
      }

      // Sanity: everything lives under /api/v1 except the ops endpoints.
      for (const r of collected) {
        if (r.url === '/healthz' || r.url === '/readyz') continue;
        expect(r.url.startsWith('/api/v1/') || r.url.startsWith('/api/docs'), `unexpected route prefix: ${r.url}`).toBe(true);
      }
    } finally {
      await t.close();
    }
  });
});
