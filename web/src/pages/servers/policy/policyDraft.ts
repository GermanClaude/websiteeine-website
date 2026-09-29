/**
 * Editable representation of a server policy (ARCHITECTURE §7.1) and its conversion to the
 * wire model. The draft keeps numeric inputs as strings (DOM values); `validateDraft` builds a
 * policy object and validates it with the shared `ServerPolicySchema`, so the editor can only
 * save what the backend and the plugin accept.
 */
import {
  POLICY_SIGNALS,
  ServerPolicySchema,
  type BackendUnavailableAction,
  type GlobalStatus,
  type PolicyAction,
  type PolicyRule,
  type PolicySignal,
  type ServerPolicy,
  type ServerPolicyUpdateRequestInput,
  type ServerPolicyView,
} from '@scpsl-trust/shared';

export type MinVpnConfidence = 'possible' | 'likely' | 'confirmed';
export type MinAltConfidence = 'low' | 'medium' | 'high';

export interface RuleDraft {
  /** Stable client-side key (React lists); never sent. */
  key: string;
  /** Rule id: existing id or a generated one (ignored by the backend). */
  id: string;
  enabled: boolean;
  signal: PolicySignal;
  action: PolicyAction;
  message: string;
  /** Ban rules only; '' = permanent (0). */
  ban_duration_minutes: string;
  // global_verdict
  statuses: GlobalStatus[];
  min_confirmed_servers: string;
  // account_age
  max_account_age_days: string;
  match_unknown_age: boolean;
  // vpn
  min_vpn_confidence: MinVpnConfidence;
  // alt_account
  min_alt_confidence: MinAltConfidence;
  require_linked_confirmed_case: boolean;
  // open_reports
  min_open_reports: string;
}

export interface PolicyDraft {
  backend_unavailable_action: BackendUnavailableAction;
  notify_on_enforcement: boolean;
  honor_global_bypasses: boolean;
  whitelist_url: string;
  rules: RuleDraft[];
}

export type RuleFieldErrors = Readonly<Record<string, string>>;

export interface PolicyDraftErrors {
  /** Errors not attributable to one rule (policy-level, e.g. too many rules). */
  form: readonly string[];
  settings: Readonly<Record<string, string>>;
  /** Keyed by rule key, then by field name. */
  rules: Readonly<Record<string, RuleFieldErrors>>;
}

export type ValidatedDraft =
  | { ok: true; policy: ServerPolicy; request: ServerPolicyUpdateRequestInput }
  | { ok: false; errors: PolicyDraftErrors };

export const SIGNAL_ORDER: readonly PolicySignal[] = POLICY_SIGNALS;

export const SIGNAL_LABELS: Readonly<Record<PolicySignal, string>> = Object.freeze({
  global_verdict: 'Global verdict',
  vpn: 'VPN',
  account_age: 'Account age',
  alt_account: 'Alt account',
  open_reports: 'Open reports',
});

export const SIGNAL_DESCRIPTIONS: Readonly<Record<PolicySignal, string>> = Object.freeze({
  global_verdict: 'Matches when the player’s aggregated case status is one of the selected statuses (optionally with a minimum number of confirming servers).',
  vpn: 'Matches when the VPN/proxy detection confidence is at least the selected level. A VPN is never treated as cheating by the network.',
  account_age: 'Matches when the account is younger than the given number of days (optionally also when the age is unknown). A young account is never treated as cheating.',
  alt_account: 'Matches when the player is a possible alternate account with at least the selected confidence. Shared networks alone are only a signal.',
  open_reports: 'Matches when the player has at least the given number of open (non-rejected) reports. Reports never change a verdict.',
});

export const ACTION_LABELS: Readonly<Record<PolicyAction, string>> = Object.freeze({
  allow: 'Allow',
  admin_notify: 'Admin notify',
  warn: 'Warn',
  require_review: 'Require review',
  require_whitelist: 'Require whitelist',
  kick: 'Kick',
  ban: 'Ban',
});

export const BACKEND_UNAVAILABLE_LABELS: Readonly<Record<BackendUnavailableAction, string>> = Object.freeze({
  allow: 'Allow (let players join)',
  admin_notify: 'Admin notify',
  kick: 'Kick',
});

let keyCounter = 0;
export function nextRuleKey(): string {
  keyCounter += 1;
  return `rule-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A new rule with conservative defaults for its signal. */
export function newRuleDraft(signal: PolicySignal): RuleDraft {
  const key = nextRuleKey();
  return {
    key,
    id: key,
    enabled: true,
    signal,
    action: 'admin_notify',
    message: '',
    ban_duration_minutes: '',
    statuses: signal === 'global_verdict' ? ['confirmed'] : [],
    min_confirmed_servers: '',
    max_account_age_days: signal === 'account_age' ? '7' : '',
    match_unknown_age: false,
    min_vpn_confidence: 'likely',
    min_alt_confidence: 'medium',
    require_linked_confirmed_case: false,
    min_open_reports: signal === 'open_reports' ? '3' : '',
  };
}

function numberToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Editable copy of a stored rule. */
export function ruleDraftFromRule(rule: PolicyRule): RuleDraft {
  const base = newRuleDraft(rule.signal);
  const draft: RuleDraft = {
    ...base,
    id: rule.id,
    enabled: rule.enabled,
    action: rule.action,
    message: rule.message ?? '',
    ban_duration_minutes: rule.action === 'ban' ? numberToInput(rule.ban_duration_minutes ?? 0) : '',
  };
  switch (rule.signal) {
    case 'global_verdict':
      draft.statuses = [...rule.statuses];
      draft.min_confirmed_servers = numberToInput(rule.min_confirmed_servers);
      break;
    case 'account_age':
      draft.max_account_age_days = numberToInput(rule.max_account_age_days);
      draft.match_unknown_age = rule.match_unknown_age;
      break;
    case 'vpn':
      draft.min_vpn_confidence = rule.min_vpn_confidence;
      break;
    case 'alt_account':
      draft.min_alt_confidence = rule.min_alt_confidence;
      draft.require_linked_confirmed_case = rule.require_linked_confirmed_case;
      break;
    case 'open_reports':
      draft.min_open_reports = numberToInput(rule.min_open_reports);
      break;
  }
  return draft;
}

/** Editable copy of a policy (stored view or plain policy). */
export function draftFromPolicy(policy: Pick<ServerPolicy, 'backend_unavailable_action' | 'notify_on_enforcement' | 'honor_global_bypasses' | 'whitelist_url' | 'rules'>): PolicyDraft {
  return {
    backend_unavailable_action: policy.backend_unavailable_action,
    notify_on_enforcement: policy.notify_on_enforcement,
    honor_global_bypasses: policy.honor_global_bypasses,
    whitelist_url: policy.whitelist_url ?? '',
    rules: policy.rules.map(ruleDraftFromRule),
  };
}

/**
 * Loose number parsing for validation: '' → null, non-numeric → NaN (so the shared schema
 * reports the field and `friendlyMessage` can replace the message).
 */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return Number(trimmed);
}

/** Wire object of a rule: only its own signal's condition fields; ban duration only for bans. */
export function ruleToWire(rule: RuleDraft): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: rule.id,
    enabled: rule.enabled,
    signal: rule.signal,
    action: rule.action,
    message: rule.message.trim() === '' ? null : rule.message.trim(),
    ban_duration_minutes: rule.action === 'ban' ? (parseNumber(rule.ban_duration_minutes) ?? 0) : null,
  };
  switch (rule.signal) {
    case 'global_verdict':
      base.statuses = rule.statuses;
      base.min_confirmed_servers = parseNumber(rule.min_confirmed_servers);
      break;
    case 'account_age':
      base.max_account_age_days = parseNumber(rule.max_account_age_days);
      base.match_unknown_age = rule.match_unknown_age;
      break;
    case 'vpn':
      base.min_vpn_confidence = rule.min_vpn_confidence;
      break;
    case 'alt_account':
      base.min_alt_confidence = rule.min_alt_confidence;
      base.require_linked_confirmed_case = rule.require_linked_confirmed_case;
      break;
    case 'open_reports':
      base.min_open_reports = parseNumber(rule.min_open_reports);
      break;
  }
  return base;
}

/** Wire object of the whole draft (a `ServerPolicy` candidate with the given version). */
export function draftToWire(draft: PolicyDraft, version: number): Record<string, unknown> {
  return {
    version,
    backend_unavailable_action: draft.backend_unavailable_action,
    notify_on_enforcement: draft.notify_on_enforcement,
    honor_global_bypasses: draft.honor_global_bypasses,
    whitelist_url: draft.whitelist_url.trim() === '' ? null : draft.whitelist_url.trim(),
    rules: draft.rules.map(ruleToWire),
  };
}

const NUMERIC_FIELDS = new Set(['min_confirmed_servers', 'max_account_age_days', 'min_open_reports', 'ban_duration_minutes']);

function friendlyMessage(field: string, rawValue: unknown, message: string): string {
  if (NUMERIC_FIELDS.has(field)) {
    if (rawValue === '' || rawValue === undefined || rawValue === null) return 'Enter a whole number';
    if (typeof rawValue === 'string' && !Number.isInteger(Number(rawValue))) return 'Enter a whole number';
  }
  if (field === 'statuses') return 'Select at least one status';
  return message;
}

const SETTING_LABELS: Readonly<Record<string, string>> = {
  whitelist_url: 'Whitelist URL',
  backend_unavailable_action: 'Backend unavailable action',
  notify_on_enforcement: 'Notify on enforcement',
  honor_global_bypasses: 'Honor global bypasses',
};

/**
 * Validates the draft with the shared ServerPolicySchema. On success returns the parsed policy
 * and the PUT body (`base_version` for optimistic concurrency).
 */
export function validateDraft(draft: PolicyDraft, baseVersion: number | null): ValidatedDraft {
  const wire = draftToWire(draft, Math.max(1, baseVersion ?? 1));
  const result = ServerPolicySchema.safeParse(wire);
  if (result.success) {
    const policy = result.data;
    const request: ServerPolicyUpdateRequestInput = {
      backend_unavailable_action: policy.backend_unavailable_action,
      notify_on_enforcement: policy.notify_on_enforcement,
      honor_global_bypasses: policy.honor_global_bypasses,
      whitelist_url: policy.whitelist_url,
      rules: policy.rules,
    };
    if (baseVersion !== null) request.base_version = baseVersion;
    return { ok: true, policy, request };
  }

  const form: string[] = [];
  const settings: Record<string, string> = {};
  const rules: Record<string, Record<string, string>> = {};
  for (const issue of result.error.issues) {
    const [head, index, field] = issue.path.map(String);
    if (head === 'rules' && index !== undefined) {
      const rule = draft.rules[Number(index)];
      if (rule === undefined) {
        form.push(issue.message);
        continue;
      }
      const fieldName = field ?? '_';
      const rawValue = (rule as unknown as Record<string, unknown>)[fieldName];
      const perRule = rules[rule.key] ?? {};
      if (perRule[fieldName] === undefined) perRule[fieldName] = friendlyMessage(fieldName, rawValue, issue.message);
      rules[rule.key] = perRule;
    } else if (head !== undefined && SETTING_LABELS[head] !== undefined) {
      if (settings[head] === undefined) settings[head] = issue.message;
    } else {
      form.push(head === undefined ? issue.message : `${head}: ${issue.message}`);
    }
  }
  return { ok: false, errors: { form, settings, rules } };
}

/** Rules of one signal in evaluation order. */
export function rulesForSignal(draft: PolicyDraft, signal: PolicySignal): RuleDraft[] {
  return draft.rules.filter((rule) => rule.signal === signal);
}

/** Moves a rule one step earlier/later among the rules of its own signal (global order preserved otherwise). */
export function moveRule(draft: PolicyDraft, key: string, direction: 'up' | 'down'): PolicyDraft {
  const index = draft.rules.findIndex((rule) => rule.key === key);
  if (index < 0) return draft;
  const current = draft.rules[index];
  if (current === undefined) return draft;
  let target = -1;
  if (direction === 'up') {
    for (let i = index - 1; i >= 0; i -= 1) {
      if (draft.rules[i]?.signal === current.signal) {
        target = i;
        break;
      }
    }
  } else {
    for (let i = index + 1; i < draft.rules.length; i += 1) {
      if (draft.rules[i]?.signal === current.signal) {
        target = i;
        break;
      }
    }
  }
  if (target < 0) return draft;
  const rules = [...draft.rules];
  const other = rules[target];
  if (other === undefined) return draft;
  rules[target] = current;
  rules[index] = other;
  return { ...draft, rules };
}

/** Appends a new rule after the last rule of the same signal (or at the end). */
export function addRule(draft: PolicyDraft, signal: PolicySignal): PolicyDraft {
  const rule = newRuleDraft(signal);
  let insertAt = draft.rules.length;
  for (let i = draft.rules.length - 1; i >= 0; i -= 1) {
    if (draft.rules[i]?.signal === signal) {
      insertAt = i + 1;
      break;
    }
  }
  const rules = [...draft.rules];
  rules.splice(insertAt, 0, rule);
  return { ...draft, rules };
}

export function removeRule(draft: PolicyDraft, key: string): PolicyDraft {
  return { ...draft, rules: draft.rules.filter((rule) => rule.key !== key) };
}

export function updateRule(draft: PolicyDraft, key: string, patch: Partial<RuleDraft>): PolicyDraft {
  return { ...draft, rules: draft.rules.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)) };
}

export function isServerPolicyView(policy: ServerPolicy | ServerPolicyView): policy is ServerPolicyView {
  return 'is_active' in policy;
}

/** True when the draft differs from the given policy (compares the wire forms). */
export function draftEquals(a: PolicyDraft, b: PolicyDraft): boolean {
  return JSON.stringify(draftToWire(a, 1)) === JSON.stringify(draftToWire(b, 1));
}
