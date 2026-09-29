import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildProofMessage,
  normalizeProofCode,
  PROOF_ALPHABET,
  PROOF_CODE_REGEX,
  proofCodeFromMac,
  proofWindow,
  proofWindowBounds,
  proofWindowFromMs,
} from '../src';
import { loadProofVectors } from './helpers/vectors';

const vectors = loadProofVectors();

/** Independent implementation via BigInt. */
function codeViaBigInt(mac: Buffer): string {
  const v = BigInt(`0x${mac.subarray(0, 4).toString('hex')}`) >> 2n;
  let out = '';
  for (let i = 5; i >= 0; i -= 1) out += PROOF_ALPHABET.charAt(Number((v >> BigInt(i * 5)) & 31n));
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

describe('proof-codes.json', () => {
  it('has at least 12 cases with intervals 10 and 30', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(12);
    const intervals = new Set(vectors.cases.map((c) => c.interval_seconds));
    expect(intervals.has(10)).toBe(true);
    expect(intervals.has(30)).toBe(true);
    expect(vectors.alphabet).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s recomputes', (_name, vector) => {
    const secret = Buffer.from(vector.secret_b64, 'base64');
    expect(secret).toHaveLength(32);
    expect(secret.toString('hex')).toBe(vector.secret_hex);
    const window = proofWindow(vector.unix_seconds, vector.interval_seconds);
    expect(window).toBe(vector.window);
    const message = buildProofMessage({
      sessionId: vector.session_id,
      serverId: vector.server_id,
      targetUserId: vector.target_user_id,
      spectatorUserId: vector.spectator_user_id,
      window,
    });
    expect(message).toBe(vector.message);
    const mac = createHmac('sha256', secret).update(message, 'utf8').digest();
    expect(mac.toString('hex')).toBe(vector.mac_hex);
    expect(proofCodeFromMac(mac)).toBe(vector.code);
    expect(codeViaBigInt(mac)).toBe(vector.code);
    expect(vector.code).toMatch(PROOF_CODE_REGEX);
  });

  it('window boundaries: same window → same code, next window → new code', () => {
    const byName = new Map(vectors.cases.map((c) => [c.name, c]));
    const start = byName.get('interval10_window_start_exact_multiple');
    const last = byName.get('interval10_window_last_second');
    const next = byName.get('interval10_next_window_boundary');
    const prev = byName.get('interval10_previous_window');
    expect(start?.window).toBe(last?.window);
    expect(start?.code).toBe(last?.code);
    expect(next?.window).toBe((start?.window ?? 0) + 1);
    expect(prev?.window).toBe((start?.window ?? 0) - 1);
    expect(next?.code).not.toBe(start?.code);
  });

  it('every input component changes the code', () => {
    const byName = new Map(vectors.cases.map((c) => [c.name, c]));
    const reference = byName.get('interval10_window_start_exact_multiple')?.code;
    for (const name of [
      'secret_all_zero',
      'other_secret_same_inputs',
      'other_session_same_inputs',
      'other_server_same_inputs',
      'swapped_target_and_spectator',
    ]) {
      expect(byName.get(name)?.code, name).not.toBe(reference);
    }
  });
});

describe('proofCodeFromMac', () => {
  it('maps extreme MACs', () => {
    expect(proofCodeFromMac(new Uint8Array(32))).toBe('000-000');
    expect(proofCodeFromMac(new Uint8Array(32).fill(0xff))).toBe('ZZZ-ZZZ');
    // Only the first 30 bits count: the lowest two bits of byte 3 are ignored.
    expect(proofCodeFromMac(Uint8Array.from([0, 0, 0, 3]))).toBe('000-000');
    expect(proofCodeFromMac(Uint8Array.from([0, 0, 0, 4]))).toBe('000-001');
  });

  it('rejects MACs shorter than 4 bytes', () => {
    expect(() => proofCodeFromMac(new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('buildProofMessage', () => {
  const parts = {
    sessionId: '5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e',
    serverId: 'srv_7k4x92m8pq174kf9',
    targetUserId: '76561198000000001@steam',
    spectatorUserId: '76561198000000002@steam',
    window: 179000000,
  };

  it('builds the exact pipe-separated message', () => {
    expect(buildProofMessage(parts)).toBe(
      'SCPSL-TRUST-PROOF-V1|5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e|srv_7k4x92m8pq174kf9|76561198000000001@steam|76561198000000002@steam|179000000',
    );
  });

  it.each([
    ['pipe in target (field injection)', { targetUserId: 'a|b' }],
    ['newline in session', { sessionId: 'x\ny' }],
    ['empty server id', { serverId: '' }],
    ['negative window', { window: -1 }],
    ['fractional window', { window: 1.5 }],
    ['unsafe window', { window: Number.MAX_SAFE_INTEGER + 1 }],
  ])('rejects %s', (_name, override) => {
    expect(() => buildProofMessage({ ...parts, ...override })).toThrow(TypeError);
  });
});

describe('proof windows', () => {
  it('floors seconds and milliseconds', () => {
    expect(proofWindow(1_790_000_009, 10)).toBe(179_000_000);
    expect(proofWindow(1_790_000_009.99, 10)).toBe(179_000_000);
    expect(proofWindowFromMs(1_790_000_009_999, 10)).toBe(179_000_000);
    expect(proofWindowFromMs(1_790_000_010_000, 10)).toBe(179_000_001);
  });

  it('computes bounds [start, end)', () => {
    expect(proofWindowBounds(179_000_000, 10)).toEqual({ startSeconds: 1_790_000_000, endSeconds: 1_790_000_010 });
  });

  it.each([0, -10, 1.5, Number.NaN])('rejects interval %s', (interval) => {
    expect(() => proofWindow(1_790_000_000, interval)).toThrow(RangeError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects timestamp %s', (seconds) => {
    expect(() => proofWindow(seconds, 10)).toThrow(RangeError);
  });
});

describe('normalizeProofCode', () => {
  it.each([
    ['7K4-X92', '7K4-X92'],
    ['7k4x92', '7K4-X92'],
    [' 7k4 - x92 ', '7K4-X92'],
    ['o1l-i00', '011-100'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeProofCode(input)).toBe(expected);
  });

  it.each(['', '7K4-X9', '7K4-X923', 'ABU-123', '7K4_X92', '7K4-X9!', 'x'.repeat(40)])('rejects %s', (input) => {
    expect(normalizeProofCode(input)).toBeNull();
  });
});
