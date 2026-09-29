import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { AUDIT_GENESIS_PREV_HASH, canonicalJson, toAuditHashableEvent, type AuditHashableEvent } from '@scpsl-trust/shared';

import { withTransaction } from '../../src/db/tx';
import { sha256Hex } from '../../src/lib/crypto';
import { computeAuditHash, SYSTEM_ACTOR } from '../../src/modules/audit';
import { isSensitiveKey, REDACTED, sanitizeAuditMetadata } from '../../src/modules/audit/sanitize';
import { createPlayer, createServerWithKey, createUser, useTestApp, type TestApp } from '../helpers';

interface ChainVector {
  event_without_hashes: AuditHashableEvent;
  canonical_json: string;
  prev_hash: string;
  hash: string;
}
const chainVectors = JSON.parse(
  readFileSync(new URL('../../../shared/test-vectors/audit-chain.json', import.meta.url), 'utf8'),
) as { events: ChainVector[]; canonical_json_examples: Array<{ name: string; input: unknown; canonical_json: string }> };

async function withTriggersDisabled(t: TestApp, fn: () => Promise<void>): Promise<void> {
  // Test-only tampering as superuser: the protection triggers block UPDATE/DELETE otherwise.
  await sql`ALTER TABLE audit_events DISABLE TRIGGER USER`.execute(t.db);
  try {
    await fn();
  } finally {
    await sql`ALTER TABLE audit_events ENABLE TRIGGER USER`.execute(t.db);
  }
}

describe('AuditService.record', () => {
  const t = useTestApp({ modules: [] });

  it('writes a hash-chained event starting at the genesis hash', async () => {
    const user = (await createUser(t().deps)).user;
    const first = await t().deps.audit.record(t().db, {
      actor: { actor_type: 'user', actor_id: user.id },
      action: 'USER_REGISTERED',
      target_type: 'user',
      target_id: user.id,
      metadata: { source: 'test' },
      request_id: randomUUID(),
    });
    expect(first.prev_hash).toBe(AUDIT_GENESIS_PREV_HASH);
    expect(first.hash).toBe(computeAuditHash(first, AUDIT_GENESIS_PREV_HASH));
    expect(first.created_at.getTime()).toBe(t().clock.now().getTime());

    const second = await t().deps.audit.record(t().db, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system' });
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(second.prev_hash).toBe(first.hash);
    expect(second.actor_id).toBeNull();
    expect(second.metadata).toEqual({});
    expect(await t().deps.audit.verifyChain()).toMatchObject({ valid: true, checked: 2, last_seq: second.seq, last_hash: second.hash });
  });

  it('commits and rolls back together with the business transaction', async () => {
    const before = await t().deps.audit.verifyChain();
    await expect(
      withTransaction(t().db, async (trx) => {
        await t().deps.audit.record(trx, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system' });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    const after = await t().deps.audit.verifyChain();
    expect(after.checked).toBe(before.checked);
    expect(after.valid).toBe(true);
    // The chain continues correctly after the rolled back event (seq gap is fine).
    const next = await t().deps.audit.record(t().db, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system' });
    expect(next.prev_hash).toBe(after.last_hash);
    expect((await t().deps.audit.verifyChain()).valid).toBe(true);
  });

  it('sanitizes metadata before hashing and storing', async () => {
    const event = await t().deps.audit.record(t().db, {
      actor: SYSTEM_ACTOR,
      action: 'SERVER_UPDATED',
      target_type: 'server',
      metadata: {
        name: 'Site-19',
        password: 'hunter2',
        registrationToken: 'sreg_abc',
        private_key: 'seed',
        client_ip: '203.0.113.4',
        nested: { secret: 'x', note: 'contact 198.51.100.7', address: '2001:db8::1', ok: true },
        when: new Date('2026-01-01T00:00:00.000Z'),
        big: 10n,
        nul: 'a\u0000b',
      },
    });
    expect(event.metadata).toEqual({
      name: 'Site-19',
      nested: { note: 'contact 198.51.100.7', address: REDACTED, ok: true },
      when: '2026-01-01T00:00:00.000Z',
      big: '10',
      nul: 'ab',
    });
    expect(event.hash).toBe(computeAuditHash(event, event.prev_hash));
  });

  it('rejects invalid target types', async () => {
    await expect(
      t().deps.audit.record(t().db, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'Bad Type' }),
    ).rejects.toThrow(TypeError);
  });

  it('keeps a valid chain under 20 concurrent writers', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withTransaction(t().db, async (trx) =>
          t().deps.audit.record(trx, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system', metadata: { i } }),
        ),
      ),
    );
    expect(new Set(results.map((row) => row.seq)).size).toBe(20);
    expect(new Set(results.map((row) => row.prev_hash)).size).toBe(20);
    const verification = await t().deps.audit.verifyChain();
    expect(verification.valid).toBe(true);
  });
});

describe('AuditService.verifyChain tamper detection', () => {
  const t = useTestApp({ modules: [] });

  async function seed(count: number): Promise<number[]> {
    const seqs: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const row = await t().deps.audit.record(t().db, {
        actor: SYSTEM_ACTOR,
        action: 'RETENTION_RUN',
        target_type: 'system',
        metadata: { i },
      });
      seqs.push(row.seq);
    }
    return seqs;
  }

  it('detects an edited event (hash mismatch)', async () => {
    const seqs = await seed(5);
    const target = seqs[2] ?? 0;
    await withTriggersDisabled(t(), async () => {
      await sql`UPDATE audit_events SET metadata = '{"i": 999}'::jsonb WHERE seq = ${target}`.execute(t().db);
    });
    expect(await t().deps.audit.verifyChain()).toMatchObject({ valid: false, first_invalid_seq: target, reason: 'hash_mismatch' });
    // Restore for the next scenarios.
    await withTriggersDisabled(t(), async () => {
      await sql`UPDATE audit_events SET metadata = '{"i": 2}'::jsonb WHERE seq = ${target}`.execute(t().db);
    });
    expect((await t().deps.audit.verifyChain()).valid).toBe(true);
  });

  it('detects an edited event whose hash was recomputed (broken link)', async () => {
    const all = await t().db.selectFrom('audit_events').selectAll().orderBy('seq').execute();
    const victim = all[1];
    const successor = all[2];
    if (victim === undefined || successor === undefined) throw new Error('seed missing');
    const forged = { ...victim, actor_id: 'attacker' };
    const forgedHash = sha256Hex(canonicalJson(toAuditHashableEvent(forged)) + victim.prev_hash);
    await withTriggersDisabled(t(), async () => {
      await sql`UPDATE audit_events SET actor_id = 'attacker', hash = ${forgedHash} WHERE seq = ${victim.seq}`.execute(t().db);
    });
    expect(await t().deps.audit.verifyChain()).toMatchObject({
      valid: false,
      first_invalid_seq: successor.seq,
      reason: 'prev_hash_mismatch',
    });
    await withTriggersDisabled(t(), async () => {
      await sql`UPDATE audit_events SET actor_id = NULL, hash = ${victim.hash} WHERE seq = ${victim.seq}`.execute(t().db);
    });
    expect((await t().deps.audit.verifyChain()).valid).toBe(true);
  });

  it('detects a deleted event', async () => {
    const all = await t().db.selectFrom('audit_events').select(['seq']).orderBy('seq').execute();
    const deleted = all[3]?.seq ?? 0;
    const next = all[4]?.seq ?? 0;
    await withTriggersDisabled(t(), async () => {
      await sql`DELETE FROM audit_events WHERE seq = ${deleted}`.execute(t().db);
    });
    expect(await t().deps.audit.verifyChain()).toMatchObject({ valid: false, first_invalid_seq: next, reason: 'prev_hash_mismatch' });
  });

  it('supports partial verification with fromSeq and limit', async () => {
    const all = await t().db.selectFrom('audit_events').select(['seq']).orderBy('seq').execute();
    const partial = await t().deps.audit.verifyChain({ fromSeq: all[0]?.seq ?? 1, limit: 2 });
    expect(partial).toMatchObject({ valid: true, checked: 2 });
  });

  it('is enforced by the database (UPDATE/DELETE blocked)', async () => {
    await expect(sql`UPDATE audit_events SET actor_id = 'x'`.execute(t().db)).rejects.toMatchObject({ code: 'TN403' });
    await expect(sql`DELETE FROM audit_events`.execute(t().db)).rejects.toMatchObject({ code: 'TN403' });
  });
});

describe('shared audit-chain vectors', () => {
  const t = useTestApp({ modules: [] });

  it.each(chainVectors.events)('hashes seq $event_without_hashes.seq like the vector', (vector) => {
    expect(canonicalJson(toAuditHashableEvent(vector.event_without_hashes))).toBe(vector.canonical_json);
    expect(computeAuditHash({ ...vector.event_without_hashes, created_at: new Date(vector.event_without_hashes.created_at) }, vector.prev_hash)).toBe(
      vector.hash,
    );
  });

  it.each(chainVectors.canonical_json_examples)('canonical JSON: $name', (example) => {
    expect(canonicalJson(example.input)).toBe(example.canonical_json);
  });

  it('round-trips the vector chain through PostgreSQL (jsonb) and verifies it', async () => {
    const serverId = chainVectors.events.find((e) => e.event_without_hashes.server_id !== null)?.event_without_hashes.server_id;
    const caseId = chainVectors.events.find((e) => e.event_without_hashes.case_id !== null)?.event_without_hashes.case_id;
    if (serverId === null || serverId === undefined || caseId === null || caseId === undefined) throw new Error('vector ids');
    const owner = (await createUser(t().deps)).user;
    const srv = await createServerWithKey(t().deps, { owner });
    await t().db.insertInto('servers').values({ ...withoutId(srv.server), id: serverId, server_id: 'srv_7k4x92m8pq174kf9' }).execute();
    const player = await createPlayer(t().deps);
    await t()
      .db.insertInto('cases')
      .values({ id: caseId, case_number: 'CASE-2026-001337', player_id: player.id, reason: 'vector case' })
      .execute();

    for (const vector of chainVectors.events) {
      const e = vector.event_without_hashes;
      await t()
        .db.insertInto('audit_events')
        .values({ ...e, created_at: new Date(e.created_at), prev_hash: vector.prev_hash, hash: vector.hash })
        .execute();
    }
    expect(await t().deps.audit.verifyChain()).toMatchObject({ valid: true, checked: chainVectors.events.length });
    // Vector rows carry explicit seqs; move the sequence past them, then continue the chain.
    await sql`SELECT setval('audit_events_seq', ${chainVectors.events.length})`.execute(t().db);
    const next = await t().deps.audit.record(t().db, { actor: SYSTEM_ACTOR, action: 'RETENTION_RUN', target_type: 'system' });
    expect(next.prev_hash).toBe(chainVectors.events.at(-1)?.hash);
  });
});

function withoutId<T extends { id: string; server_id: string }>(row: T): Omit<T, 'id' | 'server_id'> {
  const { id: _id, server_id: _serverId, ...rest } = row;
  return rest;
}

describe('audit metadata sanitizer', () => {
  it.each([
    'password',
    'newPassword',
    'mfa_token',
    'token',
    'registration_token',
    'secret',
    'totpSecret',
    'private_key',
    'privateKey',
    'api_key',
    'ip',
    'client_ip',
    'ip_hash',
    'ipAddress',
    'cookie',
    'signature',
    'code',
    'recovery_codes',
    'content',
  ])('drops %s', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
    expect(sanitizeAuditMetadata({ [key]: 'value', keep: 1 }).metadata).toEqual({ keep: 1 });
  });

  it.each(['name', 'reason', 'reason_code', 'description', 'recipient', 'zip', 'public_key', 'fingerprint', 'status'])(
    'keeps %s',
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );

  it('bounds depth, array length, string length and total size', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    const result = sanitizeAuditMetadata({
      deep,
      list: Array.from({ length: 500 }, (_, i) => i),
      text: 'x'.repeat(5000),
    }).metadata;
    expect(JSON.stringify(result)).toContain('[truncated]');
    expect((result['list'] as unknown[]).length).toBe(100);
    expect((result['text'] as string).length).toBeLessThanOrEqual(2001);

    const huge = sanitizeAuditMetadata(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, 'y'.repeat(1900)])));
    expect(huge).toEqual({ metadata: { metadata_truncated: true }, truncated: true });
  });

  it('drops prototype keys, functions, buffers and non-plain objects', () => {
    const input = JSON.parse('{"__proto__":{"polluted":true},"ok":1}') as Record<string, unknown>;
    Object.assign(input, { fn: () => 1, buf: Buffer.from('evidence'), map: new Map([[1, 2]]), nan: Number.NaN });
    expect(sanitizeAuditMetadata(input).metadata).toEqual({ ok: 1, nan: null });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
