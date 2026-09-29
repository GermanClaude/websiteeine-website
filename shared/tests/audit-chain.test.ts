import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_GENESIS_PREV_HASH,
  AUDIT_HASHED_FIELDS,
  auditHashInput,
  canonicalJson,
  toAuditHashableEvent,
  type AuditHashableEvent,
} from '../src';
import { loadAuditVectors } from './helpers/vectors';

const vectors = loadAuditVectors();
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Recomputes the chain and returns the first broken seq (null when intact). */
function firstBrokenSeq(events: Array<{ event: AuditHashableEvent; prev_hash: string; hash: string }>): number | null {
  let prev = AUDIT_GENESIS_PREV_HASH;
  for (const { event, prev_hash, hash } of events) {
    if (prev_hash !== prev) return event.seq;
    if (sha256(canonicalJson(event) + prev_hash) !== hash) return event.seq;
    prev = hash;
  }
  return null;
}

describe('audit-chain.json', () => {
  it('has 4 chained events starting at the genesis hash', () => {
    expect(vectors.events).toHaveLength(4);
    expect(vectors.genesis_prev_hash).toBe('0'.repeat(64));
    expect(vectors.events[0]?.prev_hash).toBe(AUDIT_GENESIS_PREV_HASH);
    for (let i = 1; i < vectors.events.length; i += 1) {
      expect(vectors.events[i]?.prev_hash).toBe(vectors.events[i - 1]?.hash);
    }
  });

  it.each(vectors.events.map((e) => [e.event_without_hashes.seq, e] as const))('event %s hashes correctly', (_seq, vector) => {
    const event = vector.event_without_hashes;
    expect(Object.keys(event).sort()).toEqual([...AUDIT_HASHED_FIELDS].sort());
    expect(canonicalJson(event)).toBe(vector.canonical_json);
    expect(toAuditHashableEvent(event)).toEqual(event);
    expect(auditHashInput(event, vector.prev_hash)).toBe(vector.canonical_json + vector.prev_hash);
    expect(sha256(vector.canonical_json + vector.prev_hash)).toBe(vector.hash);
  });

  it('canonical form has sorted keys and no whitespace', () => {
    const first = vectors.events[0]?.canonical_json ?? '';
    expect(first.startsWith('{"action":"USER_REGISTERED","actor_id":')).toBe(true);
    expect(first).not.toMatch(/[\n\r\t]|": | ,/);
  });

  describe('tamper detection', () => {
    const intact = () =>
      vectors.events.map((v) => ({ event: structuredClone(v.event_without_hashes), prev_hash: v.prev_hash, hash: v.hash }));

    it('an intact chain verifies', () => {
      expect(firstBrokenSeq(intact())).toBeNull();
    });

    it('detects modified metadata', () => {
      const chain = intact();
      chain[2]!.event.metadata = { ...chain[2]!.event.metadata, reason: 'edited' };
      expect(firstBrokenSeq(chain)).toBe(3);
    });

    it('detects a changed actor', () => {
      const chain = intact();
      chain[3]!.event.actor_id = '00000000-0000-4000-8000-000000000000';
      expect(firstBrokenSeq(chain)).toBe(4);
    });

    it('detects a deleted event', () => {
      const chain = intact();
      chain.splice(1, 1);
      expect(firstBrokenSeq(chain)).toBe(3);
    });

    it('detects reordering', () => {
      const chain = intact();
      [chain[1], chain[2]] = [chain[2]!, chain[1]!];
      expect(firstBrokenSeq(chain)).toBe(3);
    });

    it('detects a recomputed hash that breaks the successor link', () => {
      const chain = intact();
      chain[1]!.event.target_id = 'srv_0000000000000000';
      chain[1]!.hash = sha256(canonicalJson(chain[1]!.event) + chain[1]!.prev_hash);
      expect(firstBrokenSeq(chain)).toBe(3);
    });
  });
});

describe('toAuditHashableEvent / auditHashInput', () => {
  it('normalizes absent fields to null and Date to ISO', () => {
    const event = toAuditHashableEvent({
      seq: 9,
      event_id: 'e',
      created_at: new Date('2026-01-02T03:04:05.006Z'),
      actor_type: 'system',
      action: 'RETENTION_RUN',
      target_type: 'system',
    });
    expect(event).toEqual({
      seq: 9,
      event_id: 'e',
      created_at: '2026-01-02T03:04:05.006Z',
      actor_type: 'system',
      actor_id: null,
      action: 'RETENTION_RUN',
      target_type: 'system',
      target_id: null,
      server_id: null,
      case_id: null,
      metadata: {},
      request_id: null,
    });
  });

  it('drops non-hashed properties such as hash/prev_hash', () => {
    const vector = vectors.events[0]!;
    const withExtras = { ...vector.event_without_hashes, hash: vector.hash, prev_hash: vector.prev_hash, actor_label: 'x' };
    expect(auditHashInput(withExtras, vector.prev_hash)).toBe(vector.canonical_json + vector.prev_hash);
  });

  it('rejects invalid seq and prev hash', () => {
    const base = vectors.events[0]!.event_without_hashes;
    expect(() => toAuditHashableEvent({ ...base, seq: 0 })).toThrow(TypeError);
    expect(() => toAuditHashableEvent({ ...base, seq: 1.5 })).toThrow(TypeError);
    expect(() => auditHashInput(base, 'A'.repeat(64))).toThrow(TypeError);
    expect(() => auditHashInput(base, '0'.repeat(63))).toThrow(TypeError);
  });
});

describe('canonical_json_examples', () => {
  it.each(vectors.canonical_json_examples.map((e) => [e.name, e] as const))('%s', (_name, example) => {
    expect(canonicalJson(example.input)).toBe(example.canonical_json);
  });
});
