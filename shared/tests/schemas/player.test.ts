import { describe, expect, it } from 'vitest';
import {
  BypassCheckRequestSchema,
  BypassCheckResponseSchema,
  LIMITS,
  PlayerCheckRequestSchema,
  PlayerCheckResponseSchema,
  PlayerLinkRequestSchema,
  ServerReportRequestSchema,
} from '../../src';

const steam = { type: 'steam', id: '76561198000000001' } as const;

/** Exactly the §6.1 example. */
const checkResponseExample = {
  player: { type: 'steam', id: '76561198000000001', user_id: '76561198000000001@steam', first_seen_at: '2026-01-01T00:00:00.000Z' },
  global_status: 'confirmed',
  case_id: 'CASE-2026-001337',
  cases: [{ case_id: 'CASE-2026-001337', verdict: 'confirmed', status: 'closed', confirmed_servers: 3 }],
  reports: 4,
  open_reports: 1,
  confirmed_servers: 3,
  independent_confirmed_servers: 2,
  account_age: { days: 3, created_at: '2026-09-26T15:42:20.000Z', source: 'steam' },
  vpn: { detected: true, confidence: 'likely', type: 'vpn' },
  bypass: { active: false, types: [], bypasses: [] },
  alt_account: { possible: true, confidence: 'medium', signals: ['same_network_identifier'], linked_confirmed_cases: ['CASE-2026-000999'] },
  policy_version: 3,
  checked_at: '2026-09-29T15:42:20.000Z',
};

describe('PlayerCheckRequestSchema', () => {
  it('accepts the §6.1 request and minimal requests', () => {
    expect(
      PlayerCheckRequestSchema.safeParse({
        server_id: 'srv_7k4x92m8pq174kf9',
        player: steam,
        nickname: 'Foo',
        ip: '203.0.113.4',
        account_created_at: '2020-01-01T00:00:00Z',
      }).success,
    ).toBe(true);
    expect(PlayerCheckRequestSchema.safeParse({ player: steam }).success).toBe(true);
    expect(PlayerCheckRequestSchema.safeParse({ player: steam, ip: null, nickname: null }).success).toBe(true);
  });

  it.each([
    ['missing player', {}],
    ['player as string', { player: '76561198000000001@steam' }],
    ['16-digit steam id', { player: { type: 'steam', id: '7656119800000000' } }],
    ['unknown id type', { player: { type: 'epic', id: 'abc' } }],
    ['invalid ip', { player: steam, ip: '999.1.1.1' }],
    ['ip with CIDR', { player: steam, ip: '203.0.113.0/24' }],
    ['nickname too long', { player: steam, nickname: 'x'.repeat(LIMITS.DISPLAY_NAME_MAX + 1) }],
    ['empty nickname', { player: steam, nickname: '' }],
    ['malformed server_id', { player: steam, server_id: 'server_x' }],
    ['non-ISO account_created_at', { player: steam, account_created_at: '01/01/2020' }],
  ])('rejects %s', (_name, body) => {
    expect(PlayerCheckRequestSchema.safeParse(body).success).toBe(false);
  });

  it('is not affected by __proto__ keys in parsed JSON', () => {
    const body: unknown = JSON.parse('{"player":{"type":"steam","id":"76561198000000001"},"__proto__":{"polluted":true}}');
    const parsed = PlayerCheckRequestSchema.parse(body);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect((parsed as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('strips unknown keys', () => {
    const parsed = PlayerCheckRequestSchema.parse({ player: steam, action: 'ban', raw_ip_store: true });
    expect(parsed).not.toHaveProperty('action');
    expect(parsed).not.toHaveProperty('raw_ip_store');
  });
});

describe('PlayerCheckResponseSchema', () => {
  it('models the §6.1 example exactly', () => {
    const parsed = PlayerCheckResponseSchema.parse(checkResponseExample);
    expect(parsed).toEqual(checkResponseExample);
  });

  it('never carries an enforcement action (R1): unknown fields are stripped', () => {
    const parsed = PlayerCheckResponseSchema.parse({ ...checkResponseExample, action: 'ban', ban: true });
    expect(parsed).not.toHaveProperty('action');
    expect(parsed).not.toHaveProperty('ban');
  });

  it('accepts the "no ip" and provider-failure vpn variants', () => {
    for (const vpn of [
      { detected: false, confidence: 'not_detected', type: null, checked: false },
      { detected: false, confidence: 'not_detected', type: null, checked: false, error: 'provider_unavailable' },
    ]) {
      expect(PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, vpn }).success).toBe(true);
    }
    expect(
      PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, vpn: { detected: false, confidence: 'none', type: null } }).success,
    ).toBe(false);
  });

  it('rejects invalid values', () => {
    expect(PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, global_status: 'CONFIRMED' }).success).toBe(false);
    expect(PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, reports: -1 }).success).toBe(false);
    expect(PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, case_id: 'CASE-1' }).success).toBe(false);
    expect(
      PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, account_age: { days: -3, created_at: null, source: 'steam' } }).success,
    ).toBe(false);
    expect(
      PlayerCheckResponseSchema.safeParse({ ...checkResponseExample, account_age: { days: null, created_at: null, source: 'unknown' } }).success,
    ).toBe(true);
  });
});

describe('bypass check / link / reports', () => {
  it('BypassCheckRequestSchema', () => {
    expect(BypassCheckRequestSchema.safeParse({ player: steam, types: ['vpn_whitelist'] }).success).toBe(true);
    expect(BypassCheckRequestSchema.safeParse({ player: steam, types: ['vpn_whitelist', 'vpn_whitelist'] }).success).toBe(false);
    expect(BypassCheckRequestSchema.safeParse({ player: steam, types: ['VPN_WHITELIST'] }).success).toBe(false);
  });

  it('BypassCheckResponseSchema', () => {
    expect(
      BypassCheckResponseSchema.safeParse({
        vpn: true,
        bypass: true,
        bypass_type: 'vpn_whitelist',
        expires_at: '2026-10-29T00:00:00.000Z',
        bypasses: [{ id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', type: 'vpn_whitelist', scope: 'server', expires_at: null }],
      }).success,
    ).toBe(true);
  });

  it('PlayerLinkRequestSchema requires a valid code', () => {
    expect(PlayerLinkRequestSchema.safeParse({ player: steam, code: 'LNK-7K4X92' }).success).toBe(true);
    for (const code of ['lnk-7k4x92', 'LNK-7K4X9', 'LNK-7K4XU2', '7K4X92']) {
      expect(PlayerLinkRequestSchema.safeParse({ player: steam, code }).success, code).toBe(false);
    }
  });

  it('ServerReportRequestSchema', () => {
    const report = { player: steam, reporter: { type: 'discord', id: '123456789012345678' }, reason: 'Aimbot' };
    expect(ServerReportRequestSchema.safeParse(report).success).toBe(true);
    expect(ServerReportRequestSchema.safeParse({ ...report, reporter: null }).success).toBe(true);
    expect(ServerReportRequestSchema.safeParse({ ...report, reporter: steam }).success).toBe(false);
    expect(ServerReportRequestSchema.safeParse({ ...report, reason: '  ' }).success).toBe(false);
    expect(ServerReportRequestSchema.safeParse({ ...report, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(ServerReportRequestSchema.safeParse({ ...report, log_excerpt: 'a'.repeat(65536) }).success).toBe(true);
    expect(ServerReportRequestSchema.safeParse({ ...report, log_excerpt: 'a'.repeat(65537) }).success).toBe(false);
    // 21846 × "€" (3 UTF-8 bytes each) = 65538 bytes although only 21846 characters.
    expect(ServerReportRequestSchema.safeParse({ ...report, log_excerpt: '€'.repeat(21846) }).success).toBe(false);
  });
});
