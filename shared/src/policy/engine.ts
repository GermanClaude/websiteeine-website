/**
 * Reference policy evaluator (ARCHITECTURE §7.2) — pure and deterministic.
 * Mirrored by ScpslTrust.Core.Policy.PolicyEngine (C#); both are verified against
 * shared/test-vectors/policy.json.
 *
 * Algorithm:
 *  1. For each enabled rule (array order) whose signal AND action are known, test its condition.
 *     Rules with unknown signals or actions are ignored (forward compatibility).
 *  2. A matching rule is `bypassed` if input.bypass.types contains BYPASS_TYPE_FOR_SIGNAL[signal],
 *     otherwise `applied`.
 *  3. action = most severe applied action (`allow` if none).
 *  4. message = message of the first applied rule with the winning action; when that message is
 *     null/empty, the default text of the action. Placeholders are substituted once.
 *  5. notify_admins = any applied admin_notify/require_review, or
 *     (notify_on_enforcement && severity(action) ≥ severity(warn)).
 *  6. ban_duration_minutes = (first applied ban rule).ban_duration_minutes ?? 0 when action is ban,
 *     otherwise null.
 */
import {
  altConfidenceRank,
  BYPASS_TYPE_FOR_SIGNAL,
  isPolicyAction,
  isPolicySignal,
  maxPolicyAction,
  PolicyAction,
  policyActionSeverity,
  PolicyReasonCode,
  vpnConfidenceRank,
  type BypassType,
} from '../enums';
import type {
  PolicyDecision,
  PolicyEvaluationInput,
  PolicyRule,
  PolicyRuleOutcome,
} from '../schemas/policy';
import { DEFAULT_ACTION_MESSAGES, renderPolicyMessage } from './messages';

/** A rule from a newer backend/config whose signal or action this version does not know. */
export interface UnrecognizedPolicyRule {
  readonly id: string;
  readonly enabled: boolean;
  readonly signal: string;
  readonly action: string;
  readonly message?: string | null;
  readonly ban_duration_minutes?: number | null;
}

export type EvaluablePolicyRule = PolicyRule | UnrecognizedPolicyRule;

/** Minimal policy shape the engine reads (ServerPolicy and PolicyDraft satisfy it). */
export interface EvaluablePolicy {
  readonly notify_on_enforcement: boolean;
  readonly whitelist_url?: string | null;
  readonly rules: readonly EvaluablePolicyRule[];
}

export interface PolicyEvaluationContext {
  /** Substituted for `{server_name}` ('' when absent). */
  readonly server_name?: string | null;
}

/** True when both the signal and the action of the rule are known to this engine version. */
export function isRecognizedPolicyRule(rule: EvaluablePolicyRule): rule is PolicyRule {
  return isPolicySignal(rule.signal) && isPolicyAction(rule.action);
}

/** Tests one rule's condition; returns its reason code when it matches, else null. */
export function matchPolicyRule(rule: PolicyRule, input: PolicyEvaluationInput): PolicyReasonCode | null {
  switch (rule.signal) {
    case 'global_verdict': {
      if (!rule.statuses.includes(input.global_status)) return null;
      const min = rule.min_confirmed_servers ?? null;
      if (min !== null && input.confirmed_servers < min) return null;
      return PolicyReasonCode.GLOBAL_VERDICT_MATCH;
    }
    case 'account_age': {
      const days = input.account_age.days;
      if (days === null) return rule.match_unknown_age === true ? PolicyReasonCode.ACCOUNT_AGE_UNKNOWN : null;
      return days < rule.max_account_age_days ? PolicyReasonCode.ACCOUNT_AGE_BELOW_THRESHOLD : null;
    }
    case 'vpn': {
      const min = vpnConfidenceRank(rule.min_vpn_confidence);
      if (min < 0) return null;
      return vpnConfidenceRank(input.vpn.confidence) >= min ? PolicyReasonCode.VPN_CONFIDENCE : null;
    }
    case 'alt_account': {
      if (!input.alt_account.possible) return null;
      const min = altConfidenceRank(rule.min_alt_confidence);
      if (min < 0 || altConfidenceRank(input.alt_account.confidence) < min) return null;
      if (rule.require_linked_confirmed_case === true && input.alt_account.linked_confirmed_cases.length === 0) {
        return null;
      }
      return PolicyReasonCode.ALT_ACCOUNT_CONFIDENCE;
    }
    case 'open_reports':
      return input.open_reports >= rule.min_open_reports ? PolicyReasonCode.OPEN_REPORTS_THRESHOLD : null;
    default: {
      const unreachable: never = rule;
      return unreachable;
    }
  }
}

/** Evaluates a server policy against player-check information. Never throws for valid input. */
export function evaluatePolicy(
  input: PolicyEvaluationInput,
  policy: EvaluablePolicy,
  context: PolicyEvaluationContext = {},
): PolicyDecision {
  const bypassTypes = new Set<BypassType>(input.bypass.types);
  const applied: PolicyRuleOutcome[] = [];
  const bypassed: PolicyRuleOutcome[] = [];
  const appliedRules: PolicyRule[] = [];

  for (const rule of policy.rules) {
    if (rule.enabled !== true || !isRecognizedPolicyRule(rule)) continue;
    const reasonCode = matchPolicyRule(rule, input);
    if (reasonCode === null) continue;
    const outcome: PolicyRuleOutcome = {
      rule_id: rule.id,
      signal: rule.signal,
      action: rule.action,
      reason_code: reasonCode,
    };
    if (bypassTypes.has(BYPASS_TYPE_FOR_SIGNAL[rule.signal])) {
      bypassed.push(outcome);
    } else {
      applied.push(outcome);
      appliedRules.push(rule);
    }
  }

  const action = maxPolicyAction(appliedRules.map((rule) => rule.action));
  const winningRule = appliedRules.find((rule) => rule.action === action);
  const customMessage = winningRule?.message;
  const template =
    customMessage !== undefined && customMessage !== null && customMessage !== ''
      ? customMessage
      : DEFAULT_ACTION_MESSAGES[action];
  const message =
    template === null
      ? null
      : renderPolicyMessage(template, {
          case_id: input.case_id ?? '',
          days: input.account_age.days === null ? '' : String(input.account_age.days),
          whitelist_url: policy.whitelist_url ?? '',
          server_name: context.server_name ?? '',
        });

  const notifyAdmins =
    appliedRules.some((rule) => rule.action === PolicyAction.ADMIN_NOTIFY || rule.action === PolicyAction.REQUIRE_REVIEW) ||
    (policy.notify_on_enforcement && policyActionSeverity(action) >= policyActionSeverity(PolicyAction.WARN));

  const banDurationMinutes = action === PolicyAction.BAN ? (winningRule?.ban_duration_minutes ?? 0) : null;

  return {
    action,
    applied,
    bypassed,
    notify_admins: notifyAdmins,
    message,
    ban_duration_minutes: banDurationMinutes,
  };
}
