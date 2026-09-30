/**
 * Overwatch proof verification (§10.2/§10.3, R6): shared test vectors, window drift,
 * session bounds, code disclosure rules, secret retention and the rate limit.
 */
import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildProofMessage, proofCodeFromMac, proofWindowFromMs } from '@scpsl-trust/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const vectors = JSON.parse(
  readFileSync(path.resolve(process.cwd(), '../shared/test-vectors/proof-codes.json'), 'utf8'),
) as { cases: Vector[] };

import type { Deps } from '../../../src/container';
import { buildTestApp, createPlayer, createServerWithKey, createUser, expectError, sessionFor, useTestApp } from '../../helpers';
import { EVIDENCE_MODULES } from '../evidence/helpers';

interface Vector {
  secret_b64: string;
  session_id: string;
  server_id: string;
  target_user_id: string;
  spectator_user_id: string;
  unix_seconds: number;
  interval_seconds: number;
  window: number;
  code: string;
}

const vector = (vectors as { cases: Vector[] }).cases[0]!;
const NOW_MS = vector.unix_seconds * 1000;

function codeFor(secret: Buffer, sessionId: string, serverId: string, window: number): string {
  const message = buildProofMessage({
    sessionId,
    serverId,
    targetUserId: vector.target_user_id,
    spectatorUserId: vector.spectator_user_id,
    window,
  });
  return proofCodeFromMac(createHmac('sha256', secret).update(message, 'utf8').digest());
}

/**
 * Creates the vector's server/players/session once per file (the session id is part of the
 * proof message, so there can only be one such row) and resets it to a canonical active
 * state before every test.
 */
let seeded: { serverUuid: string } | null = null;

async function seedVectorSession(deps: Deps): Promise<{ serverUuid: string }> {
  if (seeded === null) {
    const identity = await createServerWithKey(deps);
    await deps.db.updateTable('servers').set({ server_id: vector.server_id }).where('id', '=', identity.server.id).execute();
    const target = await createPlayer(deps, { type: 'steam', id: vector.target_user_id.split('@')[0]! });
    const spectator = await createPlayer(deps, { type: 'steam', id: vector.spectator_user_id.split('@')[0]! });
    const now = deps.clock.now();
    await deps.db
      .insertInto('overwatch_sessions')
      .values({
        id: vector.session_id,
        server_id: identity.server.id,
        target_player_id: target.id,
        spectator_player_id: spectator.id,
        interval_seconds: vector.interval_seconds,
        status: 'active',
        started_at: new Date(now.getTime() - 300_000),
        last_heartbeat_at: now,
        created_at: now,
      })
      .execute();
    seeded = { serverUuid: identity.server.id };
  }
  await deps.db
    .updateTable('overwatch_sessions')
    .set({
      status: 'active',
      ended_at: null,
      end_reason: null,
      last_heartbeat_at: deps.clock.now(),
      secret_enc: deps.secretBox.encrypt(Buffer.from(vector.secret_b64, 'base64'), `overwatch:${vector.session_id}`),
    })
    .where('id', '=', vector.session_id)
    .execute();
  return seeded;
}

function proofUrl(params: Record<string, string | number>): string {
  const q = new URLSearchParams(
    Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  );
  return `/api/v1/evidence/proof?${q.toString()}`;
}

const baseQuery = {
  server_id: vector.server_id,
  player_id: vector.target_user_id,
  spectator_id: vector.spectator_user_id,
  timestamp: NOW_MS,
};

describe('proof verification', () => {
  const t = useTestApp({ now: new Date(NOW_MS).toISOString(), modules: EVIDENCE_MODULES });

  it('accepts the shared test-vector code in its window and reports the window', async () => {
    await seedVectorSession(t().deps);
    const res = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code: vector.code }) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.session_id).toBe(vector.session_id);
    expect(body.window_offset).toBe(0);
    expect(body.timestamp_window.start).toBe(new Date(vector.window * vector.interval_seconds * 1000).toISOString());
    // Anonymous callers never receive the expected code.
    expect(body.code).toBeUndefined();
    expect(body.reason).toBeUndefined();

    // PROOF_VERIFIED audited as system/anonymous.
    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'PROOF_VERIFIED')
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('system');
    expect(audit.actor_id).toBeNull();
    expect((audit.metadata as Record<string, unknown>)['anonymous']).toBe(true);
    expect((audit.metadata as Record<string, unknown>)['valid']).toBe(true);
  });

  it('accepts ±1 window drift (reporting the offset) and rejects ±2', async () => {
    await seedVectorSession(t().deps);
    const secret = Buffer.from(vector.secret_b64, 'base64');
    const w = proofWindowFromMs(NOW_MS, vector.interval_seconds);
    expect(w).toBe(vector.window);

    for (const offset of [-1, 1] as const) {
      const code = codeFor(secret, vector.session_id, vector.server_id, w + offset);
      const res = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code }) });
      expect(res.json().valid).toBe(true);
      expect(res.json().window_offset).toBe(offset);
    }
    for (const offset of [-2, 2]) {
      const code = codeFor(secret, vector.session_id, vector.server_id, w + offset);
      const res = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code }) });
      expect(res.json().valid).toBe(false);
      expect(res.json().session_id).toBeUndefined();
    }
  });

  it('rejects timestamps before the session start and after the effective end', async () => {
    await seedVectorSession(t().deps);
    const secret = Buffer.from(vector.secret_b64, 'base64');

    const before = NOW_MS - 400_000; // session started NOW-300s
    const wBefore = proofWindowFromMs(before, vector.interval_seconds);
    const resBefore = await t().app.inject({
      method: 'GET',
      url: proofUrl({ ...baseQuery, timestamp: before, code: codeFor(secret, vector.session_id, vector.server_id, wBefore) }),
    });
    expect(resBefore.json().valid).toBe(false);

    // End the session; the effective end is ended_at.
    await t().db.updateTable('overwatch_sessions').set({ status: 'ended', ended_at: new Date(NOW_MS - 60_000), end_reason: 'manual' }).where('id', '=', vector.session_id).execute();
    const resAfter = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code: vector.code }) });
    expect(resAfter.json().valid).toBe(false);

    // An expired session is valid up to last_heartbeat_at + interval.
    await t()
      .db.updateTable('overwatch_sessions')
      .set({ status: 'expired', ended_at: null, end_reason: 'heartbeat_timeout', last_heartbeat_at: new Date(NOW_MS - 5_000) })
      .where('id', '=', vector.session_id)
      .execute();
    const resExpired = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code: vector.code }) });
    expect(resExpired.json().valid).toBe(true);

    await t()
      .db.updateTable('overwatch_sessions')
      .set({ last_heartbeat_at: new Date(NOW_MS - 60_000) })
      .where('id', '=', vector.session_id)
      .execute();
    const resLate = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code: vector.code }) });
    expect(resLate.json().valid).toBe(false);
  });

  it('rejects wrong server, target or spectator without an oracle', async () => {
    await seedVectorSession(t().deps);
    const otherServer = await createServerWithKey(t().deps);
    for (const params of [
      { ...baseQuery, server_id: otherServer.server.server_id },
      { ...baseQuery, player_id: '76561198000000009@steam' },
      { ...baseQuery, spectator_id: '76561198000000009@steam' },
    ]) {
      const res = await t().app.inject({ method: 'GET', url: proofUrl({ ...params, code: vector.code }) });
      expect(res.statusCode).toBe(200);
      expect(res.json().valid).toBe(false);
      expect(res.json().session_id).toBeUndefined();
      expect(res.json().code).toBeUndefined();
    }
  });

  it('requires a code for callers without proof:view_code and never reveals the expected code to them', async () => {
    await seedVectorSession(t().deps);
    const player = await sessionFor(t().deps, (await createUser(t().deps, { role: 'player' })).user);
    expectError(
      await t().app.inject({ method: 'GET', url: proofUrl(baseQuery), headers: { cookie: player.headers.cookie } }),
      400,
      'VALIDATION_FAILED',
    );
    const withCode = await t().app.inject({
      method: 'GET',
      url: proofUrl({ ...baseQuery, code: vector.code }),
      headers: { cookie: player.headers.cookie },
    });
    expect(withCode.json().valid).toBe(true);
    expect(withCode.json().code).toBeUndefined();
  });

  it('gives reviewers the expected code (matching the vector), even without a supplied code', async () => {
    await seedVectorSession(t().deps);
    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);
    const res = await t().app.inject({ method: 'GET', url: proofUrl(baseQuery), headers: { cookie: reviewer.headers.cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().valid).toBe(true);
    expect(res.json().code).toBe(vector.code);
    expect(res.json().session_id).toBe(vector.session_id);

    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'PROOF_VERIFIED')
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('user');
  });

  it('reports secret_expired only to reviewers once the secret was wiped', async () => {
    await seedVectorSession(t().deps);
    await t().db.updateTable('overwatch_sessions').set({ secret_enc: null }).where('id', '=', vector.session_id).execute();

    const anon = await t().app.inject({ method: 'GET', url: proofUrl({ ...baseQuery, code: vector.code }) });
    expect(anon.json().valid).toBe(false);
    expect(anon.json().reason).toBeUndefined();

    const reviewer = await sessionFor(t().deps, (await createUser(t().deps, { role: 'reviewer', totp: true })).user);
    const res = await t().app.inject({ method: 'GET', url: proofUrl(baseQuery), headers: { cookie: reviewer.headers.cookie } });
    expect(res.json().valid).toBe(false);
    expect(res.json().reason).toBe('secret_expired');
    expect(res.json().code).toBeUndefined();
  });
});

describe('proof rate limit', () => {
  it('answers 429 above PROOF_RATE_LIMIT_PER_MINUTE per IP', async () => {
    const app = await buildTestApp({
      now: new Date(NOW_MS).toISOString(),
      modules: EVIDENCE_MODULES,
      env: { PROOF_RATE_LIMIT_PER_MINUTE: '2' },
    });
    try {
      const url = proofUrl({ ...baseQuery, code: vector.code });
      expect((await app.app.inject({ method: 'GET', url })).statusCode).toBe(200);
      expect((await app.app.inject({ method: 'GET', url })).statusCode).toBe(200);
      expectError(await app.app.inject({ method: 'GET', url }), 429, 'RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});
