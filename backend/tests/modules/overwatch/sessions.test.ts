/**
 * Overwatch session lifecycle (§10.1): signed start/heartbeat/end, server isolation,
 * secret handling, web views and the expiry/retention jobs.
 */
import { describe, expect, it } from 'vitest';

import { registerJobs } from '../../../src/modules/overwatch';
import { createServerWithKey, createUser, expectError, sessionFor, signedRequest, useTestApp } from '../../helpers';
import { EVIDENCE_MODULES } from '../evidence/helpers';

const TARGET = { type: 'steam', id: '76561198000000001' } as const;
const SPECTATOR = { type: 'steam', id: '76561198000000002' } as const;

describe('overwatch sessions', () => {
  const t = useTestApp({ now: '2026-09-29T15:42:20.000Z', modules: EVIDENCE_MODULES });

  async function startSession(identity: Awaited<ReturnType<typeof createServerWithKey>>, body: Record<string, unknown> = {}) {
    return signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/overwatch/sessions',
      body: { target_player: TARGET, spectator: SPECTATOR, ...body },
    });
  }

  it('starts a session, returns the secret exactly once and stores it encrypted', async () => {
    const identity = await createServerWithKey(t().deps);
    const res = await startSession(identity);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Buffer.from(body.secret, 'base64')).toHaveLength(32);
    expect(body.interval_seconds).toBe(t().config.overwatch.intervalSeconds);
    expect(body.heartbeat_interval_seconds).toBe(30);

    const row = await t().db.selectFrom('overwatch_sessions').selectAll().where('id', '=', body.session_id).executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
    expect(row.secret_enc).not.toBeNull();
    expect(row.secret_enc).not.toContain(body.secret);
    // Decrypts back to the returned secret.
    const secret = t().deps.secretBox.decrypt(row.secret_enc!, `overwatch:${body.session_id}`);
    expect(secret.toString('base64')).toBe(body.secret);
    // Players were upserted.
    const target = await t().db.selectFrom('players').select('id').where('external_id', '=', TARGET.id).executeTakeFirst();
    expect(target).toBeDefined();

    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'OVERWATCH_SESSION_STARTED')
      .where('target_id', '=', body.session_id)
      .executeTakeFirst();
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit!.metadata)).not.toContain(body.secret);
  });

  it('rejects spectator == target and replaces an out-of-range started_at with backend time', async () => {
    const identity = await createServerWithKey(t().deps);
    const same = await startSession(identity, { spectator: TARGET });
    expectError(same, 400, 'VALIDATION_FAILED');

    const drifted = await startSession(identity, { started_at: '2026-09-29T12:00:00.000Z' });
    expect(drifted.statusCode).toBe(201);
    expect(drifted.json().started_at).toBe('2026-09-29T15:42:20.000Z');

    const nearby = await startSession(identity, { started_at: '2026-09-29T15:42:00.000Z' });
    expect(nearby.statusCode).toBe(201);
    expect(nearby.json().started_at).toBe('2026-09-29T15:42:00.000Z');
  });

  it('heartbeats and ends only its own, active sessions', async () => {
    const identity = await createServerWithKey(t().deps);
    const other = await createServerWithKey(t().deps);
    const { session_id } = (await startSession(identity)).json();

    t().clock.advanceSeconds(30);
    const hb = await signedRequest(t().app, identity, {
      method: 'POST',
      url: `/api/v1/overwatch/sessions/${session_id}/heartbeat`,
      body: {},
    });
    expect(hb.statusCode).toBe(200);
    expect(hb.json().last_heartbeat_at).toBe(t().clock.now().toISOString());

    // Another server cannot touch the session (404, no oracle).
    expectError(
      await signedRequest(t().app, other, { method: 'POST', url: `/api/v1/overwatch/sessions/${session_id}/heartbeat`, body: {} }),
      404,
      'NOT_FOUND',
    );
    expectError(
      await signedRequest(t().app, other, {
        method: 'POST',
        url: `/api/v1/overwatch/sessions/${session_id}/end`,
        body: { reason: 'manual' },
      }),
      404,
      'NOT_FOUND',
    );

    const end = await signedRequest(t().app, identity, {
      method: 'POST',
      url: `/api/v1/overwatch/sessions/${session_id}/end`,
      body: { reason: 'target_left' },
    });
    expect(end.statusCode).toBe(200);
    expect(end.json().status).toBe('ended');
    // The end response never carries a secret.
    expect(end.body).not.toContain('secret');

    // Ended sessions accept no further lifecycle calls.
    expectError(
      await signedRequest(t().app, identity, { method: 'POST', url: `/api/v1/overwatch/sessions/${session_id}/heartbeat`, body: {} }),
      409,
      'INVALID_STATE',
    );
    expectError(
      await signedRequest(t().app, identity, { method: 'POST', url: `/api/v1/overwatch/sessions/${session_id}/end`, body: { reason: 'manual' } }),
      409,
      'INVALID_STATE',
    );

    const audit = await t()
      .db.selectFrom('audit_events')
      .select('action')
      .where('target_id', '=', session_id)
      .execute();
    expect(audit.map((a) => a.action)).toContain('OVERWATCH_SESSION_ENDED');
  });

  it('rejects invalid end reasons (backend-only heartbeat_timeout is not a plugin reason)', async () => {
    const identity = await createServerWithKey(t().deps);
    const { session_id } = (await startSession(identity)).json();
    expectError(
      await signedRequest(t().app, identity, {
        method: 'POST',
        url: `/api/v1/overwatch/sessions/${session_id}/end`,
        body: { reason: 'heartbeat_timeout' },
      }),
      400,
      'VALIDATION_FAILED',
    );
  });

  describe('web views', () => {
    it('lists and shows sessions to overwatch:view without ever exposing a secret', async () => {
      const identity = await createServerWithKey(t().deps);
      const { session_id } = (await startSession(identity)).json();
      const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);

      const list = await t().app.inject({
        method: 'GET',
        url: `/api/v1/overwatch/sessions?server_id=${identity.server.server_id}`,
        headers: { cookie: reviewer.headers.cookie },
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.map((i: { id: string }) => i.id)).toContain(session_id);
      expect(list.body).not.toContain('secret');

      const detail = await t().app.inject({
        method: 'GET',
        url: `/api/v1/overwatch/sessions/${session_id}`,
        headers: { cookie: reviewer.headers.cookie },
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: session_id, status: 'active', proof_verifiable: true, effective_end_at: null });
      expect(detail.body).not.toContain('secret');

      const player = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
      expectError(
        await t().app.inject({ method: 'GET', url: '/api/v1/overwatch/sessions', headers: { cookie: player.headers.cookie } }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('jobs', () => {
    it('expires active sessions without a heartbeat and wipes old secrets', async () => {
      const deps = t().deps;
      try {
        registerJobs(deps.scheduler, deps);
      } catch {
        // already registered by a previous test run in this file
      }
      const identity = await createServerWithKey(deps);
      const { session_id } = (await startSession(identity)).json();

      t().clock.advanceSeconds(deps.config.overwatch.heartbeatTimeoutSeconds + 5);
      const outcome = await deps.scheduler.runNow('overwatch-expire-sessions');
      expect(outcome.result).toBe('succeeded');

      const row = await t().db.selectFrom('overwatch_sessions').selectAll().where('id', '=', session_id).executeTakeFirstOrThrow();
      expect(row.status).toBe('expired');
      expect(row.end_reason).toBe('heartbeat_timeout');
      expect(row.secret_enc).not.toBeNull();

      // Secret retention: rows older than the retention window lose their secret, rows stay.
      t().clock.advance(deps.config.retention.overwatchSecretsDays * 86_400_000 + 1000);
      const wipe = await deps.scheduler.runNow('overwatch-wipe-secrets');
      expect(wipe.result).toBe('succeeded');
      const wiped = await t().db.selectFrom('overwatch_sessions').selectAll().where('id', '=', session_id).executeTakeFirstOrThrow();
      expect(wiped.secret_enc).toBeNull();
      expect(wiped.status).toBe('expired');
    });
  });
});
