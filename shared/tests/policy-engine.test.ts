import { describe, expect, it } from 'vitest';
import {
  buildDefaultPolicy,
  buildDefaultPolicyRules,
  DEFAULT_ACTION_MESSAGES,
  DEFAULT_POLICY,
  DEFAULT_POLICY_RULE_IDS,
  evaluatePolicy,
  isRecognizedPolicyRule,
  POLICY_ACTIONS,
  PolicyDraftSchema,
  renderPolicyMessage,
  ServerPolicySchema,
  type EvaluablePolicy,
  type PlayerCheckResponse,
  type PolicyDraft,
  type PolicyEvaluationInput,
  type ServerPolicy,
} from '../src';

const clean: PolicyEvaluationInput = {
  global_status: 'none',
  case_id: null,
  confirmed_servers: 0,
  open_reports: 0,
  account_age: { days: 100 },
  vpn: { confidence: 'not_detected' },
  alt_account: { possible: false, confidence: 'none', linked_confirmed_cases: [] },
  bypass: { types: [] },
};

describe('default policy (§7.4)', () => {
  it('is schema-valid, conservative and deterministic', () => {
    const parsed = ServerPolicySchema.parse(DEFAULT_POLICY);
    expect(parsed).toEqual(DEFAULT_POLICY);
    expect(DEFAULT_POLICY.backend_unavailable_action).toBe('allow');
    expect(DEFAULT_POLICY.rules.map((r) => r.id)).toEqual(Object.values(DEFAULT_POLICY_RULE_IDS));
    expect(DEFAULT_POLICY.rules.every((r) => r.action === 'admin_notify' && r.enabled)).toBe(true);
    expect(DEFAULT_POLICY.rules.map((r) => r.signal)).toEqual(['global_verdict', 'account_age', 'vpn', 'alt_account']);
  });

  it('is deeply frozen, builders return fresh copies', () => {
    expect(Object.isFrozen(DEFAULT_POLICY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_POLICY.rules[0])).toBe(true);
    const a = buildDefaultPolicyRules();
    const b = buildDefaultPolicyRules();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a[0]!.enabled = false;
    expect(b[0]!.enabled).toBe(true);
    expect(buildDefaultPolicy(7).version).toBe(7);
  });

  it('never kicks a confirmed cheater with a VPN and a fresh account', () => {
    const decision = evaluatePolicy(
      {
        ...clean,
        global_status: 'confirmed',
        case_id: 'CASE-2026-000001',
        account_age: { days: 0 },
        vpn: { confidence: 'confirmed' },
        alt_account: { possible: true, confidence: 'high', linked_confirmed_cases: ['CASE-2026-000002'] },
      },
      DEFAULT_POLICY,
    );
    expect(decision.action).toBe('admin_notify');
    expect(decision.applied).toHaveLength(4);
    expect(decision.notify_admins).toBe(true);
  });
});

describe('evaluatePolicy', () => {
  const kickVpn: ServerPolicy = {
    version: 2,
    backend_unavailable_action: 'kick',
    notify_on_enforcement: true,
    honor_global_bypasses: false,
    whitelist_url: 'https://example.org/wl',
    rules: [
      {
        id: 'vpn',
        enabled: true,
        signal: 'vpn',
        action: 'require_whitelist',
        min_vpn_confidence: 'likely',
        message: null,
        ban_duration_minutes: null,
      },
    ],
  };

  it('does not mutate its inputs', () => {
    const input = structuredClone({ ...clean, vpn: { confidence: 'confirmed' as const } });
    const policy = structuredClone(kickVpn);
    evaluatePolicy(input, policy, { server_name: 'x' });
    expect(input).toEqual({ ...clean, vpn: { confidence: 'confirmed' } });
    expect(policy).toEqual(kickVpn);
  });

  it('accepts a full PlayerCheckResponse and a policy draft', () => {
    const check: PlayerCheckResponse = {
      player: { type: 'steam', id: '76561198000000001', user_id: '76561198000000001@steam', first_seen_at: null },
      global_status: 'none',
      case_id: null,
      cases: [],
      reports: 0,
      open_reports: 0,
      confirmed_servers: 0,
      independent_confirmed_servers: 0,
      account_age: { days: null, created_at: null, source: 'unknown' },
      vpn: { detected: true, confidence: 'likely', type: 'vpn', checked: true },
      bypass: { active: false, types: [], bypasses: [] },
      alt_account: { possible: false, confidence: 'none', signals: [], linked_confirmed_cases: [] },
      policy_version: 2,
      checked_at: '2026-09-29T15:42:20.000Z',
    };
    // Compile-time: PlayerCheckResponse is assignable to the engine input.
    const input: PolicyEvaluationInput = check;
    const draft: PolicyDraft = PolicyDraftSchema.parse({ rules: kickVpn.rules });
    const asEvaluable: EvaluablePolicy = draft;
    expect(evaluatePolicy(input, asEvaluable).action).toBe('require_whitelist');
    expect(evaluatePolicy(input, asEvaluable).message).toBe('A VPN/proxy was detected. Request a whitelist at ');
  });

  it('bypasses require the exact exempt type', () => {
    const vpnWithBypass = { ...clean, vpn: { confidence: 'likely' as const } };
    for (const types of [['account_age_whitelist'], ['alt_account_whitelist'], ['verdict_override']] as const) {
      expect(evaluatePolicy({ ...vpnWithBypass, bypass: { types: [...types] } }, kickVpn).action).toBe('require_whitelist');
    }
    expect(evaluatePolicy({ ...vpnWithBypass, bypass: { types: ['vpn_whitelist'] } }, kickVpn).action).toBe('allow');
  });

  it('ignores unknown signals and actions', () => {
    const policy: EvaluablePolicy = {
      notify_on_enforcement: true,
      rules: [
        { id: 'x', enabled: true, signal: 'geo_block', action: 'ban' },
        { id: 'y', enabled: true, signal: 'vpn', action: 'shadow_ban' },
      ],
    };
    expect(isRecognizedPolicyRule(policy.rules[0]!)).toBe(false);
    expect(isRecognizedPolicyRule(policy.rules[1]!)).toBe(false);
    expect(evaluatePolicy({ ...clean, vpn: { confidence: 'confirmed' } }, policy)).toEqual({
      action: 'allow',
      applied: [],
      bypassed: [],
      notify_admins: false,
      message: null,
      ban_duration_minutes: null,
    });
  });

  it('treats unknown input confidence values as non-matching (forward compatibility)', () => {
    const input = { ...clean, vpn: { confidence: 'extreme' } } as unknown as PolicyEvaluationInput;
    expect(evaluatePolicy(input, kickVpn).action).toBe('allow');
  });
});

describe('messages', () => {
  it('has a default for every action; allow has none', () => {
    for (const action of POLICY_ACTIONS) expect(action in DEFAULT_ACTION_MESSAGES).toBe(true);
    expect(DEFAULT_ACTION_MESSAGES.allow).toBeNull();
    expect(DEFAULT_ACTION_MESSAGES.require_whitelist).toBe('A VPN/proxy was detected. Request a whitelist at {whitelist_url}');
  });

  it('renders placeholders in a single pass', () => {
    const values = { case_id: 'CASE-2026-000001', days: '3', whitelist_url: '{days}', server_name: '$&' };
    expect(renderPolicyMessage('{case_id} {days} {whitelist_url} {server_name} {other} {Days}', values)).toBe(
      'CASE-2026-000001 3 {days} $& {other} {Days}',
    );
    expect(renderPolicyMessage('no placeholders', values)).toBe('no placeholders');
    expect(renderPolicyMessage('{{case_id}}', values)).toBe('{CASE-2026-000001}');
  });
});
