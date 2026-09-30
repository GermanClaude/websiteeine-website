/**
 * Evidence uploads (§11.3): streamed hashing, size limit, MIME sniffing, filename
 * sanitization, link evidence, and the upload permission matrix.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createServerWithKey, createUser, expectError, sessionFor, useTestApp } from '../../helpers';
import { addReport, createCase, EVIDENCE_MODULES, multipartPayload, pngBytes } from './helpers';

describe('evidence uploads', () => {
  // Small limit so the 413 test does not need a large payload (min allowed is 1024).
  const t = useTestApp({
    now: '2026-09-29T15:42:20.000Z',
    modules: EVIDENCE_MODULES,
    env: { EVIDENCE_MAX_BYTES: '1024' },
  });

  async function reviewerSession() {
    const { user } = await createUser(t().deps, { role: 'reviewer', totp: true });
    return { user, session: await sessionFor(t().deps, user) };
  }

  function upload(caseNumber: string, headers: Record<string, string>, fields: Record<string, string>, file: Parameters<typeof multipartPayload>[1]) {
    const { payload, headers: mp } = multipartPayload(fields, file);
    return t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseNumber}/evidence`,
      headers: { ...headers, ...mp },
      payload,
    });
  }

  const pngFields = { type: 'image', title: 'Screenshot' };

  it('streams, hashes and stores a PNG upload (audited)', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const data = pngBytes(100);
    const res = await upload(caseRow.case_number, session.headers, pngFields, {
      filename: 'shot.png',
      contentType: 'image/png',
      data,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.sha256).toBe(createHash('sha256').update(data).digest('hex'));
    expect(body.size_bytes).toBe(data.length);
    expect(body.mime_type).toBe('image/png');
    expect(body.type).toBe('image');
    expect(body.case_number).toBe(caseRow.case_number);
    expect(body.status).toBe('unverified');

    const { storage_key } = await t()
      .db.selectFrom('evidence')
      .select('storage_key')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    const stored = await t().deps.storage.get(storage_key!);
    const chunks: Buffer[] = [];
    for await (const c of stored) chunks.push(c as Buffer);
    expect(createHash('sha256').update(Buffer.concat(chunks)).digest('hex')).toBe(body.sha256);

    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'EVIDENCE_UPLOADED')
      .where('target_id', '=', body.id)
      .executeTakeFirst();
    expect(audit).toBeDefined();
    expect((audit!.metadata as Record<string, unknown>)['sha256']).toBe(body.sha256);
    expect(audit!.case_id).toBe(caseRow.id);
  });

  it('sanitizes hostile filenames', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, pngFields, {
      filename: '..\\..\\e vil<>%00 name?.png',
      contentType: 'image/png',
      data: pngBytes(10),
    });
    expect(res.statusCode).toBe(201);
    const filename = res.json().original_filename as string;
    expect(filename).not.toMatch(/[/\\<>?%\u0000]/);
    expect(filename).not.toContain('..');
    expect(filename.endsWith('.png')).toBe(true);
  });

  it('rejects uploads over EVIDENCE_MAX_BYTES with 413', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, pngFields, {
      filename: 'big.png',
      contentType: 'image/png',
      data: pngBytes(2000),
    });
    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
    expect(await t().db.selectFrom('evidence').select('id').where('case_id', '=', caseRow.id).execute()).toHaveLength(0);
  });

  it('rejects content that does not match the declared type (HTML as video/mp4) with 415', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, { type: 'video', title: 'clip' }, {
      filename: 'clip.mp4',
      contentType: 'video/mp4',
      data: Buffer.from('<html><body>not a video</body></html>', 'utf8'),
    });
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a PNG declared as image/jpeg with 415', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, pngFields, {
      filename: 'shot.jpg',
      contentType: 'image/jpeg',
      data: pngBytes(10),
    });
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects disallowed declared types with 415', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, { type: 'other', title: 'page' }, {
      filename: 'page.html',
      contentType: 'text/html',
      data: Buffer.from('<html></html>', 'utf8'),
    });
    expectError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('accepts valid UTF-8 text/plain but rejects NUL bytes and binary-sniffing text', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);

    const ok = await upload(caseRow.case_number, session.headers, { type: 'log', title: 'log' }, {
      filename: 'log.txt',
      contentType: 'text/plain',
      data: Buffer.from('hello wörld\nline 2', 'utf8'),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().mime_type).toBe('text/plain');

    const withNul = await upload(caseRow.case_number, session.headers, { type: 'log', title: 'log' }, {
      filename: 'log.txt',
      contentType: 'text/plain',
      data: Buffer.from('hello\u0000world', 'utf8'),
    });
    expectError(withNul, 415, 'UNSUPPORTED_MEDIA_TYPE');

    const pngAsText = await upload(caseRow.case_number, session.headers, { type: 'log', title: 'log' }, {
      filename: 'log.txt',
      contentType: 'text/plain',
      data: pngBytes(10),
    });
    expectError(pngAsText, 415, 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('validates the multipart fields with the shared schema', async () => {
    const { session } = await reviewerSession();
    const { caseRow } = await createCase(t().deps);
    const res = await upload(caseRow.case_number, session.headers, { type: 'link', title: 'nope' }, {
      filename: 'x.png',
      contentType: 'image/png',
      data: pngBytes(10),
    });
    expectError(res, 400, 'VALIDATION_FAILED');
  });

  it('404s for an unknown case and 401s anonymously', async () => {
    const { session } = await reviewerSession();
    const missing = await upload('CASE-2026-999999', session.headers, pngFields, {
      filename: 'x.png',
      contentType: 'image/png',
      data: pngBytes(10),
    });
    expectError(missing, 404, 'NOT_FOUND');

    const { payload, headers } = multipartPayload(pngFields, { filename: 'x.png', contentType: 'image/png', data: pngBytes(10) });
    const anon = await t().app.inject({ method: 'POST', url: '/api/v1/cases/CASE-2026-000001/evidence', headers, payload });
    expectError(anon, 401, 'UNAUTHENTICATED');
  });

  describe('upload permission matrix', () => {
    const file = () => ({ filename: 'x.png', contentType: 'image/png', data: pngBytes(10) });

    it('allows the user who reported on the case', async () => {
      const { user } = await createUser(t().deps, { role: 'player' });
      const session = await sessionFor(t().deps, user);
      const { caseRow } = await createCase(t().deps);
      await addReport(t().deps, caseRow, { userId: user.id });
      const res = await upload(caseRow.case_number, session.headers, pngFields, file());
      expect(res.statusCode).toBe(201);
    });

    it('allows owner/admin/moderator members of a server that reported on the case', async () => {
      const identity = await createServerWithKey(t().deps);
      const { user: memberUser } = await createUser(t().deps, { role: 'player' });
      await t()
        .db.insertInto('server_members')
        .values({ server_id: identity.server.id, user_id: memberUser.id, role: 'moderator', created_by: identity.owner.id, created_at: t().clock.now() })
        .execute();
      const { caseRow } = await createCase(t().deps);
      await addReport(t().deps, caseRow, { serverUuid: identity.server.id });
      const session = await sessionFor(t().deps, memberUser);
      const res = await upload(caseRow.case_number, session.headers, pngFields, file());
      expect(res.statusCode).toBe(201);
    });

    it('forbids unrelated players and admins of unrelated servers', async () => {
      const { caseRow } = await createCase(t().deps);
      const identity = await createServerWithKey(t().deps); // never reported on the case
      const { user: player } = await createUser(t().deps, { role: 'player' });

      const playerSession = await sessionFor(t().deps, player);
      expectError(await upload(caseRow.case_number, playerSession.headers, pngFields, file()), 403, 'FORBIDDEN');

      const ownerSession = await sessionFor(t().deps, identity.owner);
      expectError(await upload(caseRow.case_number, ownerSession.headers, pngFields, file()), 403, 'FORBIDDEN');
    });
  });

  describe('link evidence', () => {
    it('creates https link evidence and rejects http', async () => {
      const { session } = await reviewerSession();
      const { caseRow } = await createCase(t().deps);
      const ok = await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseRow.case_number}/evidence/link`,
        headers: session.headers,
        payload: { url: 'https://example.org/clip', title: 'External clip' },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().type).toBe('link');
      expect(ok.json().sha256).toBeNull();
      expect(ok.json().external_url).toBe('https://example.org/clip');

      const bad = await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseRow.case_number}/evidence/link`,
        headers: session.headers,
        payload: { url: 'http://example.org/clip', title: 'External clip' },
      });
      expectError(bad, 400, 'VALIDATION_FAILED');
    });
  });
});
