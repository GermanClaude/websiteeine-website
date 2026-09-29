import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  LIMITS,
  POLICY_CONDITION_FIELDS,
  POLICY_CONDITION_FIELDS_BY_SIGNAL,
  POLICY_SIGNALS,
  PolicyPreviewRequestSchema,
  PolicyRuleInputSchema,
  PolicyRuleSchema,
  ServerPolicySchema,
  ServerPolicyUpdateRequestSchema,
  ServerPolicyViewSchema,
} from '../../src';

const validRules: Record<string, Record<string, unknown>> = {
  global_verdict: { id: 'g', signal: 'global_verdict', action: 'admin_notify', statuses: ['confirmed'], min_confirmed_servers: null },
  account_age: { id: 'a', signal: 'account_age', action: 'kick', max_account_age_days: 7, match_unknown_age: false },
  vpn: { id: 'v', signal: 'vpn', action: 'require_whitelist', min_vpn_confidence: 'likely' },
  alt_account: { id: 'l', signal: 'alt_account', action: 'admin_notify', min_alt_confidence: 'medium', require_linked_confirmed_case: false },
  open_reports: { id: 'o', signal: 'open_reports', action: 'warn', min_open_reports: 2 },
};

/** A non-null value for each condition field. */
const foreignValues: Record<string, unknown> = {
  statuses: ['confirmed'],
  min_confirmed_servers: 1,
  max_account_age_days: 7,
  match_unknown_age: true,
  min_vpn_confidence: 'likely',
  min_alt_confidence: 'medium',
  require_linked_confirmed_case: true,
  min_open_reports: 1,
};

/** The §7.1 example with ids. */
const architectureExample = {
  version: 3,
  backend_unavailable_action: 'allow',
  notify_on_enforcement: true,
  honor_global_bypasses: false,
  whitelist_url: 'https://trust.example.org/whitelist',
  rules: [
    { id: 'r1', enabled: true, signal: 'global_verdict', action: 'admin_notify', statuses: ['confirmed'], min_confirmed_servers: null, message: null },
    { id: 'r2', enabled: true, signal: 'account_age', action: 'kick', max_account_age_days: 7, match_unknown_age: false, message: 'Your account must be at least 7 days old.' },
    { id: 'r3', enabled: true, signal: 'account_age', action: 'admin_notify', max_account_age_days: 14 },
    { id: 'r4', enabled: true, signal: 'vpn', action: 'require_whitelist', min_vpn_confidence: 'likely' },
    { id: 'r5', enabled: true, signal: 'alt_account', action: 'admin_notify', min_alt_confidence: 'medium', require_linked_confirmed_case: false },
  ],
};

describe('PolicyRuleSchema', () => {
  it.each(Object.entries(validRules))('accepts a valid %s rule and applies defaults', (_signal, rule) => {
    const parsed = PolicyRuleSchema.parse(rule);
    expect(parsed.enabled).toBe(true);
    expect(parsed.message).toBeNull();
    expect(parsed.ban_duration_minutes).toBeNull();
  });

  it('every signal has its condition fields registered', () => {
    expect(Object.keys(POLICY_CONDITION_FIELDS_BY_SIGNAL).sort()).toEqual([...POLICY_SIGNALS].sort());
    expect(new Set(POLICY_CONDITION_FIELDS).size).toBe(POLICY_CONDITION_FIELDS.length);
  });

  // Rules must carry only the condition fields of their own signal.
  const foreignCases = POLICY_SIGNALS.flatMap((signal) =>
    POLICY_CONDITION_FIELDS.filter((field) => !(POLICY_CONDITION_FIELDS_BY_SIGNAL[signal] as readonly string[]).includes(field)).map(
      (field) => [signal, field] as const,
    ),
  );
  it.each(foreignCases)('rejects a %s rule carrying %s', (signal, field) => {
    const result = PolicyRuleSchema.safeParse({ ...validRules[signal], [field]: foreignValues[field] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes(field))).toBe(true);
  });

  it('tolerates foreign condition fields that are explicitly null', () => {
    expect(PolicyRuleSchema.safeParse({ ...validRules.vpn, max_account_age_days: null, statuses: null }).success).toBe(true);
  });

  it.each([
    ['vpn without threshold', { id: 'v', signal: 'vpn', action: 'kick' }],
    ['vpn threshold not_detected (would match everyone)', { ...validRules.vpn, min_vpn_confidence: 'not_detected' }],
    ['alt threshold none', { ...validRules.alt_account, min_alt_confidence: 'none' }],
    ['account_age without max', { id: 'a', signal: 'account_age', action: 'kick' }],
    ['account_age max 0', { ...validRules.account_age, max_account_age_days: 0 }],
    ['account_age max fractional', { ...validRules.account_age, max_account_age_days: 1.5 }],
    ['account_age max as string', { ...validRules.account_age, max_account_age_days: '7' }],
    ['global_verdict empty statuses', { ...validRules.global_verdict, statuses: [] }],
    ['global_verdict duplicate statuses', { ...validRules.global_verdict, statuses: ['confirmed', 'confirmed'] }],
    ['global_verdict upper-case status', { ...validRules.global_verdict, statuses: ['CONFIRMED'] }],
    ['open_reports min 0', { ...validRules.open_reports, min_open_reports: 0 }],
    ['unknown signal', { id: 'x', signal: 'geo', action: 'kick' }],
    ['unknown action', { ...validRules.vpn, action: 'nuke' }],
    ['ban duration on a kick rule', { ...validRules.vpn, action: 'kick', ban_duration_minutes: 60 }],
    ['negative ban duration', { ...validRules.vpn, action: 'ban', ban_duration_minutes: -1 }],
    ['ban duration too long', { ...validRules.vpn, action: 'ban', ban_duration_minutes: LIMITS.POLICY_MAX_BAN_DURATION_MINUTES + 1 }],
    ['message too long', { ...validRules.vpn, message: 'x'.repeat(257) }],
    ['empty id', { ...validRules.vpn, id: '' }],
    ['enabled as string', { ...validRules.vpn, enabled: 'yes' }],
  ])('rejects %s', (_name, rule) => {
    expect(PolicyRuleSchema.safeParse(rule).success).toBe(false);
  });

  it('accepts ban rules with a duration (0 = permanent)', () => {
    expect(PolicyRuleSchema.safeParse({ ...validRules.global_verdict, action: 'ban', ban_duration_minutes: 0 }).success).toBe(true);
    expect(PolicyRuleSchema.safeParse({ ...validRules.global_verdict, action: 'ban', ban_duration_minutes: 1440 }).success).toBe(true);
  });

  it('PolicyRuleInputSchema drops client ids', () => {
    const parsed = PolicyRuleInputSchema.parse(validRules.vpn);
    expect(parsed).not.toHaveProperty('id');
  });
});

describe('ServerPolicySchema', () => {
  it('accepts the §7.1 example and the default policy', () => {
    expect(ServerPolicySchema.safeParse(architectureExample).success).toBe(true);
    expect(ServerPolicySchema.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });

  it.each([
    ['duplicate rule ids', { ...architectureExample, rules: [validRules.vpn, validRules.vpn] }],
    ['too many rules', { ...architectureExample, rules: Array.from({ length: LIMITS.POLICY_RULES_MAX + 1 }, (_, i) => ({ ...validRules.vpn, id: `r${i}` })) }],
    ['backend_unavailable_action ban', { ...architectureExample, backend_unavailable_action: 'ban' }],
    ['backend_unavailable_action warn', { ...architectureExample, backend_unavailable_action: 'warn' }],
    ['javascript: whitelist url', { ...architectureExample, whitelist_url: 'javascript:alert(document.cookie)' }],
    ['version 0', { ...architectureExample, version: 0 }],
    ['rules missing', { version: 1 }],
  ])('rejects %s', (_name, policy) => {
    expect(ServerPolicySchema.safeParse(policy).success).toBe(false);
  });

  it('ServerPolicyViewSchema adds metadata', () => {
    expect(
      ServerPolicyViewSchema.safeParse({
        ...architectureExample,
        id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        server_id: 'srv_7k4x92m8pq174kf9',
        is_active: true,
        created_at: '2026-09-29T15:42:20.000Z',
        created_by: null,
      }).success,
    ).toBe(true);
  });
});

describe('policy update & preview requests', () => {
  it('update request applies defaults and strips rule ids', () => {
    const parsed = ServerPolicyUpdateRequestSchema.parse({ rules: [validRules.vpn, validRules.account_age] });
    expect(parsed.backend_unavailable_action).toBe('allow');
    expect(parsed.notify_on_enforcement).toBe(true);
    expect(parsed.honor_global_bypasses).toBe(false);
    expect(parsed.whitelist_url).toBeNull();
    expect(parsed.rules.every((rule) => !('id' in rule))).toBe(true);
  });

  it('update request rejects wrong condition fields', () => {
    expect(ServerPolicyUpdateRequestSchema.safeParse({ rules: [{ ...validRules.vpn, min_open_reports: 3 }] }).success).toBe(false);
  });

  it('preview request validates the evaluation input', () => {
    const input = {
      global_status: 'confirmed',
      case_id: 'CASE-2026-001337',
      confirmed_servers: 1,
      open_reports: 0,
      account_age: { days: 2 },
      vpn: { confidence: 'likely' },
      alt_account: { possible: false, confidence: 'none', linked_confirmed_cases: [] },
      bypass: { types: [] },
    };
    expect(PolicyPreviewRequestSchema.safeParse({ input }).success).toBe(true);
    expect(PolicyPreviewRequestSchema.safeParse({ input, policy: { rules: [validRules.vpn] } }).success).toBe(true);
    expect(PolicyPreviewRequestSchema.safeParse({ input: { ...input, account_age: { days: -1 } } }).success).toBe(false);
    expect(PolicyPreviewRequestSchema.safeParse({ input: { ...input, bypass: { types: ['everything'] } } }).success).toBe(false);
  });
});
