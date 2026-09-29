/**
 * Hand-written policy engine cases (ARCHITECTURE §7.2). Expectations are written by hand and
 * checked against evaluatePolicy() by the generator — a mismatch aborts generation.
 */
import type { PolicyEvaluationInput } from '../../src/schemas/policy';
import type { PolicyVectorExpected } from './types';

export interface PolicyCaseSpec {
  name: string;
  description: string;
  schema_valid?: boolean;
  policy?: Partial<PolicySpec>;
  rules: Array<Record<string, unknown>>;
  input?: InputOverrides;
  context?: { server_name?: string };
  expected: PolicyVectorExpected;
}

export interface PolicySpec {
  version: number;
  backend_unavailable_action: string;
  notify_on_enforcement: boolean;
  honor_global_bypasses: boolean;
  whitelist_url: string | null;
}

export interface InputOverrides {
  global_status?: PolicyEvaluationInput['global_status'];
  case_id?: string | null;
  confirmed_servers?: number;
  open_reports?: number;
  days?: number | null;
  vpn?: PolicyEvaluationInput['vpn']['confidence'];
  alt?: Partial<PolicyEvaluationInput['alt_account']>;
  bypass?: PolicyEvaluationInput['bypass']['types'];
}

export const WHITELIST_URL = 'https://trust.example.org/whitelist';

export const BASE_POLICY: PolicySpec = {
  version: 1,
  backend_unavailable_action: 'allow',
  notify_on_enforcement: true,
  honor_global_bypasses: false,
  whitelist_url: WHITELIST_URL,
};

/** A clean player: no cases, old account, no VPN, no alt, no bypass. */
export function buildInput(overrides: InputOverrides = {}): PolicyEvaluationInput {
  return {
    global_status: overrides.global_status ?? 'none',
    case_id: overrides.case_id ?? null,
    confirmed_servers: overrides.confirmed_servers ?? 0,
    open_reports: overrides.open_reports ?? 0,
    account_age: { days: overrides.days === undefined ? 400 : overrides.days },
    vpn: { confidence: overrides.vpn ?? 'not_detected' },
    alt_account: {
      possible: overrides.alt?.possible ?? false,
      confidence: overrides.alt?.confidence ?? 'none',
      linked_confirmed_cases: overrides.alt?.linked_confirmed_cases ?? [],
    },
    bypass: { types: overrides.bypass ?? [] },
  };
}

type RuleExtras = Record<string, unknown>;
const base = (id: string, signal: string, action: string, extras: RuleExtras) => ({
  id,
  enabled: true,
  signal,
  action,
  message: null,
  ban_duration_minutes: null,
  ...extras,
});
export const verdictRule = (id: string, action: string, extras: RuleExtras = {}) =>
  base(id, 'global_verdict', action, { statuses: ['confirmed'], min_confirmed_servers: null, ...extras });
export const ageRule = (id: string, action: string, extras: RuleExtras = {}) =>
  base(id, 'account_age', action, { max_account_age_days: 7, match_unknown_age: false, ...extras });
export const vpnRule = (id: string, action: string, extras: RuleExtras = {}) =>
  base(id, 'vpn', action, { min_vpn_confidence: 'likely', ...extras });
export const altRule = (id: string, action: string, extras: RuleExtras = {}) =>
  base(id, 'alt_account', action, { min_alt_confidence: 'medium', require_linked_confirmed_case: false, ...extras });
export const reportsRule = (id: string, action: string, extras: RuleExtras = {}) =>
  base(id, 'open_reports', action, { min_open_reports: 2, ...extras });

/** §7.4 default rules (same ids as DEFAULT_POLICY). */
export const DEFAULT_RULES = [
  verdictRule('default-global-verdict', 'admin_notify'),
  ageRule('default-account-age', 'admin_notify', { max_account_age_days: 3 }),
  vpnRule('default-vpn', 'admin_notify'),
  altRule('default-alt-account', 'admin_notify'),
];

const MSG = {
  admin_notify: 'Player matched a server policy rule.',
  warn: "Your account has been flagged by this server's trust policy.",
  require_review: 'Player requires staff review under the server policy.',
  require_whitelist: `A VPN/proxy was detected. Request a whitelist at ${WHITELIST_URL}`,
  kick: "You were removed by this server's trust policy.",
  ban: "You have been banned by this server's trust policy.",
} as const;

const allow = (overrides: Partial<PolicyVectorExpected> = {}): PolicyVectorExpected => ({
  action: 'allow',
  applied_rule_ids: [],
  bypassed_rule_ids: [],
  notify_admins: false,
  message: null,
  ban_duration_minutes: null,
  ...overrides,
});

const CONFIRMED = { global_status: 'confirmed', case_id: 'CASE-2026-001337', confirmed_servers: 3 } as const;

export const POLICY_CASES: PolicyCaseSpec[] = [
  // --- empty / default ------------------------------------------------------
  {
    name: 'empty_policy_allows',
    description: 'No rules → allow, nothing applied, no message.',
    rules: [],
    input: { ...CONFIRMED, days: 0, vpn: 'confirmed' },
    expected: allow(),
  },
  {
    name: 'default_policy_clean_player',
    description: 'Default policy (§7.4) with a clean player → allow.',
    rules: DEFAULT_RULES,
    expected: allow(),
  },
  {
    name: 'default_policy_confirmed_cheater_only_notifies',
    description: 'Default policy never kicks: a confirmed verdict only notifies admins.',
    rules: DEFAULT_RULES,
    input: CONFIRMED,
    expected: {
      action: 'admin_notify',
      applied_rule_ids: ['default-global-verdict'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.admin_notify,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'default_policy_all_signals',
    description: 'All four default rules match; applied list keeps rule order.',
    rules: DEFAULT_RULES,
    input: { ...CONFIRMED, days: 1, vpn: 'likely', alt: { possible: true, confidence: 'medium' } },
    expected: {
      action: 'admin_notify',
      applied_rule_ids: ['default-global-verdict', 'default-account-age', 'default-vpn', 'default-alt-account'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.admin_notify,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'default_policy_account_age_equal_threshold',
    description: 'Default account-age rule is "< 3 days": exactly 3 days does not match.',
    rules: DEFAULT_RULES,
    input: { days: 3 },
    expected: allow(),
  },
  // --- global_verdict -------------------------------------------------------
  {
    name: 'global_verdict_status_not_listed',
    description: 'under_review is not in statuses [confirmed].',
    rules: [verdictRule('v1', 'ban')],
    input: { global_status: 'under_review', case_id: 'CASE-2026-000001' },
    expected: allow(),
  },
  {
    name: 'global_verdict_multiple_statuses_warn',
    description: 'statuses [under_review, confirmed] matches under_review; warn notifies (notify_on_enforcement).',
    rules: [verdictRule('v1', 'warn', { statuses: ['under_review', 'confirmed'] })],
    input: { global_status: 'under_review', case_id: 'CASE-2026-000001' },
    expected: {
      action: 'warn',
      applied_rule_ids: ['v1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'global_verdict_min_confirmed_servers_not_met',
    description: 'min_confirmed_servers 3 with only 2 confirmations → no match.',
    rules: [verdictRule('v1', 'ban', { min_confirmed_servers: 3, ban_duration_minutes: 60 })],
    input: { ...CONFIRMED, confirmed_servers: 2 },
    expected: allow(),
  },
  {
    name: 'global_verdict_min_confirmed_servers_met_exactly_ban',
    description: 'confirmed_servers == min matches; custom message with {case_id}; ban duration from the rule.',
    rules: [
      verdictRule('v1', 'ban', {
        min_confirmed_servers: 3,
        ban_duration_minutes: 1440,
        message: 'Banned: confirmed cheating ({case_id}).',
      }),
    ],
    input: CONFIRMED,
    expected: {
      action: 'ban',
      applied_rule_ids: ['v1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'Banned: confirmed cheating (CASE-2026-001337).',
      ban_duration_minutes: 1440,
    },
  },
  {
    name: 'global_verdict_min_confirmed_servers_zero',
    description: 'min_confirmed_servers 0 matches any confirmed status.',
    rules: [verdictRule('v1', 'kick', { min_confirmed_servers: 0 })],
    input: { ...CONFIRMED, confirmed_servers: 0 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['v1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  // --- account_age ----------------------------------------------------------
  {
    name: 'account_age_below_threshold_kick_with_days',
    description: 'days 3 < 7 → kick; {days} substituted.',
    rules: [ageRule('a1', 'kick', { message: 'Your account must be at least 7 days old (currently {days} days).' })],
    input: { days: 3 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'Your account must be at least 7 days old (currently 3 days).',
      ban_duration_minutes: null,
    },
  },
  {
    name: 'account_age_equal_threshold_no_match',
    description: 'Strict "<": days 7 with max 7 does not match.',
    rules: [ageRule('a1', 'kick')],
    input: { days: 7 },
    expected: allow(),
  },
  {
    name: 'account_age_zero_days_matches',
    description: 'A brand-new account (0 days) matches max 1.',
    rules: [ageRule('a1', 'warn', { max_account_age_days: 1 })],
    input: { days: 0 },
    expected: {
      action: 'warn',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'account_age_unknown_not_matched_by_default',
    description: 'days null with match_unknown_age false → no match.',
    rules: [ageRule('a1', 'kick')],
    input: { days: null },
    expected: allow(),
  },
  {
    name: 'account_age_unknown_matched_require_review',
    description: 'days null with match_unknown_age true → require_review (reason account_age_unknown); {days} → empty.',
    rules: [ageRule('a1', 'require_review', { match_unknown_age: true, message: 'Account age unknown ({days}).' })],
    input: { days: null },
    expected: {
      action: 'require_review',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'Account age unknown ().',
      ban_duration_minutes: null,
    },
  },
  {
    name: 'account_age_known_ignores_match_unknown_age',
    description: 'match_unknown_age only applies to unknown ages; an old known account does not match.',
    rules: [ageRule('a1', 'kick', { match_unknown_age: true })],
    input: { days: 30 },
    expected: allow(),
  },
  // --- vpn ------------------------------------------------------------------
  {
    name: 'vpn_possible_below_likely',
    description: 'possible < likely → no match.',
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'possible' },
    expected: allow(),
  },
  {
    name: 'vpn_likely_require_whitelist_default_message',
    description: 'likely ≥ likely → require_whitelist with the default message and {whitelist_url}.',
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'likely' },
    expected: {
      action: 'require_whitelist',
      applied_rule_ids: ['n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.require_whitelist,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'vpn_confirmed_exceeds_possible',
    description: 'confirmed ≥ possible → kick.',
    rules: [vpnRule('n1', 'kick', { min_vpn_confidence: 'possible' })],
    input: { vpn: 'confirmed' },
    expected: {
      action: 'kick',
      applied_rule_ids: ['n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'vpn_not_detected_never_matches',
    description: 'not_detected never reaches a schema-valid threshold.',
    rules: [vpnRule('n1', 'kick', { min_vpn_confidence: 'possible' })],
    input: { vpn: 'not_detected' },
    expected: allow(),
  },
  {
    name: 'vpn_require_whitelist_without_whitelist_url',
    description: 'whitelist_url null → {whitelist_url} becomes the empty string.',
    policy: { whitelist_url: null },
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'likely' },
    expected: {
      action: 'require_whitelist',
      applied_rule_ids: ['n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'A VPN/proxy was detected. Request a whitelist at ',
      ban_duration_minutes: null,
    },
  },
  // --- alt_account ----------------------------------------------------------
  {
    name: 'alt_not_possible_never_matches',
    description: 'possible false → no match regardless of confidence.',
    rules: [altRule('l1', 'kick', { min_alt_confidence: 'low' })],
    input: { alt: { possible: false, confidence: 'high' } },
    expected: allow(),
  },
  {
    name: 'alt_confidence_below_min',
    description: 'low < medium → no match.',
    rules: [altRule('l1', 'kick')],
    input: { alt: { possible: true, confidence: 'low' } },
    expected: allow(),
  },
  {
    name: 'alt_require_linked_confirmed_case_missing',
    description: 'require_linked_confirmed_case with no linked confirmed cases → no match.',
    rules: [altRule('l1', 'kick', { require_linked_confirmed_case: true })],
    input: { alt: { possible: true, confidence: 'high', linked_confirmed_cases: [] } },
    expected: allow(),
  },
  {
    name: 'alt_require_linked_confirmed_case_present',
    description: 'require_linked_confirmed_case with a linked confirmed case → kick.',
    rules: [altRule('l1', 'kick', { require_linked_confirmed_case: true })],
    input: { alt: { possible: true, confidence: 'medium', linked_confirmed_cases: ['CASE-2026-000999'] } },
    expected: {
      action: 'kick',
      applied_rule_ids: ['l1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  // --- open_reports -----------------------------------------------------------
  {
    name: 'open_reports_threshold_met',
    description: 'open_reports == min → warn.',
    rules: [reportsRule('r1', 'warn')],
    input: { open_reports: 2 },
    expected: {
      action: 'warn',
      applied_rule_ids: ['r1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'open_reports_threshold_not_met',
    description: 'open_reports 2 < min 3 → no match.',
    rules: [reportsRule('r1', 'warn', { min_open_reports: 3 })],
    input: { open_reports: 2 },
    expected: allow(),
  },
  // --- bypasses ---------------------------------------------------------------
  {
    name: 'bypass_vpn_whitelist_exempts_vpn_rule',
    description: 'vpn_whitelist bypass: the matching vpn rule is listed as bypassed, not applied.',
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'confirmed', bypass: ['vpn_whitelist'] },
    expected: allow({ bypassed_rule_ids: ['n1'] }),
  },
  {
    name: 'bypass_other_type_does_not_exempt_vpn',
    description: 'account_age_whitelist does not exempt a vpn rule.',
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'likely', bypass: ['account_age_whitelist'] },
    expected: {
      action: 'require_whitelist',
      applied_rule_ids: ['n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.require_whitelist,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'bypass_account_age_whitelist',
    description: 'account_age_whitelist exempts the account_age rule.',
    rules: [ageRule('a1', 'kick')],
    input: { days: 1, bypass: ['account_age_whitelist'] },
    expected: allow({ bypassed_rule_ids: ['a1'] }),
  },
  {
    name: 'bypass_alt_account_whitelist',
    description: 'alt_account_whitelist exempts the alt_account rule.',
    rules: [altRule('l1', 'kick')],
    input: { alt: { possible: true, confidence: 'high' }, bypass: ['alt_account_whitelist'] },
    expected: allow({ bypassed_rule_ids: ['l1'] }),
  },
  {
    name: 'bypass_verdict_override_exempts_global_verdict',
    description: 'verdict_override exempts global_verdict rules.',
    rules: [verdictRule('v1', 'ban', { ban_duration_minutes: 0 })],
    input: { ...CONFIRMED, bypass: ['verdict_override'] },
    expected: allow({ bypassed_rule_ids: ['v1'] }),
  },
  {
    name: 'bypass_verdict_override_exempts_open_reports',
    description: 'verdict_override also exempts open_reports rules.',
    rules: [reportsRule('r1', 'kick')],
    input: { open_reports: 5, bypass: ['verdict_override'] },
    expected: allow({ bypassed_rule_ids: ['r1'] }),
  },
  {
    name: 'bypass_partial_one_of_two',
    description: 'vpn bypassed, account_age still applied.',
    rules: [vpnRule('n1', 'require_whitelist'), ageRule('a1', 'kick')],
    input: { vpn: 'likely', days: 2, bypass: ['vpn_whitelist'] },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: ['n1'],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'bypass_only_lists_matching_rules',
    description: 'A bypass exists but its rule does not match → neither applied nor bypassed.',
    rules: [vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'possible', bypass: ['vpn_whitelist'] },
    expected: allow(),
  },
  // --- severity & message selection -------------------------------------------
  {
    name: 'severity_ban_wins_over_all',
    description: 'warn, kick, ban, admin_notify all match → ban; ban duration 0 = permanent.',
    rules: [
      reportsRule('r1', 'warn', { min_open_reports: 1 }),
      ageRule('a1', 'kick'),
      verdictRule('v1', 'ban', { ban_duration_minutes: 0 }),
      vpnRule('n1', 'admin_notify'),
    ],
    input: { ...CONFIRMED, open_reports: 1, days: 1, vpn: 'likely' },
    expected: {
      action: 'ban',
      applied_rule_ids: ['r1', 'a1', 'v1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.ban,
      ban_duration_minutes: 0,
    },
  },
  {
    name: 'severity_kick_beats_require_whitelist',
    description: 'require_whitelist (4) < kick (5); message of the kick rule.',
    rules: [vpnRule('n1', 'require_whitelist'), ageRule('a1', 'kick', { message: 'Too new.' })],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['n1', 'a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'Too new.',
      ban_duration_minutes: null,
    },
  },
  {
    name: 'severity_require_whitelist_beats_require_review',
    description: 'require_review (3) < require_whitelist (4); require_review still forces notify.',
    policy: { notify_on_enforcement: false },
    rules: [ageRule('a1', 'require_review'), vpnRule('n1', 'require_whitelist')],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'require_whitelist',
      applied_rule_ids: ['a1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.require_whitelist,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'message_first_rule_with_winning_action',
    description: 'Two kick rules with messages → the first one wins.',
    rules: [ageRule('a1', 'kick', { message: 'First kick.' }), vpnRule('n1', 'kick', { message: 'Second kick.' })],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'First kick.',
      ban_duration_minutes: null,
    },
  },
  {
    name: 'message_first_winning_rule_without_message_uses_default',
    description: 'First kick rule has no message → default kick text even though a later kick rule has one.',
    rules: [ageRule('a1', 'kick'), vpnRule('n1', 'kick', { message: 'Second kick.' })],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'message_empty_string_uses_default',
    description: 'An empty message is treated like null.',
    rules: [ageRule('a1', 'warn', { message: '' })],
    input: { days: 1 },
    expected: {
      action: 'warn',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'message_of_lower_severity_rule_ignored',
    description: 'Only rules with the winning action provide the message.',
    rules: [ageRule('a1', 'warn', { message: 'Warn text.' }), vpnRule('n1', 'kick')],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'ban_duration_from_first_ban_rule',
    description: 'Two ban rules (60, 1440) → 60 from the first.',
    rules: [ageRule('a1', 'ban', { ban_duration_minutes: 60 }), vpnRule('n1', 'ban', { ban_duration_minutes: 1440 })],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'ban',
      applied_rule_ids: ['a1', 'n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.ban,
      ban_duration_minutes: 60,
    },
  },
  {
    name: 'ban_duration_null_means_permanent',
    description: 'A ban rule without duration yields 0 (permanent).',
    rules: [ageRule('a1', 'ban')],
    input: { days: 1 },
    expected: {
      action: 'ban',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.ban,
      ban_duration_minutes: 0,
    },
  },
  {
    name: 'ban_duration_ignored_when_ban_bypassed',
    description: 'The ban rule is bypassed; the kick rule wins and no ban duration is reported.',
    rules: [verdictRule('v1', 'ban', { ban_duration_minutes: 60 }), ageRule('a1', 'kick')],
    input: { ...CONFIRMED, days: 1, bypass: ['verdict_override'] },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: ['v1'],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  // --- enabled / forward compatibility ------------------------------------------
  {
    name: 'disabled_rule_ignored',
    description: 'A disabled matching kick rule is neither applied nor bypassed.',
    rules: [ageRule('a1', 'kick', { enabled: false }), vpnRule('n1', 'admin_notify')],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'admin_notify',
      applied_rule_ids: ['n1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.admin_notify,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'all_rules_disabled',
    description: 'Every rule disabled → allow.',
    rules: [verdictRule('v1', 'ban', { enabled: false }), vpnRule('n1', 'kick', { enabled: false })],
    input: { ...CONFIRMED, vpn: 'confirmed' },
    expected: allow(),
  },
  {
    name: 'unknown_signal_ignored',
    description: 'A rule with a signal unknown to this version is ignored (forward compatibility).',
    schema_valid: false,
    rules: [
      { id: 'f1', enabled: true, signal: 'future_signal', action: 'ban', message: null, ban_duration_minutes: 0, threshold: 1 },
      ageRule('a1', 'warn'),
    ],
    input: { days: 1 },
    expected: {
      action: 'warn',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'unknown_action_ignored',
    description: 'A rule with an action unknown to this version is ignored.',
    schema_valid: false,
    rules: [vpnRule('n1', 'quarantine')],
    input: { vpn: 'confirmed' },
    expected: allow(),
  },
  // --- notify_admins ------------------------------------------------------------
  {
    name: 'notify_on_enforcement_false_kick_silent',
    description: 'notify_on_enforcement false and only a kick applied → no admin notification.',
    policy: { notify_on_enforcement: false },
    rules: [ageRule('a1', 'kick')],
    input: { days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: false,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'notify_on_enforcement_false_admin_notify_still_notifies',
    description: 'An applied admin_notify rule always notifies, even when the winning action is kick.',
    policy: { notify_on_enforcement: false },
    rules: [vpnRule('n1', 'admin_notify'), ageRule('a1', 'kick')],
    input: { vpn: 'likely', days: 1 },
    expected: {
      action: 'kick',
      applied_rule_ids: ['n1', 'a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.kick,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'notify_on_enforcement_false_require_review_notifies',
    description: 'require_review always notifies.',
    policy: { notify_on_enforcement: false },
    rules: [reportsRule('r1', 'require_review')],
    input: { open_reports: 3 },
    expected: {
      action: 'require_review',
      applied_rule_ids: ['r1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: MSG.require_review,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'notify_on_enforcement_false_warn_silent',
    description: 'warn with notify_on_enforcement false → no notification.',
    policy: { notify_on_enforcement: false },
    rules: [reportsRule('r1', 'warn')],
    input: { open_reports: 2 },
    expected: {
      action: 'warn',
      applied_rule_ids: ['r1'],
      bypassed_rule_ids: [],
      notify_admins: false,
      message: MSG.warn,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'bypassed_admin_notify_does_not_notify',
    description: 'A bypassed admin_notify rule does not trigger a notification.',
    rules: [vpnRule('n1', 'admin_notify')],
    input: { vpn: 'likely', bypass: ['vpn_whitelist'] },
    expected: allow({ bypassed_rule_ids: ['n1'] }),
  },
  {
    name: 'allow_rule_applied_without_effect',
    description: 'A matching rule with action allow is applied but changes nothing (no notify, no message).',
    rules: [vpnRule('n1', 'allow')],
    input: { vpn: 'likely' },
    expected: allow({ applied_rule_ids: ['n1'] }),
  },
  // --- placeholders ---------------------------------------------------------------
  {
    name: 'placeholders_all_known_and_unknown',
    description: 'Known placeholders substituted; unknown, differently-cased or spaced placeholders left as-is.',
    rules: [
      verdictRule('v1', 'kick', {
        message: '{case_id}|{days}|{whitelist_url}|{server_name}|{unknown}|{CASE_ID}|{ days }|{case_id}',
      }),
    ],
    input: { ...CONFIRMED, days: 12 },
    context: { server_name: 'Site-19 Official' },
    expected: {
      action: 'kick',
      applied_rule_ids: ['v1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: `CASE-2026-001337|12|${WHITELIST_URL}|Site-19 Official|{unknown}|{CASE_ID}|{ days }|CASE-2026-001337`,
      ban_duration_minutes: null,
    },
  },
  {
    name: 'placeholders_missing_values_empty',
    description: 'No case, unknown age, no whitelist_url, no server_name → all substituted by empty strings.',
    policy: { whitelist_url: null },
    rules: [ageRule('a1', 'warn', { match_unknown_age: true, message: '[{case_id}][{days}][{whitelist_url}][{server_name}]' })],
    input: { days: null },
    expected: {
      action: 'warn',
      applied_rule_ids: ['a1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: '[][][][]',
      ban_duration_minutes: null,
    },
  },
  {
    name: 'placeholders_not_recursive',
    description: 'A substituted value containing a placeholder is not expanded again.',
    rules: [verdictRule('v1', 'warn', { message: 'Welcome to {server_name}' })],
    input: CONFIRMED,
    context: { server_name: '{case_id}' },
    expected: {
      action: 'warn',
      applied_rule_ids: ['v1'],
      bypassed_rule_ids: [],
      notify_admins: true,
      message: 'Welcome to {case_id}',
      ban_duration_minutes: null,
    },
  },
];
