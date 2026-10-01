/**
 * Intrusion detection, scoring and transient auto-blocking (server-side only).
 *
 * Verifies: scoring crosses the threshold -> block -> a subsequent request is answered 429
 * before the handler; blocks auto-expire; exponential backoff on repeat; injection probes are
 * low weight and never block alone; detection can be disabled by config; and a store outage
 * fails open (no 500s, normal traffic still 200). No raw IP is ever written.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, expectError, useTestApp } from '../../helpers';
import { storeKeys } from '../../../src/redis/keys';
import type { SecuritySource } from '../../../src/modules/security/service';

const NOW = '2026-10-01T12:00:00.000Z';
const ATTACKER_IP = '203.0.113.5';
const INNOCENT_IP = '198.51.100.9';

function pingRoute(app: FastifyInstance): void {
  app.get('/sec-test/ping', async () => ({ ok: true }));
}

const t = useTestApp({
  now: NOW,
  env: {
    SECURITY_BLOCK_THRESHOLD: '40',
    SECURITY_WINDOW_SECONDS: '300',
    SECURITY_BLOCK_TTL_SECONDS: '10',
    SECURITY_BURST_PER_MINUTE: '100000',
  },
  extend: pingRoute,
});

function ping(ip: string) {
  return t().app.inject({ method: 'GET', url: '/sec-test/ping', remoteAddress: ip });
}

function scoreKey(source: SecuritySource): string {
  return storeKeys.securityScore(`${source.type}.${source.ref}`);
}

describe('intrusion detection', () => {
  it('scores signals, blocks on crossing the threshold and answers 429 before the handler', async () => {
    const { deps } = t();
    const source = deps.security.networkSource(ATTACKER_IP);

    // A normal request from this source succeeds first.
    expect((await ping(ATTACKER_IP)).statusCode).toBe(200);

    // Two invalid-signature signals (weight 25 each) cross the threshold of 40.
    await deps.security.observeSignal(source, 'invalid_signature');
    await deps.security.observeSignal(source, 'invalid_signature');

    const blocked = await ping(ATTACKER_IP);
    expectError(blocked, 429, 'RATE_LIMITED');

    // A different source is unaffected.
    expect((await ping(INNOCENT_IP)).statusCode).toBe(200);

    // The block and the crossed threshold are in the queryable events table.
    const events = await deps.db.selectFrom('security_events').select(['kind', 'action_taken']).execute();
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('threshold_exceeded');
    expect(kinds).toContain('source_blocked');
  });

  it('auto-expires the block after its TTL', async () => {
    const { deps, clock } = t();
    const ip = '203.0.113.20';
    const source = deps.security.networkSource(ip);
    await deps.security.observeSignal(source, 'invalid_signature');
    await deps.security.observeSignal(source, 'invalid_signature');
    expectError(await ping(ip), 429, 'RATE_LIMITED');

    clock.advance(11_000); // TTL is 10s
    expect((await ping(ip)).statusCode).toBe(200);
  });

  it('applies exponential backoff on repeat offences', async () => {
    const { deps, clock } = t();
    const ip = '203.0.113.30';
    const source = deps.security.networkSource(ip);

    await deps.security.observeSignal(source, 'invalid_signature');
    await deps.security.observeSignal(source, 'invalid_signature');
    const first = (await deps.security.listActiveBlocks()).find((b) => b.source_ref === source.ref);
    expect(first?.ttl_seconds).toBeGreaterThan(0);

    clock.advance(11_000); // first block (10s) expires
    await deps.security.observeSignal(source, 'invalid_signature');
    await deps.security.observeSignal(source, 'invalid_signature');
    const second = (await deps.security.listActiveBlocks()).find((b) => b.source_ref === source.ref);

    expect(second?.strikes).toBe(2);
    expect(second?.ttl_seconds ?? 0).toBeGreaterThan(first?.ttl_seconds ?? 0);
  });

  it('treats injection probes as low weight and never blocks on them alone', async () => {
    const { deps } = t();
    const ip = '203.0.113.40';
    const source = deps.security.networkSource(ip);

    // Four path-traversal probes: 4 x weight 8 = 32, below the threshold of 40.
    for (let i = 0; i < 4; i += 1) {
      const res = await t().app.inject({ method: 'GET', url: '/sec-test/ping?x=../../../etc/passwd', remoteAddress: ip });
      expect(res.statusCode).toBe(200);
    }
    expect((await ping(ip)).statusCode).toBe(200); // still not blocked

    const score = Number((await deps.store.get(scoreKey(source))) ?? '0');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(40);
  });

  it('never writes a raw IP into the events table or audit metadata', async () => {
    const { deps } = t();
    const ip = '203.0.113.77';
    const source = deps.security.networkSource(ip);
    await deps.security.observeSignal(source, 'invalid_signature');
    await deps.security.observeSignal(source, 'invalid_signature');

    const events = await deps.db.selectFrom('security_events').selectAll().execute();
    const audits = await deps.db.selectFrom('audit_events').selectAll().execute();
    const haystack = JSON.stringify(events) + JSON.stringify(audits);
    expect(haystack).not.toContain(ip);
    // The recorded source is the HMAC network hash, not the address.
    const row = events.find((e) => e.source_ref === source.ref);
    expect(row).toBeDefined();
    expect(source.ref).not.toBe(ip);
    expect(source.ref).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('intrusion detection configuration', () => {
  it('is a no-op when detection is disabled', async () => {
    const app = await buildTestApp({
      now: NOW,
      env: { SECURITY_DETECTION_ENABLED: 'false', SECURITY_BLOCK_THRESHOLD: '40' },
      extend: pingRoute,
    });
    try {
      const source = app.deps.security.networkSource(ATTACKER_IP);
      await app.deps.security.observeSignal(source, 'invalid_signature');
      await app.deps.security.observeSignal(source, 'invalid_signature');
      const res = await app.app.inject({ method: 'GET', url: '/sec-test/ping', remoteAddress: ATTACKER_IP });
      expect(res.statusCode).toBe(200);
      const events = await app.db.selectFrom('security_events').selectAll().execute();
      expect(events).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('fails open when the short-lived store is unavailable (no 500s, traffic still 200)', async () => {
    const app = await buildTestApp({
      now: NOW,
      env: { SECURITY_BLOCK_THRESHOLD: '40' },
      extend: pingRoute,
    });
    try {
      const boom = async (): Promise<never> => {
        throw new Error('redis down');
      };
      const store = app.deps.store as unknown as Record<string, unknown>;
      for (const method of ['get', 'set', 'setNx', 'del', 'getDel', 'incr', 'incrBy', 'ttl', 'delIfEquals']) {
        store[method] = boom;
      }
      // Signals cannot be scored (store down) but must not throw.
      const source = app.deps.security.networkSource(ATTACKER_IP);
      await expect(app.deps.security.observeSignal(source, 'invalid_signature')).resolves.toBeUndefined();
      await expect(app.deps.security.isBlocked(source)).resolves.toBe(false);

      const res = await app.app.inject({ method: 'GET', url: '/sec-test/ping', remoteAddress: ATTACKER_IP });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
