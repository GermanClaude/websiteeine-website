import { describe, expect, it } from 'vitest';
import {
  AdminUserUpdateRequestSchema,
  AppealCreateRequestSchema,
  AppealDecisionRequestSchema,
  AuditListQuerySchema,
  BypassCreateRequestSchema,
  CaseListQuerySchema,
  CaseVerdictRequestSchema,
  EvidenceLinkCreateRequestSchema,
  EvidenceReviewRequestSchema,
  EvidenceUploadFieldsSchema,
  KeyRotateRequestSchema,
  Login2faRequestSchema,
  LoginResponseSchema,
  OverwatchSessionEndRequestSchema,
  OverwatchSessionStartRequestSchema,
  OverwatchSessionViewSchema,
  PasswordChangeRequestSchema,
  PlayerViewResponseSchema,
  ProofQuerySchema,
  ProofResponseSchema,
  RegisterRequestSchema,
  ServerCreateRequestSchema,
  ServerMemberAddRequestSchema,
  ServerRegisterRequestSchema,
  ServerStatusChangeRequestSchema,
  WhitelistDecisionRequestSchema,
  WhitelistRequestCreateRequestSchema,
} from '../../src';

const steam = { type: 'steam', id: '76561198000000001' } as const;
const staff = { type: 'steam', id: '76561198000000002' } as const;
const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const iso = '2026-09-29T15:42:20.000Z';
const pub = Buffer.alloc(32, 1).toString('base64');
const sig = Buffer.alloc(64, 2).toString('base64');

describe('auth', () => {
  it('registration normalizes email and rejects weak passwords', () => {
    const parsed = RegisterRequestSchema.parse({ email: ' Foo@Example.org ', username: 'foo_bar', password: 'correct horse battery' });
    expect(parsed.email).toBe('foo@example.org');
    for (const body of [
      { email: 'a@b.org', username: 'foo_bar', password: 'short' },
      { email: 'a@b.org', username: 'foo_bar', password: 'x'.repeat(129) },
      { email: 'a@b.org', username: 'longusername', password: 'LONGUSERNAME' },
      { email: 'someone@example.org', username: 'foo_bar', password: 'Someone@Example.org' },
      { email: 'a@b.org', username: 'x', password: 'correct horse battery' },
      { email: 'a@b.org', username: '<script>', password: 'correct horse battery' },
      { email: 'not-mail', username: 'foo_bar', password: 'correct horse battery' },
    ]) {
      expect(RegisterRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('password change must use a new password', () => {
    expect(PasswordChangeRequestSchema.safeParse({ current_password: 'old-password-1', new_password: 'new-password-1' }).success).toBe(true);
    expect(PasswordChangeRequestSchema.safeParse({ current_password: 'same-password', new_password: 'same-password' }).success).toBe(false);
  });

  it('login response is a discriminated union on mfa_required', () => {
    expect(LoginResponseSchema.safeParse({ mfa_required: true, mfa_token: 'abc' }).success).toBe(true);
    expect(LoginResponseSchema.safeParse({ mfa_required: false, mfa_token: 'abc' }).success).toBe(false);
  });

  it('2FA login code formats', () => {
    expect(Login2faRequestSchema.safeParse({ mfa_token: 'a'.repeat(32), code: '123456' }).success).toBe(true);
    expect(Login2faRequestSchema.safeParse({ mfa_token: 'a'.repeat(32), code: 'abcde-12345' }).success).toBe(true);
    expect(Login2faRequestSchema.safeParse({ mfa_token: 'a'.repeat(32), code: '12345' }).success).toBe(false);
    expect(Login2faRequestSchema.safeParse({ mfa_token: 'a'.repeat(32), code: "1' OR '1'='1" }).success).toBe(false);
    expect(Login2faRequestSchema.safeParse({ mfa_token: 'short', code: '123456' }).success).toBe(false);
  });
});

describe('servers', () => {
  it('registration requires canonical key/signature encodings', () => {
    const body = {
      registration_token: `sreg_${'A'.repeat(43)}`,
      public_key: pub,
      plugin_version: '1.0.0',
      timestamp: 1790000000000,
      pop_signature: sig,
    };
    expect(ServerRegisterRequestSchema.safeParse(body).success).toBe(true);
    expect(ServerRegisterRequestSchema.safeParse({ ...body, public_key: Buffer.alloc(33).toString('base64') }).success).toBe(false);
    expect(ServerRegisterRequestSchema.safeParse({ ...body, registration_token: 'sreg_short' }).success).toBe(false);
    expect(ServerRegisterRequestSchema.safeParse({ ...body, timestamp: '1790000000000' }).success).toBe(false);
    expect(ServerRegisterRequestSchema.safeParse({ ...body, timestamp: -1 }).success).toBe(false);
    expect(ServerRegisterRequestSchema.safeParse({ ...body, plugin_version: 'latest' }).success).toBe(false);
    // A private key field is never part of the contract and is stripped.
    const parsed = ServerRegisterRequestSchema.parse({ ...body, private_key: 'secret' });
    expect(parsed).not.toHaveProperty('private_key');
    expect(KeyRotateRequestSchema.safeParse({ new_public_key: pub, timestamp: 1, pop_signature: sig.slice(1) }).success).toBe(false);
  });

  it('server create / member / status requests', () => {
    expect(ServerCreateRequestSchema.parse({ name: '  Site-19  ' })).toEqual({ name: 'Site-19', description: null, accepts_whitelist_requests: true });
    expect(ServerCreateRequestSchema.safeParse({ name: 'ab' }).success).toBe(false);
    expect(ServerMemberAddRequestSchema.safeParse({ username: 'foo', role: 'moderator' }).success).toBe(true);
    expect(ServerMemberAddRequestSchema.safeParse({ username: 'foo', role: 'owner' }).success).toBe(false);
    expect(ServerStatusChangeRequestSchema.safeParse({ status: 'pending', reason: 'reset' }).success).toBe(false);
    expect(ServerStatusChangeRequestSchema.safeParse({ status: 'suspended', reason: 'abuse' }).success).toBe(true);
  });
});

describe('cases, appeals, evidence', () => {
  it('verdict cannot be reset to unknown and needs a comment', () => {
    expect(CaseVerdictRequestSchema.safeParse({ verdict: 'confirmed', comment: 'Verified video evidence.' }).success).toBe(true);
    expect(CaseVerdictRequestSchema.safeParse({ verdict: 'unknown', comment: 'reset' }).success).toBe(false);
    expect(CaseVerdictRequestSchema.safeParse({ verdict: 'confirmed', comment: '  ' }).success).toBe(false);
  });

  it('case list query coerces pagination and validates filters', () => {
    expect(CaseListQuerySchema.parse({ page: '2', verdict: 'confirmed' })).toMatchObject({ page: 2, page_size: 25, verdict: 'confirmed' });
    expect(CaseListQuerySchema.safeParse({ verdict: 'guilty' }).success).toBe(false);
    expect(CaseListQuerySchema.safeParse({ player: 'not-a-user-id' }).success).toBe(false);
  });

  it('appeals', () => {
    expect(AppealCreateRequestSchema.safeParse({ case_id: 'CASE-2026-001337', statement: 'x'.repeat(19) }).success).toBe(false);
    expect(AppealCreateRequestSchema.safeParse({ case_id: 'CASE-2026-001337', statement: 'I was wrongly accused, here is why.' }).success).toBe(true);
    expect(AppealDecisionRequestSchema.parse({ decision: 'reverse', reason: 'New evidence shows otherwise.' }).override_conflict).toBe(false);
    expect(AppealDecisionRequestSchema.safeParse({ decision: 'overturn', reason: 'New evidence shows otherwise.' }).success).toBe(false);
  });

  it('evidence: three assessments required, https links only, no link uploads', () => {
    const review = { status: 'verified', identity_status: 'verified', authenticity_status: 'verified', cheating_status: 'inconclusive', comment: 'ok' };
    expect(EvidenceReviewRequestSchema.safeParse({ ...review, comment: 'Reviewed.' }).success).toBe(true);
    const { cheating_status: _omitted, ...missing } = review;
    expect(EvidenceReviewRequestSchema.safeParse({ ...missing, comment: 'Reviewed.' }).success).toBe(false);
    expect(EvidenceLinkCreateRequestSchema.safeParse({ url: 'https://youtu.be/x', title: 'Clip' }).success).toBe(true);
    expect(EvidenceLinkCreateRequestSchema.safeParse({ url: 'http://youtu.be/x', title: 'Clip' }).success).toBe(false);
    expect(EvidenceLinkCreateRequestSchema.safeParse({ url: 'javascript:alert(1)', title: 'Clip' }).success).toBe(false);
    expect(EvidenceUploadFieldsSchema.safeParse({ type: 'video', title: 'Clip' }).success).toBe(true);
    expect(EvidenceUploadFieldsSchema.safeParse({ type: 'link', title: 'Clip' }).success).toBe(false);
  });
});

describe('proof API', () => {
  const base = { server_id: 'srv_7k4x92m8pq174kf9', player_id: '76561198000000001@steam', spectator_id: '76561198000000002@steam' };

  it('accepts ISO and unix-ms timestamps and normalizes codes', () => {
    expect(ProofQuerySchema.parse({ ...base, timestamp: '2026-09-29T15:42:20.000Z', code: '7k4x92' })).toEqual({
      ...base,
      timestamp: Date.parse('2026-09-29T15:42:20.000Z'),
      code: '7K4-X92',
    });
    expect(ProofQuerySchema.parse({ ...base, timestamp: '1790000000000' }).timestamp).toBe(1790000000000);
  });

  it.each([
    { timestamp: 'yesterday' },
    { timestamp: '-5' },
    { timestamp: '1.5' },
    { timestamp: '2026-09-29' },
    { timestamp: '99999999999999999' },
    { timestamp: '1790000000000', code: 'ABU-123' },
    { timestamp: '1790000000000', session_id: 'x' },
    { timestamp: '1790000000000', player_id: '76561198000000001' },
  ])('rejects %j', (override) => {
    expect(ProofQuerySchema.safeParse({ ...base, ...override }).success).toBe(false);
  });

  it('response exposes session_id/code only as optional fields', () => {
    const invalid = { valid: false, ...base, timestamp_window: { start: iso, end: iso } };
    expect(ProofResponseSchema.parse(invalid)).toEqual(invalid);
    expect(ProofResponseSchema.safeParse({ ...invalid, window_offset: 2 }).success).toBe(false);
    expect(ProofResponseSchema.safeParse({ ...invalid, code: '7K4X92' }).success).toBe(false);
  });
});

describe('overwatch', () => {
  it('start request rejects spectating oneself; plugin cannot send heartbeat_timeout', () => {
    expect(OverwatchSessionStartRequestSchema.safeParse({ target_player: steam, spectator: staff, started_at: iso }).success).toBe(true);
    expect(OverwatchSessionStartRequestSchema.safeParse({ target_player: steam, spectator: steam }).success).toBe(false);
    expect(OverwatchSessionEndRequestSchema.safeParse({ reason: 'round_ended' }).success).toBe(true);
    expect(OverwatchSessionEndRequestSchema.safeParse({ reason: 'heartbeat_timeout' }).success).toBe(false);
  });

  it('web session view never contains the secret', () => {
    const view = {
      id: uuid,
      server: { server_id: 'srv_7k4x92m8pq174kf9', name: 'Site-19', is_trusted: false },
      target: { user_id: '76561198000000001@steam', type: 'steam', id: '76561198000000001', display_name: 'Foo' },
      spectator: { user_id: '76561198000000002@steam', type: 'steam', id: '76561198000000002', display_name: 'Staff' },
      interval_seconds: 10,
      status: 'expired',
      started_at: iso,
      ended_at: null,
      last_heartbeat_at: iso,
      effective_end_at: iso,
      end_reason: 'heartbeat_timeout',
      proof_verifiable: true,
      created_at: iso,
    };
    const parsed = OverwatchSessionViewSchema.parse({ ...view, secret: 'AAAA', secret_enc: 'v1:…' });
    expect(parsed).not.toHaveProperty('secret');
    expect(parsed).not.toHaveProperty('secret_enc');
    expect(Object.keys(OverwatchSessionViewSchema.shape).some((key) => key.includes('secret'))).toBe(false);
  });
});

describe('players', () => {
  it('public view strips staff-only data (no IPs, signals or links)', () => {
    const publicView = {
      view: 'public',
      player: { user_id: '76561198000000001@steam', type: 'steam', id: '76561198000000001', display_name: 'Foo', first_seen_at: null },
      global_status: 'none',
      case_id: null,
      cases: [],
      reports: 0,
      confirmed_servers: 0,
    };
    const parsed = PlayerViewResponseSchema.parse({ ...publicView, ip: '203.0.113.4', signals: [{}], links: [{}], network_hash: 'abc' });
    expect(parsed).toEqual(publicView);
  });
});

describe('whitelist, bypass, admin, audit', () => {
  it('whitelist requests', () => {
    const ok = { server_id: 'srv_7k4x92m8pq174kf9', type: 'vpn_whitelist', reason: 'I use a university VPN.', requested_days: 30 };
    expect(WhitelistRequestCreateRequestSchema.safeParse(ok).success).toBe(true);
    expect(WhitelistRequestCreateRequestSchema.safeParse({ ...ok, requested_days: 366 }).success).toBe(false);
    expect(WhitelistRequestCreateRequestSchema.safeParse({ ...ok, type: 'alt_account_whitelist' }).success).toBe(false);
    expect(WhitelistRequestCreateRequestSchema.safeParse({ ...ok, reason: 'short' }).success).toBe(false);
    expect(WhitelistDecisionRequestSchema.safeParse({ decision: 'approve', days: 30 }).success).toBe(true);
    expect(WhitelistDecisionRequestSchema.safeParse({ decision: 'reject', days: 30 }).success).toBe(false);
    expect(WhitelistDecisionRequestSchema.safeParse({ decision: 'approved' }).success).toBe(false);
  });

  it('bypasses cannot be created already expired', () => {
    expect(BypassCreateRequestSchema.safeParse({ player: steam, type: 'vpn_whitelist', reason: 'Known player' }).success).toBe(true);
    expect(
      BypassCreateRequestSchema.safeParse({ player: steam, type: 'vpn_whitelist', reason: 'Known player', expires_at: '2000-01-01T00:00:00Z' }).success,
    ).toBe(false);
    expect(
      BypassCreateRequestSchema.safeParse({ player: steam, type: 'vpn_whitelist', reason: 'Known player', expires_at: '2999-01-01T00:00:00Z' }).success,
    ).toBe(true);
  });

  it('admin user update requires a change', () => {
    expect(AdminUserUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(AdminUserUpdateRequestSchema.safeParse({ role: 'moderator' }).success).toBe(true);
    expect(AdminUserUpdateRequestSchema.safeParse({ role: 'god' }).success).toBe(false);
  });

  it('audit list query validates the time range', () => {
    expect(AuditListQuerySchema.safeParse({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }).success).toBe(true);
    expect(AuditListQuerySchema.safeParse({ from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success).toBe(false);
    expect(AuditListQuerySchema.safeParse({ action: 'report_created' }).success).toBe(false);
  });
});
