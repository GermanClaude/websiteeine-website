/**
 * Default policy (ARCHITECTURE §7.4), materialized as version 1 on server registration.
 * Conservative: every rule only notifies admins; nothing is kicked by default.
 */
import type { PolicyRule, ServerPolicy } from '../schemas/policy';

/** Deterministic ids of the default rules (DB rows get UUIDs when materialized). */
export const DEFAULT_POLICY_RULE_IDS = Object.freeze({
  GLOBAL_VERDICT: 'default-global-verdict',
  ACCOUNT_AGE: 'default-account-age',
  VPN: 'default-vpn',
  ALT_ACCOUNT: 'default-alt-account',
} as const);

/** Fresh (mutable) copies of the default rules, in evaluation order. */
export function buildDefaultPolicyRules(): PolicyRule[] {
  return [
    {
      id: DEFAULT_POLICY_RULE_IDS.GLOBAL_VERDICT,
      enabled: true,
      signal: 'global_verdict',
      action: 'admin_notify',
      statuses: ['confirmed'],
      min_confirmed_servers: null,
      message: null,
      ban_duration_minutes: null,
    },
    {
      id: DEFAULT_POLICY_RULE_IDS.ACCOUNT_AGE,
      enabled: true,
      signal: 'account_age',
      action: 'admin_notify',
      max_account_age_days: 3,
      match_unknown_age: false,
      message: null,
      ban_duration_minutes: null,
    },
    {
      id: DEFAULT_POLICY_RULE_IDS.VPN,
      enabled: true,
      signal: 'vpn',
      action: 'admin_notify',
      min_vpn_confidence: 'likely',
      message: null,
      ban_duration_minutes: null,
    },
    {
      id: DEFAULT_POLICY_RULE_IDS.ALT_ACCOUNT,
      enabled: true,
      signal: 'alt_account',
      action: 'admin_notify',
      min_alt_confidence: 'medium',
      require_linked_confirmed_case: false,
      message: null,
      ban_duration_minutes: null,
    },
  ];
}

/** Fresh (mutable) default policy. */
export function buildDefaultPolicy(version = 1): ServerPolicy {
  return {
    version,
    backend_unavailable_action: 'allow',
    notify_on_enforcement: true,
    honor_global_bypasses: false,
    whitelist_url: null,
    rules: buildDefaultPolicyRules(),
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

/** Deeply frozen default policy (use buildDefaultPolicy() for a mutable copy). */
export const DEFAULT_POLICY: Readonly<ServerPolicy> = deepFreeze(buildDefaultPolicy());
