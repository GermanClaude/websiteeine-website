/**
 * Evidence access (§11.3, §12.1): metadata/content/ticket access matrix, download
 * hardening headers, ticket expiry/tampering, integrity verification, immutability.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { isForbiddenOperation } from '../../../src/db';
import type { Deps } from '../../../src/container';
import { createServerWithKey, createUser, expectError, sessionFor, useTestApp, type TestSession } from '../../helpers';
import { createCase, EVIDENCE_MODULES } from './helpers';

const DATA = Buffer.from('evidence-bytes-for-access-tests', 'utf8');

async function insertEvidence(
  deps: Deps,
  caseId: string,
  uploader: { userId?: string; serverUuid?: string },
): Promise<{ id: string; storageKey: string }> {
  const now = deps.clock.now();
  const storageKey = `evidence/2026/09/${crypto.randomUUID()}`;
  await deps.storage.put(storageKey, Readable.from(DATA), { contentType: 'text/plain', maxBytes: 10_000 });
  const row = await deps.db
    .insertInto('evidence')
    .values({
      case_id: caseId,
      type: 'log',
      title: 'stored log',
      sha256: createHash('sha256').update(DATA).digest('hex'),
      size_bytes: DATA.length,
      mime_type: 'text/plain',
      original_filename: 'stored log.txt',
      storage_key: storageKey,
      uploaded_at: now,
      uploader_user_id: uploader.userId ?? null,
      uploader_server_id: uploader.serverUuid ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, storageKey };
}

describe('evidence access', () => {
  const t = useTestApp({ now: '2026-09-29T15:42:20.000Z', modules: EVIDENCE_MODULES });

  async function setup() {
    const identity = await createServerWithKey(t().deps);
    const { user: uploader } = await createUser(t().deps, { role: 'player' });
    const { caseRow } = await createCase(t().deps);
    const userEvidence = await insertEvidence(t().deps, caseRow.id, { userId: uploader.id });
    const serverEvidence = await insertEvidence(t().deps, caseRow.id, { serverUuid: identity.server.id });
    return { identity, uploader, caseRow, userEvidence, serverEvidence };
  }

  function getMeta(id: string, session: TestSession | null) {
    return t().app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${id}`,
      headers: session === null ? {} : { cookie: session.headers.cookie },
    });
  }

  it('enforces the metadata access matrix', async () => {
    const { identity, uploader, userEvidence, serverEvidence } = await setup();
    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);
    const uploaderSession = await sessionFor(t().deps, uploader);
    const memberSession = await sessionFor(t().deps, identity.owner); // member of the uploader server
    const otherServer = await createServerWithKey(t().deps);
    const unrelatedAdminSession = await sessionFor(t().deps, otherServer.owner);
    const playerSession = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);

    expect((await getMeta(userEvidence.id, reviewer)).statusCode).toBe(200);
    expect((await getMeta(userEvidence.id, uploaderSession)).statusCode).toBe(200);
    expect((await getMeta(serverEvidence.id, memberSession)).statusCode).toBe(200);
    expectError(await getMeta(userEvidence.id, unrelatedAdminSession), 403, 'FORBIDDEN');
    expectError(await getMeta(userEvidence.id, playerSession), 403, 'FORBIDDEN');
    expectError(await getMeta(userEvidence.id, null), 401, 'UNAUTHENTICATED');

    // Uploader identity: visible to reviewers and the uploader, pseudonymized otherwise.
    expect((await getMeta(userEvidence.id, reviewer)).json().uploader_user).not.toBeNull();
    expect((await getMeta(serverEvidence.id, memberSession)).json().uploader_user).toBeNull();
  });

  it('serves content with hardened headers for sessions and enforces the same matrix', async () => {
    const { uploader, userEvidence } = await setup();
    const session = await sessionFor(t().deps, uploader);
    const res = await t().app.inject({
      method: 'GET',
      url: `/api/v1/evidence/${userEvidence.id}/content`,
      headers: { cookie: session.headers.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(DATA)).toBe(true);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('stored log.txt');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(res.headers['cache-control']).toContain('no-store');

    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'EVIDENCE_ACCESSED')
      .where('target_id', '=', userEvidence.id)
      .execute();
    expect(audit.length).toBeGreaterThanOrEqual(1);

    const playerSession = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
    expectError(
      await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${userEvidence.id}/content`, headers: { cookie: playerSession.headers.cookie } }),
      403,
      'FORBIDDEN',
    );
    expectError(await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${userEvidence.id}/content` }), 401, 'UNAUTHENTICATED');
  });

  describe('download tickets', () => {
    it('issues a ticket usable without a session and rejects expiry/tampering/other ids', async () => {
      const { uploader, userEvidence, serverEvidence } = await setup();
      const session = await sessionFor(t().deps, uploader);
      const issued = await t().app.inject({
        method: 'POST',
        url: `/api/v1/evidence/${userEvidence.id}/ticket`,
        headers: session.headers,
      });
      expect(issued.statusCode).toBe(200);
      const body = issued.json();
      expect(body.url).toBe(`/api/v1/evidence/${userEvidence.id}/content?ticket=${encodeURIComponent(body.ticket)}`);

      // No cookie, no CSRF — media elements load it directly.
      const download = await t().app.inject({ method: 'GET', url: body.url });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(DATA)).toBe(true);

      // Ticket bound to the evidence id.
      expectError(
        await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${serverEvidence.id}/content?ticket=${encodeURIComponent(body.ticket)}` }),
        401,
        'UNAUTHENTICATED',
      );

      // Tampered signature.
      const tampered = `${body.ticket.slice(0, -2)}zz`;
      expectError(
        await t().app.inject({ method: 'GET', url: `/api/v1/evidence/${userEvidence.id}/content?ticket=${encodeURIComponent(tampered)}` }),
        401,
        'UNAUTHENTICATED',
      );

      // Expired after 60 s.
      t().clock.advanceSeconds(61);
      expectError(await t().app.inject({ method: 'GET', url: body.url }), 401, 'UNAUTHENTICATED');
    });

    it('applies the access rule to ticket issuance', async () => {
      const { userEvidence } = await setup();
      const playerSession = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
      expectError(
        await t().app.inject({ method: 'POST', url: `/api/v1/evidence/${userEvidence.id}/ticket`, headers: playerSession.headers }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('integrity verification (?verify=true)', () => {
    it('confirms an intact object and detects a tampered stored file (audited)', async () => {
      const { userEvidence } = await setup();
      const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);

      const ok = await t().app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${userEvidence.id}?verify=true`,
        headers: { cookie: reviewer.headers.cookie },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().integrity).toMatchObject({ verified: true });

      // Tamper with the stored object on disk (local storage keeps keys as paths).
      const target = path.join(t().storageDir, ...userEvidence.storageKey.split('/'));
      await fs.writeFile(target, Buffer.concat([DATA, Buffer.from('!tampered')]));

      const bad = await t().app.inject({
        method: 'GET',
        url: `/api/v1/evidence/${userEvidence.id}?verify=true`,
        headers: { cookie: reviewer.headers.cookie },
      });
      expect(bad.statusCode).toBe(200);
      expect(bad.json().integrity.verified).toBe(false);
      expect(bad.json().integrity.computed_sha256).not.toBe(bad.json().sha256);

      const audit = await t()
        .db.selectFrom('audit_events')
        .selectAll()
        .where('action', '=', 'EVIDENCE_ACCESSED')
        .where('target_id', '=', userEvidence.id)
        .execute();
      const failed = audit.find((e) => (e.metadata as Record<string, unknown>)['integrity_failed'] === true);
      expect(failed).toBeDefined();
    });

    it('is reviewer-only', async () => {
      const { uploader, userEvidence } = await setup();
      const session = await sessionFor(t().deps, uploader);
      expectError(
        await t().app.inject({
          method: 'GET',
          url: `/api/v1/evidence/${userEvidence.id}?verify=true`,
          headers: { cookie: session.headers.cookie },
        }),
        403,
        'FORBIDDEN',
      );
    });
  });

  it('evidence rows are immutable at the database level (no update route exists)', async () => {
    const { userEvidence } = await setup();
    await expect(
      t()
        .deps.pool.query(`UPDATE evidence SET sha256 = $1 WHERE id = $2`, ['0'.repeat(64), userEvidence.id]),
    ).rejects.toSatisfy((err: unknown) => isForbiddenOperation(err));
  });

  it('review queue listing requires evidence:view and filters by status', async () => {
    const { userEvidence } = await setup();
    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);
    const player = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);

    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/evidence', headers: { cookie: player.headers.cookie } }), 403, 'FORBIDDEN');

    const res = await t().app.inject({ method: 'GET', url: '/api/v1/evidence?status=unverified', headers: { cookie: reviewer.headers.cookie } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(userEvidence.id);
    expect(res.json().total).toBeGreaterThanOrEqual(1);

    const none = await t().app.inject({ method: 'GET', url: '/api/v1/evidence?status=verified', headers: { cookie: reviewer.headers.cookie } });
    expect(none.json().items.map((i: { id: string }) => i.id)).not.toContain(userEvidence.id);
  });
});
