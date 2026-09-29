using System;
using System.Collections.Generic;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Local policy evaluator (ARCHITECTURE §7.2) — exact port of shared/src/policy/engine.ts,
    /// verified against shared/test-vectors/policy.json. Pure and deterministic.
    /// <list type="number">
    /// <item>Walk enabled rules in array order; ignore rules whose signal or action is unknown.</item>
    /// <item>A matching rule is bypassed if an active bypass of its exempt type exists, else applied.</item>
    /// <item>action = most severe applied action (allow when none).</item>
    /// <item>message = first applied rule with the winning action, else the action's default; placeholders once.</item>
    /// <item>notify_admins = any applied admin_notify/require_review, or notify_on_enforcement and action ≥ warn.</item>
    /// <item>ban_duration_minutes = first applied ban rule's duration (null → 0) when the action is ban.</item>
    /// </list>
    /// </summary>
    public static class PolicyEngine
    {
        public static PolicyDecision Evaluate(PolicyEvaluationInput input, ServerPolicy policy, PolicyEvaluationContext? context = null)
        {
            if (input == null)
            {
                throw new ArgumentNullException(nameof(input));
            }

            if (policy == null)
            {
                throw new ArgumentNullException(nameof(policy));
            }

            context ??= PolicyEvaluationContext.Empty;
            var bypassTypes = new HashSet<string>(input.BypassTypes, StringComparer.Ordinal);
            var applied = new List<PolicyRuleOutcome>();
            var bypassed = new List<PolicyRuleOutcome>();
            var appliedRules = new List<PolicyRule>();

            foreach (var rule in policy.Rules ?? new List<PolicyRule>())
            {
                if (rule == null || !rule.Enabled
                    || !PolicySignals.TryParse(rule.Signal, out var signal)
                    || !PolicyActions.TryParse(rule.Action, out var action))
                {
                    continue;
                }

                var reasonCode = Match(rule, signal, input);
                if (reasonCode == null)
                {
                    continue;
                }

                var outcome = new PolicyRuleOutcome(rule.Id, signal, action, reasonCode.Value);
                if (bypassTypes.Contains(PolicySignals.ExemptingBypassType(signal)))
                {
                    bypassed.Add(outcome);
                }
                else
                {
                    applied.Add(outcome);
                    appliedRules.Add(rule);
                }
            }

            var winning = PolicyAction.Allow;
            foreach (var outcome in applied)
            {
                if (outcome.Action > winning)
                {
                    winning = outcome.Action;
                }
            }

            PolicyRule? winningRule = null;
            for (var i = 0; i < applied.Count; i++)
            {
                if (applied[i].Action == winning)
                {
                    winningRule = appliedRules[i];
                    break;
                }
            }

            var template = !string.IsNullOrEmpty(winningRule?.Message) ? winningRule!.Message : PolicyMessages.DefaultFor(winning);
            var message = template == null
                ? null
                : PolicyMessages.Render(template, input.CaseId, input.AccountAgeDays, policy.WhitelistUrl, context.ServerName);

            var notifyAdmins = policy.NotifyOnEnforcement && winning >= PolicyAction.Warn;
            foreach (var outcome in applied)
            {
                if (outcome.Action == PolicyAction.AdminNotify || outcome.Action == PolicyAction.RequireReview)
                {
                    notifyAdmins = true;
                    break;
                }
            }

            int? banDurationMinutes = winning == PolicyAction.Ban ? (winningRule?.BanDurationMinutes ?? 0) : (int?)null;
            return new PolicyDecision(winning, applied, bypassed, notifyAdmins, message, banDurationMinutes);
        }

        /// <summary>Tests one rule's condition; returns its reason code when it matches.</summary>
        public static PolicyReasonCode? Match(PolicyRule rule, PolicySignal signal, PolicyEvaluationInput input)
        {
            if (rule == null)
            {
                throw new ArgumentNullException(nameof(rule));
            }

            if (input == null)
            {
                throw new ArgumentNullException(nameof(input));
            }

            switch (signal)
            {
                case PolicySignal.GlobalVerdict:
                    if (rule.Statuses == null || !rule.Statuses.Contains(input.GlobalStatus))
                    {
                        return null;
                    }

                    if (rule.MinConfirmedServers.HasValue && input.ConfirmedServers < rule.MinConfirmedServers.Value)
                    {
                        return null;
                    }

                    return PolicyReasonCode.GlobalVerdictMatch;

                case PolicySignal.AccountAge:
                    if (!input.AccountAgeDays.HasValue)
                    {
                        return rule.MatchUnknownAge == true ? PolicyReasonCode.AccountAgeUnknown : (PolicyReasonCode?)null;
                    }

                    return rule.MaxAccountAgeDays.HasValue && input.AccountAgeDays.Value < rule.MaxAccountAgeDays.Value
                        ? PolicyReasonCode.AccountAgeBelowThreshold
                        : (PolicyReasonCode?)null;

                case PolicySignal.Vpn:
                {
                    var min = VpnConfidences.Rank(rule.MinVpnConfidence);
                    if (min < 0)
                    {
                        return null;
                    }

                    return VpnConfidences.Rank(input.VpnConfidence) >= min ? PolicyReasonCode.VpnConfidence : (PolicyReasonCode?)null;
                }

                case PolicySignal.AltAccount:
                {
                    if (!input.AltAccountPossible)
                    {
                        return null;
                    }

                    var min = AltConfidences.Rank(rule.MinAltConfidence);
                    if (min < 0 || AltConfidences.Rank(input.AltAccountConfidence) < min)
                    {
                        return null;
                    }

                    if (rule.RequireLinkedConfirmedCase == true && input.LinkedConfirmedCases.Count == 0)
                    {
                        return null;
                    }

                    return PolicyReasonCode.AltAccountConfidence;
                }

                case PolicySignal.OpenReports:
                    return rule.MinOpenReports.HasValue && input.OpenReports >= rule.MinOpenReports.Value
                        ? PolicyReasonCode.OpenReportsThreshold
                        : (PolicyReasonCode?)null;

                default:
                    return null;
            }
        }
    }
}
