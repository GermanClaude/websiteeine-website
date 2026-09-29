using System.Collections.Generic;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Default policy (ARCHITECTURE §7.4, mirror of shared/src/policy/defaults.ts): every rule only
    /// notifies admins; nothing is kicked by default; backend unavailable → allow.
    /// </summary>
    public static class DefaultPolicy
    {
        public const string GlobalVerdictRuleId = "default-global-verdict";
        public const string AccountAgeRuleId = "default-account-age";
        public const string VpnRuleId = "default-vpn";
        public const string AltAccountRuleId = "default-alt-account";

        /// <summary>Fresh, mutable copy of the default policy.</summary>
        public static ServerPolicy Build(int version = 1)
        {
            return new ServerPolicy
            {
                Version = version,
                BackendUnavailableAction = PolicyActions.AllowName,
                NotifyOnEnforcement = true,
                HonorGlobalBypasses = false,
                WhitelistUrl = null,
                Rules = BuildRules(),
            };
        }

        /// <summary>Fresh copies of the default rules, in evaluation order.</summary>
        public static List<PolicyRule> BuildRules()
        {
            return new List<PolicyRule>
            {
                new PolicyRule
                {
                    Id = GlobalVerdictRuleId,
                    Signal = PolicySignals.GlobalVerdictName,
                    Action = PolicyActions.AdminNotifyName,
                    Statuses = new List<string> { GlobalStatuses.Confirmed },
                },
                new PolicyRule
                {
                    Id = AccountAgeRuleId,
                    Signal = PolicySignals.AccountAgeName,
                    Action = PolicyActions.AdminNotifyName,
                    MaxAccountAgeDays = 3,
                    MatchUnknownAge = false,
                },
                new PolicyRule
                {
                    Id = VpnRuleId,
                    Signal = PolicySignals.VpnName,
                    Action = PolicyActions.AdminNotifyName,
                    MinVpnConfidence = VpnConfidences.Likely,
                },
                new PolicyRule
                {
                    Id = AltAccountRuleId,
                    Signal = PolicySignals.AltAccountName,
                    Action = PolicyActions.AdminNotifyName,
                    MinAltConfidence = AltConfidences.Medium,
                    RequireLinkedConfirmedCase = false,
                },
            };
        }
    }
}
