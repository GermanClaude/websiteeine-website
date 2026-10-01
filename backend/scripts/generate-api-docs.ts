/**
 * Regenerates the endpoint tables in docs/API.md from the OpenAPI document.
 *
 * Usage (from backend/):
 *   pnpm exec tsx scripts/generate-api-docs.ts             # builds the app in-process
 *   pnpm exec tsx scripts/generate-api-docs.ts --url http://localhost:8471
 *   pnpm exec tsx scripts/generate-api-docs.ts --file /path/to/openapi.json
 *   ... --check   # verify docs/API.md is up to date (exit 1 when stale), write nothing
 *
 * The prose sections of docs/API.md are curated by hand; everything between the
 * BEGIN/END GENERATED markers is replaced by this script. Method/path/summary come
 * from the OpenAPI spec (i.e. from the zod route schemas); the auth column comes from
 * the AUTH table below, and the script fails when an operation is missing from it or
 * the table carries a stale entry — so new endpoints force a docs update.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface OpenApiOperation {
  tags?: string[];
  summary?: string;
}

interface OpenApiSpec {
  openapi: string;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** Auth + permission/scope for every operation, keyed "METHOD /path" (OpenAPI path). */
const AUTH: Record<string, { auth: string; scope: string }> = {
  // --- plugin (signed Ed25519 requests; §5/§6) --------------------------------------
  'GET /api/v1/time': { auth: 'Public', scope: '—' },
  'POST /api/v1/servers/register': { auth: 'Registration token + PoP', scope: 'per-IP registration rate limit' },
  'POST /api/v1/servers/heartbeat': { auth: 'Signed', scope: '—' },
  'POST /api/v1/servers/keys/rotate': { auth: 'Signed (active key) + PoP by the new key', scope: '—' },
  'GET /api/v1/servers/policy': { auth: 'Signed', scope: '—' },
  'POST /api/v1/player/check': { auth: 'Signed', scope: '—' },
  'POST /api/v1/player/bypass/check': { auth: 'Signed', scope: '—' },
  'POST /api/v1/player/link': { auth: 'Signed', scope: '—' },
  'POST /api/v1/server/reports': { auth: 'Signed', scope: 'body ≤ 128 KiB' },
  'POST /api/v1/overwatch/sessions': { auth: 'Signed', scope: '—' },
  'POST /api/v1/overwatch/sessions/{id}/heartbeat': { auth: 'Signed', scope: 'own session only' },
  'POST /api/v1/overwatch/sessions/{id}/end': { auth: 'Signed', scope: 'own session only' },

  // --- auth -------------------------------------------------------------------------
  'POST /api/v1/auth/register': { auth: 'Public', scope: 'auth rate limit; ALLOW_REGISTRATION' },
  'POST /api/v1/auth/verify-email': { auth: 'Public', scope: 'single-use 24 h token' },
  'POST /api/v1/auth/resend-verification': { auth: 'Public', scope: 'always 202' },
  'POST /api/v1/auth/login': { auth: 'Public', scope: 'auth rate limit; account lockout' },
  'POST /api/v1/auth/login/2fa': { auth: 'Public', scope: 'single-successful-use mfa_token (5 min)' },
  'POST /api/v1/auth/password/forgot': { auth: 'Public', scope: 'always 202; 1 h single-use token' },
  'POST /api/v1/auth/password/reset': { auth: 'Public', scope: 'revokes all sessions' },
  'GET /api/v1/auth/session': { auth: 'Session', scope: '401 when anonymous' },
  'POST /api/v1/auth/logout': { auth: 'Session + CSRF', scope: '—' },
  'GET /api/v1/auth/sessions': { auth: 'Session', scope: 'own sessions' },
  'POST /api/v1/auth/sessions/{id}/revoke': { auth: 'Session + CSRF', scope: 'own sessions (foreign → 404)' },
  'POST /api/v1/auth/password/change': { auth: 'Session + CSRF', scope: 'revokes other sessions' },
  'POST /api/v1/auth/2fa/setup': { auth: 'Session + CSRF', scope: '—' },
  'POST /api/v1/auth/2fa/enable': { auth: 'Session + CSRF', scope: 'revokes other sessions' },
  'POST /api/v1/auth/2fa/disable': { auth: 'Session + CSRF', scope: 'forbidden for REQUIRE_2FA_ROLES' },
  'POST /api/v1/auth/2fa/recovery-codes': { auth: 'Session + CSRF', scope: 'password + current code' },

  // --- me ---------------------------------------------------------------------------
  'GET /api/v1/me': { auth: 'Session', scope: 'usable while 2FA enrollment is pending' },
  'POST /api/v1/me/player-link': { auth: 'Session + CSRF', scope: 'player:link' },
  'DELETE /api/v1/me/player-link': { auth: 'Session + CSRF', scope: 'player:link' },

  // --- dashboard --------------------------------------------------------------------
  'GET /api/v1/dashboard': { auth: 'Session', scope: 'content scoped by permissions/memberships; null counts elsewhere' },

  // --- cases ------------------------------------------------------------------------
  'GET /api/v1/cases': { auth: 'Session', scope: 'case staff scope (reviewer+: all; server team: own servers)' },
  'POST /api/v1/cases': { auth: 'Session + CSRF', scope: 'case:create' },
  'GET /api/v1/cases/{caseNumber}': { auth: 'Session', scope: 'case staff scope; 403 outside (UI falls back to public view)' },
  'POST /api/v1/cases/{caseNumber}/reviews/start': { auth: 'Session + CSRF', scope: 'case:review' },
  'POST /api/v1/cases/{caseNumber}/notes': { auth: 'Session + CSRF', scope: 'case:review' },
  'POST /api/v1/cases/{caseNumber}/verdict': { auth: 'Session + CSRF', scope: 'case:set_verdict + MFA-verified session' },
  'POST /api/v1/cases/{caseNumber}/reopen': { auth: 'Session + CSRF', scope: 'case:reopen' },
  'POST /api/v1/cases/{caseNumber}/confirmations': { auth: 'Session + CSRF', scope: 'member owner/admin of an active server that reported on / saw the player' },
  'DELETE /api/v1/cases/{caseNumber}/confirmations/{id}': { auth: 'Session + CSRF', scope: 'member owner/admin of the confirming server' },
  'GET /api/v1/public/cases/{caseNumber}': { auth: 'Public', scope: 'PUBLIC_CASE_LOOKUP=true' },

  // --- reports ----------------------------------------------------------------------
  'GET /api/v1/reports': { auth: 'Session', scope: 'report:review → all; others own reports' },
  'POST /api/v1/reports': { auth: 'Session + CSRF', scope: 'report:create + verified email; 10/h per user' },
  'GET /api/v1/reports/{id}': { auth: 'Session', scope: 'report:review or the reporter' },
  'POST /api/v1/reports/{id}/status': { auth: 'Session + CSRF', scope: 'report:review' },

  // --- evidence ---------------------------------------------------------------------
  'POST /api/v1/cases/{caseNumber}/evidence': { auth: 'Session + CSRF', scope: 'reviewer+, the reporter, or member of a reporting server; per-user upload quotas' },
  'POST /api/v1/cases/{caseNumber}/evidence/link': { auth: 'Session + CSRF', scope: 'same upload rule; https URLs only' },
  'GET /api/v1/evidence': { auth: 'Session', scope: 'evidence:view' },
  'GET /api/v1/evidence/{id}': { auth: 'Session', scope: '§11.3 access rule; ?verify=true reviewer+' },
  'POST /api/v1/evidence/{id}/ticket': { auth: 'Session + CSRF', scope: '§11.3 access rule; audited' },
  'GET /api/v1/evidence/{id}/content': { auth: 'Session or ?ticket=', scope: 'audited; hardened headers; no CSRF for tickets; 2FA enrollment gate for sessions' },
  'POST /api/v1/evidence/{id}/reviews': { auth: 'Session (2FA-verified) + CSRF', scope: 'evidence:review; not uploader, reporter or case subject' },
  'POST /api/v1/evidence/{id}/supersede': { auth: 'Session + CSRF', scope: 'uploader, uploader-server member or evidence:review; once per object; upload quotas' },

  // --- players ----------------------------------------------------------------------
  'GET /api/v1/players': { auth: 'Session', scope: 'player:view_staff' },
  'GET /api/v1/players/{userId}': { auth: 'Public', scope: 'staff view with player:view_staff session' },

  // --- servers ----------------------------------------------------------------------
  'GET /api/v1/servers': { auth: 'Session', scope: 'own memberships; all with server:manage_any' },
  'POST /api/v1/servers': { auth: 'Session + CSRF', scope: 'server:create' },
  'GET /api/v1/servers/{id}': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'PATCH /api/v1/servers/{id}': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'POST /api/v1/servers/{id}/registration-token': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'GET /api/v1/servers/{id}/keys': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'POST /api/v1/servers/{id}/keys/{keyId}/revoke': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'POST /api/v1/servers/{id}/keys/rotation-request': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'GET /api/v1/servers/{id}/members': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'POST /api/v1/servers/{id}/members': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'DELETE /api/v1/servers/{id}/members/{userId}': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any; owner not removable' },
  'GET /api/v1/servers/{id}/bypasses': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'POST /api/v1/servers/{id}/bypasses': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any' },
  'POST /api/v1/bypasses/{id}/revoke': { auth: 'Session + CSRF', scope: 'server scope: member owner/admin; global scope: bypass:manage_global' },
  'POST /api/v1/servers/{id}/status': { auth: 'Session + CSRF', scope: 'server:manage_any' },
  'POST /api/v1/servers/{id}/trust': { auth: 'Session + CSRF', scope: 'server:trust' },

  // --- policies ---------------------------------------------------------------------
  'GET /api/v1/servers/{id}/policy': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'PUT /api/v1/servers/{id}/policy': { auth: 'Session + CSRF', scope: 'member owner/admin or server:manage_any; base_version → 409' },
  'GET /api/v1/servers/{id}/policy/history': { auth: 'Session', scope: 'member (any role) or server:manage_any' },
  'POST /api/v1/servers/{id}/policy/preview': { auth: 'Session + CSRF', scope: 'member (any role) or server:manage_any; pure' },

  // --- appeals ----------------------------------------------------------------------
  'POST /api/v1/appeals': { auth: 'Session + CSRF', scope: 'appeal:create + linked player' },
  'GET /api/v1/appeals': { auth: 'Session', scope: 'appeal:decide → all; others own' },
  'GET /api/v1/appeals/{id}': { auth: 'Session', scope: 'appeal:decide or the submitter' },
  'POST /api/v1/appeals/{id}/assign': { auth: 'Session + CSRF', scope: 'appeal:assign' },
  'POST /api/v1/appeals/{id}/decision': { auth: 'Session (2FA-verified) + CSRF', scope: 'appeal:decide; §11.5 independence rule (never the submitter/case subject)' },
  'POST /api/v1/appeals/{id}/withdraw': { auth: 'Session + CSRF', scope: 'submitter' },

  // --- whitelist --------------------------------------------------------------------
  'POST /api/v1/whitelist-requests': { auth: 'Session + CSRF', scope: 'whitelist:request + linked player' },
  'GET /api/v1/whitelist-requests': { auth: 'Session', scope: 'own + member servers; whitelist:decide_any → all' },
  'GET /api/v1/whitelist-requests/{id}': { auth: 'Session', scope: 'requester, server member or whitelist:decide_any' },
  'POST /api/v1/whitelist-requests/{id}/decision': { auth: 'Session + CSRF', scope: 'member owner/admin/moderator or whitelist:decide_any; no self-decision' },
  'POST /api/v1/whitelist-requests/{id}/revoke': { auth: 'Session + CSRF', scope: 'member owner/admin/moderator or whitelist:decide_any' },

  // --- overwatch (web) + proof ------------------------------------------------------
  'GET /api/v1/evidence/proof': { auth: 'Public (optional session)', scope: 'proof rate limit; code required without proof:view_code (or without 2FA enrollment)' },
  'GET /api/v1/overwatch/sessions': { auth: 'Session', scope: 'overwatch:view' },
  'GET /api/v1/overwatch/sessions/{id}': { auth: 'Session', scope: 'overwatch:view; never contains the secret' },

  // --- admin ------------------------------------------------------------------------
  'GET /api/v1/admin/users': { auth: 'Session', scope: 'user:view' },
  'PATCH /api/v1/admin/users/{id}': { auth: 'Session + CSRF', scope: 'user:manage (admin targets need user:manage_admins); no self-change' },
  'GET /api/v1/admin/audit': { auth: 'Session', scope: 'audit:view' },
  'GET /api/v1/admin/audit/verify': { auth: 'Session', scope: 'audit:verify' },
  'GET /api/v1/admin/bypasses': { auth: 'Session', scope: 'bypass:manage_global' },
  'POST /api/v1/admin/bypasses': { auth: 'Session + CSRF', scope: 'bypass:manage_global' },
  'GET /api/v1/admin/security/events': { auth: 'Session', scope: 'security:view' },
  'GET /api/v1/admin/security/blocks': { auth: 'Session', scope: 'security:view' },
  'POST /api/v1/admin/security/blocks/{id}/clear': { auth: 'Session + CSRF', scope: 'security:manage' },
  'GET /api/v1/admin/security/summary': { auth: 'Session', scope: 'security:view' },
};

/** Table grouping and order; every OpenAPI tag must appear exactly once. */
const GROUPS: ReadonlyArray<{ heading: string; tags: readonly string[] }> = [
  { heading: 'Plugin ⇄ backend (signed)', tags: ['plugin'] },
  { heading: 'Auth', tags: ['auth'] },
  { heading: 'Me', tags: ['me'] },
  { heading: 'Dashboard', tags: ['dashboard'] },
  { heading: 'Cases', tags: ['cases', 'public'] },
  { heading: 'Reports', tags: ['reports'] },
  { heading: 'Evidence', tags: ['evidence'] },
  { heading: 'Players', tags: ['players'] },
  { heading: 'Servers', tags: ['servers'] },
  { heading: 'Policies', tags: ['policies'] },
  { heading: 'Appeals', tags: ['appeals'] },
  { heading: 'Whitelist', tags: ['whitelist'] },
  { heading: 'Bypasses', tags: ['bypasses'] },
  { heading: 'Overwatch (web) & proof', tags: ['overwatch'] },
  { heading: 'Admin', tags: ['admin'] },
];

const BEGIN_MARKER = '<!-- BEGIN GENERATED ENDPOINT TABLES (backend/scripts/generate-api-docs.ts) -->';
const END_MARKER = '<!-- END GENERATED ENDPOINT TABLES -->';

async function loadSpec(): Promise<OpenApiSpec> {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf('--url');
  if (urlIdx !== -1) {
    const base = args[urlIdx + 1];
    if (base === undefined) throw new Error('--url needs a value');
    const res = await fetch(new URL('/api/docs/openapi.json', base));
    if (!res.ok) throw new Error(`GET openapi.json failed: ${res.status}`);
    return (await res.json()) as OpenApiSpec;
  }
  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const file = args[fileIdx + 1];
    if (file === undefined) throw new Error('--file needs a value');
    return JSON.parse(readFileSync(file, 'utf8')) as OpenApiSpec;
  }
  // In-process: build the app with a throwaway dev config; nothing connects at ready().
  const { loadConfig } = await import('../src/config');
  const { createContainer } = await import('../src/container');
  const { buildApp } = await import('../src/app');
  const { createSilentLogger } = await import('../src/lib/logger');
  const config = loadConfig({
    NODE_ENV: 'development',
    DATABASE_URL: process.env['DATABASE_URL'] ?? 'postgres://scpsl:scpsl@localhost:5432/postgres',
    PUBLIC_BASE_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:5173',
  });
  const deps = createContainer(config, { logger: createSilentLogger() });
  try {
    const app = await buildApp(deps);
    await app.ready();
    const spec = app.swagger() as unknown as OpenApiSpec;
    await app.close();
    return spec;
  } finally {
    await deps.close();
  }
}

function generateTables(spec: OpenApiSpec): string {
  const byTag = new Map<string, Array<{ method: string; path: string; summary: string; auth: string; scope: string }>>();
  const seenKeys = new Set<string>();
  const missing: string[] = [];

  for (const [specPath, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op === undefined) continue;
      const key = `${method.toUpperCase()} ${specPath}`;
      seenKeys.add(key);
      const auth = AUTH[key];
      if (auth === undefined) {
        missing.push(key);
        continue;
      }
      const tag = op.tags?.[0] ?? 'other';
      const rows = byTag.get(tag) ?? [];
      rows.push({ method: method.toUpperCase(), path: specPath, summary: op.summary ?? '', auth: auth.auth, scope: auth.scope });
      byTag.set(tag, rows);
    }
  }

  if (missing.length > 0) throw new Error(`Operations missing from the AUTH table:\n  ${missing.join('\n  ')}`);
  const stale = Object.keys(AUTH).filter((key) => !seenKeys.has(key));
  if (stale.length > 0) throw new Error(`Stale AUTH entries (no such operation):\n  ${stale.join('\n  ')}`);

  const groupedTags = new Set(GROUPS.flatMap((group) => group.tags));
  const ungrouped = [...byTag.keys()].filter((tag) => !groupedTags.has(tag));
  if (ungrouped.length > 0) throw new Error(`OpenAPI tags without a table group: ${ungrouped.join(', ')}`);

  const lines: string[] = [];
  for (const group of GROUPS) {
    const rows = group.tags.flatMap((tag) => byTag.get(tag) ?? []);
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    lines.push(`### ${group.heading}`, '');
    lines.push('| Method | Path | Auth | Permission / scope | Description |');
    lines.push('|---|---|---|---|---|');
    for (const row of rows) {
      lines.push(`| ${row.method} | \`${row.path}\` | ${row.auth} | ${row.scope} | ${row.summary} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const spec = await loadSpec();
  const tables = generateTables(spec);

  const docPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/API.md');
  const doc = readFileSync(docPath, 'utf8');
  const begin = doc.indexOf(BEGIN_MARKER);
  const end = doc.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`docs/API.md is missing the ${BEGIN_MARKER} / ${END_MARKER} markers`);
  }
  const updated = `${doc.slice(0, begin + BEGIN_MARKER.length)}\n\n${tables}${doc.slice(end)}`;
  if (check) {
    if (updated !== doc) {
      console.error('docs/API.md endpoint tables are stale; run: pnpm exec tsx scripts/generate-api-docs.ts');
      process.exit(1);
    }
    console.log('docs/API.md endpoint tables are up to date.');
    return;
  }
  writeFileSync(docPath, updated);
  console.log(`docs/API.md updated (${Object.keys(AUTH).length} operations).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
