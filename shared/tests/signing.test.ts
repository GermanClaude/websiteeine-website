import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildCanonicalRequest,
  buildRegistrationPopMessage,
  buildRotationPopMessage,
  EMPTY_BODY_SHA256_HEX,
  formatTimestampMs,
  KEY_FINGERPRINT_REGEX,
  NONCE_REGEX,
  PLUGIN_VERSION_REGEX,
  PUBLIC_KEY_B64_REGEX,
  REQUEST_ID_REGEX,
  REQUIRED_SIGNING_HEADERS_LOWER,
  SERVER_ID_REGEX,
  SIGNATURE_B64_REGEX,
  SIGNING_HEADERS,
  SIGNING_HEADERS_LOWER,
  TIMESTAMP_MS_REGEX,
  type CanonicalRequestParts,
} from '../src';

const parts: CanonicalRequestParts = {
  method: 'post',
  pathWithQuery: '/api/v1/player/check?x=1',
  serverId: 'srv_7k4x92m8pq174kf9',
  timestamp: 1790000000000,
  nonce: 'AAAAAAAAAAAAAAAAAAAAAAAA',
  requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  bodySha256Hex: EMPTY_BODY_SHA256_HEX,
};

describe('buildCanonicalRequest', () => {
  it('produces the exact §5.3 string', () => {
    expect(buildCanonicalRequest(parts)).toBe(
      'SCPSL-TRUST-V1\nPOST\n/api/v1/player/check?x=1\nsrv_7k4x92m8pq174kf9\n1790000000000\nAAAAAAAAAAAAAAAAAAAAAAAA\n3f2504e0-4f89-41d3-9a0c-0305e82c3301\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('accepts the timestamp as the header string', () => {
    expect(buildCanonicalRequest({ ...parts, timestamp: '1790000000000' })).toBe(buildCanonicalRequest(parts));
  });

  it('EMPTY_BODY_SHA256_HEX is the SHA-256 of the empty string', () => {
    expect(createHash('sha256').update('').digest('hex')).toBe(EMPTY_BODY_SHA256_HEX);
  });

  it.each<[string, Partial<CanonicalRequestParts>]>([
    ['newline injected in path', { pathWithQuery: '/api/v1/x\nPOST' }],
    ['carriage return in nonce', { nonce: 'abc\rdef' }],
    ['space in path', { pathWithQuery: '/api/v1/a b' }],
    ['relative path', { pathWithQuery: 'api/v1/x' }],
    ['empty server id', { serverId: '' }],
    ['newline in server id', { serverId: 'srv_7k4x92m8pq174kf9\nsrv_x' }],
    ['newline in request id', { requestId: 'a\nb' }],
    ['invalid method', { method: 'GE T' }],
    ['empty method', { method: '' }],
    ['upper-case body hash', { bodySha256Hex: EMPTY_BODY_SHA256_HEX.toUpperCase() }],
    ['short body hash', { bodySha256Hex: 'abcd' }],
    ['negative timestamp', { timestamp: -1 }],
    ['fractional timestamp', { timestamp: 1790000000000.5 }],
    ['unsafe timestamp', { timestamp: Number.MAX_SAFE_INTEGER + 2 }],
    ['timestamp with leading zero', { timestamp: '01790000000000' }],
    ['timestamp with sign', { timestamp: '+1790000000000' }],
    ['timestamp with spaces', { timestamp: ' 1790000000000' }],
    ['timestamp in seconds with fraction', { timestamp: '1790000000.5' }],
  ])('rejects %s', (_name, override) => {
    expect(() => buildCanonicalRequest({ ...parts, ...override })).toThrow(TypeError);
  });
});

describe('formatTimestampMs', () => {
  it('formats canonical decimal values', () => {
    expect(formatTimestampMs(0)).toBe('0');
    expect(formatTimestampMs('0')).toBe('0');
    expect(formatTimestampMs(1790000000000)).toBe('1790000000000');
  });
  it('rejects 17-digit values beyond the regex', () => {
    expect(() => formatTimestampMs('99999999999999999')).toThrow(TypeError);
  });
});

describe('proof-of-possession messages', () => {
  it('registration message format (§5.2)', () => {
    expect(buildRegistrationPopMessage('sreg_token', 'PUB=', 1790000000000)).toBe(
      'SCPSL-TRUST-REGISTER-V1\nsreg_token\nPUB=\n1790000000000',
    );
  });
  it('rotation message format (§5.5)', () => {
    expect(buildRotationPopMessage('srv_7k4x92m8pq174kf9', 'NEW=', '1790000000000')).toBe(
      'SCPSL-TRUST-ROTATE-V1\nsrv_7k4x92m8pq174kf9\nNEW=\n1790000000000',
    );
  });
  it('rejects field injection', () => {
    expect(() => buildRegistrationPopMessage('sreg_a\nb', 'PUB=', 1)).toThrow(TypeError);
    expect(() => buildRotationPopMessage('srv_x', 'NEW=\n', 1)).toThrow(TypeError);
    expect(() => buildRotationPopMessage('srv_x', 'NEW=', -5)).toThrow(TypeError);
  });
});

describe('header names', () => {
  it('lower-case variants match', () => {
    for (const key of Object.keys(SIGNING_HEADERS) as Array<keyof typeof SIGNING_HEADERS>) {
      expect(SIGNING_HEADERS_LOWER[key]).toBe(SIGNING_HEADERS[key].toLowerCase());
    }
    expect(REQUIRED_SIGNING_HEADERS_LOWER).not.toContain('x-key-fingerprint');
    expect(REQUIRED_SIGNING_HEADERS_LOWER).toHaveLength(6);
  });
});

describe('validation regexes', () => {
  it.each([
    [SERVER_ID_REGEX, ['srv_7k4x92m8pq174kf9', 'srv_0000000000000000', 'srv_zzzzzzzzzzzzzzzz'], [
      'srv_7K4X92M8PQ174KF9',
      'srv_7k4x92m8pq174kf',
      'srv_7k4x92m8pq174kf90',
      'srv_iiiiiiiiiiiiiiii',
      'srv_llllllllllllllll',
      'srv_oooooooooooooooo',
      'srv_uuuuuuuuuuuuuuuu',
      'SRV_7k4x92m8pq174kf9',
      ' srv_7k4x92m8pq174kf9',
      'srv_7k4x92m8pq174kf9\n',
    ]],
    [NONCE_REGEX, ['a'.repeat(16), 'A-_'.repeat(8), 'z'.repeat(64)], ['a'.repeat(15), 'a'.repeat(65), 'a+b/'.repeat(5), 'a'.repeat(20) + '=']],
    [REQUEST_ID_REGEX, ['3f2504e0-4f89-41d3-9a0c-0305e82c3301', '3F2504E0-4F89-41D3-9A0C-0305E82C3301'], [
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      '3f2504e0-4f89-41d3-7a0c-0305e82c3301',
      '3f2504e04f8941d39a0c0305e82c3301',
      '00000000-0000-0000-0000-000000000000',
    ]],
    [KEY_FINGERPRINT_REGEX, [`SHA256:${'a'.repeat(64)}`], [`SHA256:${'A'.repeat(64)}`, `sha256:${'a'.repeat(64)}`, `SHA256:${'a'.repeat(63)}`]],
    [TIMESTAMP_MS_REGEX, ['0', '1790000000000'], ['', '-1', '01', '1.0', '1e12', '17900000000000000']],
    [PLUGIN_VERSION_REGEX, ['1.0.0', '10.20.30', '1.0.0-beta.1', '1.0.0+build.5'], ['1.0', 'v1.0.0', '01.0.0', '1.0.0-', '1.0.0 ']],
  ])('%s', (regex, valid, invalid) => {
    for (const value of valid) expect(value, value).toMatch(regex);
    for (const value of invalid) expect(value, value).not.toMatch(regex);
  });

  it('public key regex accepts exactly canonical 32-byte base64', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(key).toMatch(PUBLIC_KEY_B64_REGEX);
    expect(Buffer.alloc(31).toString('base64')).not.toMatch(PUBLIC_KEY_B64_REGEX);
    expect(Buffer.alloc(33).toString('base64')).not.toMatch(PUBLIC_KEY_B64_REGEX);
    expect(key.replace('=', '')).not.toMatch(PUBLIC_KEY_B64_REGEX);
    // Non-canonical: same bytes but non-zero padding bits in the last character.
    expect(`${key.slice(0, 42)}B=`).not.toMatch(PUBLIC_KEY_B64_REGEX);
    expect(Buffer.alloc(32, 7).toString('base64url')).not.toMatch(PUBLIC_KEY_B64_REGEX);
  });

  it('signature regex accepts exactly canonical 64-byte base64', () => {
    const sig = Buffer.alloc(64, 9).toString('base64');
    expect(sig).toMatch(SIGNATURE_B64_REGEX);
    expect(Buffer.alloc(63).toString('base64')).not.toMatch(SIGNATURE_B64_REGEX);
    expect(Buffer.alloc(65).toString('base64')).not.toMatch(SIGNATURE_B64_REGEX);
    expect(`${sig.slice(0, 85)}B==`).not.toMatch(SIGNATURE_B64_REGEX);
  });
});
