/**
 * Spec compliance (REQUIREMENTS §9/§13/§18, rules R1–R6): report counts, server confirmations,
 * VPN/young-account/alt signals and proof verifications are information only and never change a
 * case verdict or create a case.
 */
import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createServerWithKey, createUser, loginAs, randomSteamId, signedRequest, useTestApp } from '../helpers';

const cidrFile = `${process.env.TMPDIR ?? '/tmp'}/scpsl-spec-vpn-${process.pid}.txt`;
writeFileSync(cidrFile, '45.132.88.0/24\n');

const t = useTestApp({
  now: '2026-09-29T12:00:00.000Z',
  env: { VPN_PROVIDERS: 'cidr-list', VPN_CIDR_LIST_PATHS: cidrFile },
});

async function caseState(caseNumber: string) {
  return t()
    .db.selectFrom('cases')
    .select(['current_verdict', 'status', 'verdict_set_by'])
    .where('case_number', '=', caseNumber)
    .executeTakeFirstOrThrow();
}

describe('verdicts are evidence-driven only', () => {
  it('many reports + many server confirmations never change the verdict', async () => {
    const player = { type: 'steam' as const, id: randomSteamId() };
    let caseNumber = '';
    for (let i = 0; i < 5; i++) {
      const { user } = await createUser(t().deps);
      const session = await loginAs(t().app, user);
      const res = await t().app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        headers: session.headers,
        body: { player, reason: `aimbot ${i}` },
      });
      expect(res.statusCode).toBe(201);
      caseNumber = res.json().case_id;
    }
    const servers = [];
    for (let i = 0; i < 3; i++) {
      const identity = await createServerWithKey(t().deps);
      servers.push(identity);
      const res = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/server/reports',
        body: { player, reason: 'aimbot from server' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().case_id).toBe(caseNumber);
    }
    expect(await caseState(caseNumber)).toMatchObject({ current_verdict: 'unknown', status: 'open', verdict_set_by: null });

    // Move to review, then 3 servers confirm.
    const { user: reviewer } = await createUser(t().deps, { role: 'reviewer', totp: true });
    const rs = await loginAs(t().app, reviewer);
    const start = await t().app.inject({
      method: 'POST',
      url: `/api/v1/cases/${caseNumber}/reviews/start`,
      headers: rs.headers,
      body: { comment: 'starting review' },
    });
    expect(start.statusCode).toBe(200);
    for (const s of servers) {
      const os = await loginAs(t().app, s.owner);
      const res = await t().app.inject({
        method: 'POST',
        url: `/api/v1/cases/${caseNumber}/confirmations`,
        headers: os.headers,
        body: { server_id: s.server.server_id, note: null },
      });
      expect(res.statusCode).toBe(201);
    }
    expect(await caseState(caseNumber)).toMatchObject({ current_verdict: 'unknown', status: 'under_review', verdict_set_by: null });

    // Player check reports the counts but the verdict stays unknown (information only).
    const check = await signedRequest(t().app, servers[0]!, {
      method: 'POST',
      url: '/api/v1/player/check',
      body: { player },
    });
    const body = check.json();
    expect(body.reports).toBe(8);
    expect(body.confirmed_servers).toBe(3);
    expect(body.global_status).toBe('under_review');
    expect(body).not.toHaveProperty('action');
    expect(body.cases[0].verdict).toBe('unknown');
  });

  it('VPN, young account and shared network never create a case or verdict', async () => {
    const identity = await createServerWithKey(t().deps);
    const a = { type: 'steam' as const, id: randomSteamId() };
    const b = { type: 'steam' as const, id: randomSteamId() };
    for (const p of [a, b]) {
      const res = await signedRequest(t().app, identity, {
        method: 'POST',
        url: '/api/v1/player/check',
        body: { player: p, ip: '45.132.88.9', account_created_at: '2026-09-28T00:00:00.000Z' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.vpn.detected).toBe(true);
      expect(body.global_status).toBe('none');
      expect(body.cases).toEqual([]);
    }
    const players = await t()
      .db.selectFrom('players')
      .select('id')
      .where('external_id', 'in', [a.id, b.id])
      .execute();
    const cases = await t()
      .db.selectFrom('cases')
      .select('id')
      .where(
        'player_id',
        'in',
        players.map((p) => p.id),
      )
      .execute();
    expect(cases).toHaveLength(0);
    // Raw IP never persisted anywhere in the signal tables.
    const obs = await t().db.selectFrom('player_network_observations').selectAll().execute();
    const sig = await t().db.selectFrom('player_signals').selectAll().execute();
    const audit = await t().db.selectFrom('audit_events').selectAll().execute();
    expect(JSON.stringify([obs, sig, audit])).not.toContain('45.132.88.9');
  });

  it('the audit chain stays valid', async () => {
    const result = await t().deps.audit.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.checked).toBeGreaterThan(0);
  });
});
