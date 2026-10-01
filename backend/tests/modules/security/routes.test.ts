/**
 * Security monitor API: RBAC (admin yes, reviewer no), events/blocks/summary, the clear-block
 * action (audited), append-only enforcement and the anomaly review flow.
 */
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { createUser, expectError, sessionFor, useTestApp } from '../../helpers';
import { isForbiddenOperation } from '../../../src/db/errors';
import type { SecuritySource } from '../../../src/modules/security/service';

const NOW = '2026-10-01T12:00:00.000Z';

const t = useTestApp({
  now: NOW,
  env: { SECURITY_DETECTION_ENABLED: 'true', SECURITY_BLOCK_THRESHOLD: '40', SECURITY_BLOCK_TTL_SECONDS: '600' },
});

let adminHeaders: Record<string, string>;
let reviewerHeaders: Record<string, string>;

beforeAll(async () => {
  const { deps } = t();
  const { user: admin } = await createUser(deps, { role: 'admin', totp: true });
  const { user: reviewer } = await createUser(deps, { role: 'reviewer', totp: true });
  adminHeaders = (await sessionFor(deps, admin)).headers;
  reviewerHeaders = (await sessionFor(deps, reviewer)).headers;
});

async function blockSource(ref = 'aa'.repeat(32)): Promise<SecuritySource> {
  const source: SecuritySource = { type: 'network', ref };
  await t().deps.security.observeSignal(source, 'invalid_signature');
  await t().deps.security.observeSignal(source, 'invalid_signature');
  return source;
}

describe('security monitor RBAC', () => {
  it('forbids reviewers from reading or acting; allows admins', async () => {
    const { app } = t();
    expectError(await app.inject({ method: 'GET', url: '/api/v1/admin/security/events', headers: reviewerHeaders }), 403, 'FORBIDDEN');
    expectError(await app.inject({ method: 'GET', url: '/api/v1/admin/security/summary', headers: reviewerHeaders }), 403, 'FORBIDDEN');

    const ok = await app.inject({ method: 'GET', url: '/api/v1/admin/security/events', headers: adminHeaders });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ page: 1, items: expect.any(Array) });
  });

  it('requires authentication', async () => {
    expectError(await t().app.inject({ method: 'GET', url: '/api/v1/admin/security/events' }), 401, 'UNAUTHENTICATED');
  });
});

describe('security monitor views', () => {
  it('lists events and active blocks and summarises them', async () => {
    const { app } = t();
    const source = await blockSource('bb'.repeat(32));

    const events = await app.inject({ method: 'GET', url: '/api/v1/admin/security/events?kind=source_blocked', headers: adminHeaders });
    expect(events.statusCode).toBe(200);
    const eventsBody = events.json() as { items: Array<{ kind: string; source_ref: string; action_taken: string }> };
    expect(eventsBody.items.some((e) => e.kind === 'source_blocked' && e.source_ref === source.ref)).toBe(true);

    const blocks = await app.inject({ method: 'GET', url: '/api/v1/admin/security/blocks', headers: adminHeaders });
    const blocksBody = blocks.json() as { items: Array<{ id: string; source_ref: string; ttl_seconds: number; strikes: number }> };
    const block = blocksBody.items.find((b) => b.source_ref === source.ref);
    expect(block).toBeDefined();
    expect(block?.id).toBe(`network.${source.ref}`);
    expect(block?.ttl_seconds).toBeGreaterThan(0);

    const summary = await app.inject({ method: 'GET', url: '/api/v1/admin/security/summary', headers: adminHeaders });
    const s = summary.json() as {
      events_last_24h: Record<string, number>;
      active_blocks: number;
      detection_enabled: boolean;
      top_sources: unknown[];
    };
    expect(s.detection_enabled).toBe(true);
    expect(s.active_blocks).toBeGreaterThanOrEqual(1);
    expect(Object.keys(s.events_last_24h).sort()).toEqual(['critical', 'high', 'info', 'low', 'medium']);
  });
});

describe('clear block', () => {
  it('reviewer cannot clear; admin can, and the clear is audited', async () => {
    const { app, deps } = t();
    const source = await blockSource('cc'.repeat(32));
    const id = `network.${source.ref}`;

    expectError(
      await app.inject({ method: 'POST', url: `/api/v1/admin/security/blocks/${id}/clear`, headers: reviewerHeaders, payload: {} }),
      403,
      'FORBIDDEN',
    );

    const cleared = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/security/blocks/${id}/clear`,
      headers: adminHeaders,
      payload: { reason: 'confirmed false positive' },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ ok: true, cleared: true, source_type: 'network', source_ref: source.ref });

    // No longer blocked, unblock event + audit recorded.
    expect(await deps.security.isBlocked(source)).toBe(false);
    const unblock = await deps.db
      .selectFrom('security_events')
      .select('kind')
      .where('kind', '=', 'source_unblocked')
      .where('source_ref', '=', source.ref)
      .executeTakeFirst();
    expect(unblock).toBeDefined();
    const audit = await deps.db
      .selectFrom('audit_events')
      .select('action')
      .where('action', '=', 'SECURITY_SOURCE_UNBLOCKED')
      .where('target_id', '=', source.ref)
      .executeTakeFirst();
    expect(audit).toBeDefined();
  });
});

describe('append-only enforcement', () => {
  it('blocks UPDATE and DELETE on security_events', async () => {
    const { deps } = t();
    const row = await deps.db
      .insertInto('security_events')
      .values({ kind: 'anomaly', severity: 'low', source_type: 'user', source_ref: 'x', action_taken: 'flagged' })
      .returning('id')
      .executeTakeFirstOrThrow();

    const update = sql`UPDATE security_events SET severity = 'high' WHERE id = ${row.id}`.execute(deps.db);
    await expect(update).rejects.toSatisfy((err: unknown) => isForbiddenOperation(err, 'security_events'));

    const del = deps.db.deleteFrom('security_events').where('id', '=', row.id).execute();
    await expect(del).rejects.toSatisfy((err: unknown) => isForbiddenOperation(err, 'security_events'));
  });
});

describe('anomaly flagging', () => {
  it('flags a planted deviation and surfaces it as a review event', async () => {
    const { deps, app } = t();
    const key = 'user.quiet-reviewer';
    const now = deps.clock.now();
    for (let i = 0; i < 10; i += 1) {
      await deps.security.evaluateAnomalyInterval(new Map([[key, 10]]), now);
    }
    const flags = await deps.security.evaluateAnomalyInterval(new Map([[key, 300]]), now);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.severity === 'high' || flags[0]?.severity === 'medium').toBe(true);

    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/security/events?kind=anomaly', headers: adminHeaders });
    const body = res.json() as { items: Array<{ kind: string; source_type: string; action_taken: string }> };
    expect(body.items.some((e) => e.kind === 'anomaly' && e.source_type === 'user' && e.action_taken === 'flagged')).toBe(true);
  });
});
