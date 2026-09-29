/**
 * Builds shared/test-vectors/audit-chain.json (ARCHITECTURE §9.1).
 */
import { AUDIT_GENESIS_PREV_HASH, toAuditHashableEvent, type AuditHashableEventInput } from '../../src/audit-chain';
import { canonicalJson } from '../../src/canonical-json';
import { sha256Hex } from './node-crypto';
import type { AuditChainEventVector, AuditChainVectors, CanonicalJsonExample } from './types';

const USER_ID = '8a6e0804-2bd0-4672-b79d-d97027f9071a';
const REVIEWER_ID = '4f1c2b3a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const SERVER_UUID = 'c0ffee00-1234-4abc-9def-0123456789ab';
const CASE_UUID = '1e2d3c4b-5a69-4788-97a6-b5c4d3e2f1a0';
const REPORT_UUID = '7d6c5b4a-3928-4716-a5b4-c3d2e1f0a9b8';

const EVENTS: AuditHashableEventInput[] = [
  {
    seq: 1,
    event_id: '0b9f1e7c-2a4d-4c6e-8f10-3a5b7c9d1e2f',
    created_at: '2026-09-29T15:42:20.000Z',
    actor_type: 'user',
    actor_id: USER_ID,
    action: 'USER_REGISTERED',
    target_type: 'user',
    target_id: USER_ID,
    metadata: {},
    request_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  },
  {
    seq: 2,
    event_id: '1c0a2f8d-3b5e-4d7f-9021-4b6c8d0e2f30',
    created_at: new Date('2026-09-29T15:43:05.123Z'),
    actor_type: 'user',
    actor_id: USER_ID,
    action: 'SERVER_CREATED',
    target_type: 'server',
    target_id: 'srv_7k4x92m8pq174kf9',
    server_id: SERVER_UUID,
    metadata: { name: 'Site-19 Official', accepts_whitelist_requests: true },
    request_id: '6fa459ea-ee8a-4ca4-894e-db77e160355e',
  },
  {
    seq: 3,
    event_id: '2d1b3a9e-4c6f-4e80-a132-5c7d9e1f3a41',
    created_at: '2026-09-29T16:00:00.500Z',
    actor_type: 'server',
    actor_id: 'srv_7k4x92m8pq174kf9',
    action: 'REPORT_CREATED',
    target_type: 'report',
    target_id: REPORT_UUID,
    server_id: SERVER_UUID,
    case_id: CASE_UUID,
    // Keys deliberately unsorted; nested objects/arrays, unicode, numbers and null.
    metadata: {
      zeta: 1,
      source: 'in_game',
      reason: 'Aimbot \u{1F3AF} — Grüße',
      alpha: { b: [3, 1, 2], a: null, 'A-upper': true },
      score: 2.5,
      case_number: 'CASE-2026-001337',
    },
    request_id: '9b2e7c1a-5d3f-4e8b-a1c2-7f6e5d4c3b2a',
  },
  {
    seq: 4,
    event_id: '3e2c4b0f-5d70-4f91-b243-6d8e0f2a4b52',
    created_at: '2026-09-30T08:15:30.999Z',
    actor_type: 'user',
    actor_id: REVIEWER_ID,
    action: 'VERDICT_CHANGED',
    target_type: 'case',
    target_id: CASE_UUID,
    case_id: CASE_UUID,
    metadata: { previous_verdict: 'unknown', new_verdict: 'confirmed', case_number: 'CASE-2026-001337' },
    // Absent request id / server id are hashed as null.
  },
];

const CANONICAL_EXAMPLES: Array<{ name: string; input: unknown }> = [
  { name: 'nested_key_sorting', input: { b: 1, a: { d: [{ z: 1, y: 2 }], c: null } } },
  { name: 'uppercase_sorts_before_lowercase', input: { b: 1, B: 2, a: 3, A: 4, _: 5, '1': 6 } },
  { name: 'array_order_preserved', input: [3, 1, 2, 'b', 'a'] },
  { name: 'numbers', input: { int: 42, negative: -7, fraction: 0.1, exponent: 1e21, small: 1e-7, neg_zero: -0 } },
  { name: 'string_escapes', input: { s: 'quote " backslash \\ newline \n tab \t nul \u0000 bell \u0007 slash /' } },
  { name: 'unicode_kept_raw', input: { s: 'Grüße 日本 \u{1F3AF}' } },
  { name: 'empty_containers', input: { o: {}, a: [] } },
  { name: 'booleans_and_null', input: { t: true, f: false, n: null } },
];

export function buildAuditVectors(): AuditChainVectors {
  let prevHash = AUDIT_GENESIS_PREV_HASH;
  const events: AuditChainEventVector[] = EVENTS.map((input) => {
    const event = toAuditHashableEvent(input);
    const canonical = canonicalJson(event);
    const hash = sha256Hex(canonical + prevHash);
    const vector: AuditChainEventVector = { event_without_hashes: event, canonical_json: canonical, prev_hash: prevHash, hash };
    prevHash = hash;
    return vector;
  });

  const examples: CanonicalJsonExample[] = CANONICAL_EXAMPLES.map(({ name, input }) => ({
    name,
    input,
    canonical_json: canonicalJson(input),
  }));

  return {
    version: '1',
    description:
      'Audit hash chain (ARCHITECTURE §9.1): hash = sha256_hex(UTF-8(canonical_json(event_without_hashes) + prev_hash)); genesis prev_hash = 64 zeros.',
    genesis_prev_hash: AUDIT_GENESIS_PREV_HASH,
    events,
    canonical_json_examples: examples,
  };
}
