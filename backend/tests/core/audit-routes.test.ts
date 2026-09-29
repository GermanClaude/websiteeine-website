import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { AuditListResponseSchema, AuditVerifyResponseSchema } from '@scpsl-trust/shared';

import { SYSTEM_ACTOR } from '../../src/modules/audit';
import { createPlayer, createServerWithKey, createUser, expectError, sessionFor, useTestApp, type TestSession } from '../helpers';

describe('GET /api/v1/admin/audit and /admin/audit/verify', () => {
  const t = useTestApp();
  let admin: TestSession;
  let serverUuid: string;
  let serverPublicId: string;
  let caseNumber: string;

  beforeAll(async () => {
    const adminUser = (await createUser(t().deps, { role: 'admin', totp: true, username: 'audit_admin' })).user;
    admin = await sessionFor(t().deps, adminUser);
    const srv = await createServerWithKey(t().deps);
    serverUuid = srv.server.id;
    serverPublicId = srv.server.server_id;
    const player = await createPlayer(t().deps);
    caseNumber = 'CASE-2026-000042';
    const created = await t()
      .db.insertInto('cases')
      .values({ case_number: caseNumber, player_id: player.id, reason: 'test case' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const { audit } = t().deps;
    await audit.record(t().db, {
      actor: { actor_type: 'user', actor_id: adminUser.id },
      action: 'SERVER_CREATED',
      target_type: 'server',
      target_id: serverPublicId,
      server_id: serverUuid,
      metadata: { name: srv.server.name },
    });
    t().clock.advance(1_000);
    await audit.record(t().db, {
      actor: { actor_type: 'server', actor_id: serverPublicId },
      action: 'REPORT_CREATED',
      target_type: 'report',
      server_id: serverUuid,
      case_id: created.id,
    });
    t().clock.advance(1_000);
    await audit.record(t().db, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system' });
  });

  const list = (query = '', session: TestSession | null = admin) =>
    t().app.inject({ method: 'GET', url: `/api/v1/admin/audit${query}`, ...(session !== null ? { headers: { cookie: session.cookie } } : {}) });

  it('lists events newest first with actor labels and the documented shape', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    const body = AuditListResponseSchema.parse(res.json());
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.action)).toEqual(['RETENTION_RUN', 'REPORT_CREATED', 'SERVER_CREATED']);
    expect(body.items.map((item) => item.actor_label)).toEqual(['system', serverPublicId, 'audit_admin']);
    expect(body.items[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('filters by action, actor, target, server, case and time range', async () => {
    const byAction = AuditListResponseSchema.parse((await list('?action=REPORT_CREATED')).json());
    expect(byAction.items.map((i) => i.action)).toEqual(['REPORT_CREATED']);

    const byActor = AuditListResponseSchema.parse((await list(`?actor_type=server&actor_id=${serverPublicId}`)).json());
    expect(byActor.total).toBe(1);

    const byTarget = AuditListResponseSchema.parse((await list(`?target_type=server&target_id=${serverPublicId}`)).json());
    expect(byTarget.items.map((i) => i.action)).toEqual(['SERVER_CREATED']);

    const byServer = AuditListResponseSchema.parse((await list(`?server_id=${serverPublicId}`)).json());
    expect(byServer.total).toBe(2);

    const byCase = AuditListResponseSchema.parse((await list(`?case=${caseNumber}`)).json());
    expect(byCase.items.map((i) => i.action)).toEqual(['REPORT_CREATED']);

    const unknownServer = AuditListResponseSchema.parse((await list('?server_id=srv_zzzzzzzzzzzzzzzz')).json());
    expect(unknownServer).toMatchObject({ items: [], total: 0 });

    const now = t().clock.now();
    const recent = AuditListResponseSchema.parse(
      (await list(`?from=${encodeURIComponent(new Date(now.getTime() - 500).toISOString())}`)).json(),
    );
    expect(recent.items.map((i) => i.action)).toEqual(['RETENTION_RUN']);
  });

  it('paginates', async () => {
    const page = AuditListResponseSchema.parse((await list('?page=2&page_size=2')).json());
    expect(page).toMatchObject({ page: 2, page_size: 2, total: 3 });
    expect(page.items).toHaveLength(1);
  });

  it('validates query parameters', async () => {
    expectError(await list('?page_size=1000'), 400, 'VALIDATION_FAILED');
    expectError(await list('?action=DROP_TABLE'), 400, 'VALIDATION_FAILED');
    expectError(await list('?server_id=srv_%27%20OR%201%3D1'), 400, 'VALIDATION_FAILED');
    const error = expectError(await list('?from=2026-10-01T00:00:00Z&to=2026-01-01T00:00:00Z'), 400, 'VALIDATION_FAILED');
    expect(error.details).toEqual([expect.objectContaining({ path: 'querystring.from' })]);
  });

  it('requires audit:view with an enrolled 2FA session', async () => {
    expectError(await list('', null), 401, 'UNAUTHENTICATED');
    const moderator = await sessionFor(t().deps, (await createUser(t().deps, { role: 'moderator', totp: true })).user);
    expectError(await list('', moderator), 403, 'FORBIDDEN');
    const unenrolled = await sessionFor(t().deps, (await createUser(t().deps, { role: 'admin' })).user);
    expectError(await list('', unenrolled), 403, 'MFA_ENROLLMENT_REQUIRED');
  });

  it('verifies the chain and records AUDIT_CHAIN_VERIFIED', async () => {
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/admin/audit/verify', headers: { cookie: admin.cookie } });
    expect(res.statusCode).toBe(200);
    const body = AuditVerifyResponseSchema.parse(res.json());
    expect(body).toMatchObject({ valid: true, checked_events: 3, first_broken_seq: null, failure: null });
    const recorded = AuditListResponseSchema.parse((await list('?action=AUDIT_CHAIN_VERIFIED')).json());
    expect(recorded.items[0]?.metadata).toMatchObject({ valid: true, checked_events: 3 });
  });

  it('reports a broken chain', async () => {
    const victim = await t().db.selectFrom('audit_events').select('seq').orderBy('seq').limit(1).executeTakeFirstOrThrow();
    await sql`ALTER TABLE audit_events DISABLE TRIGGER USER`.execute(t().db);
    try {
      await sql`UPDATE audit_events SET target_id = 'tampered' WHERE seq = ${victim.seq}`.execute(t().db);
    } finally {
      await sql`ALTER TABLE audit_events ENABLE TRIGGER USER`.execute(t().db);
    }
    const res = await t().app.inject({ method: 'GET', url: '/api/v1/admin/audit/verify', headers: { cookie: admin.cookie } });
    const body = AuditVerifyResponseSchema.parse(res.json());
    expect(body).toMatchObject({ valid: false, first_broken_seq: victim.seq, failure: 'hash_mismatch' });
  });

  it('requires audit:verify', async () => {
    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);
    expectError(
      await t().app.inject({ method: 'GET', url: '/api/v1/admin/audit/verify', headers: { cookie: reviewer.cookie } }),
      403,
      'FORBIDDEN',
    );
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/admin/audit/verify?from_seq=0', headers: { cookie: admin.cookie } }), 400, 'VALIDATION_FAILED');
  });
});
