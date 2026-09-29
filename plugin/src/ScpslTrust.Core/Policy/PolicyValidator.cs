using System;
using System.Collections.Generic;
using System.Globalization;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Diagnostics for policies written by hand (plugin <c>local_policy</c>). The engine itself never
    /// needs validation — it ignores what it does not understand — but admins should learn about
    /// rules that can never match. Mirrors the constraints of shared/src/schemas/policy.ts.
    /// </summary>
    public static class PolicyValidator
    {
        public const int MaxRules = 50;
        public const int MaxMessageLength = 256;
        public const int MaxRuleIdLength = 64;
        public const int MaxAccountAgeDays = 3650;
        public const int MaxConfirmedServers = 1000;
        public const int MaxOpenReports = 1000;
        public const int MaxBanDurationMinutes = 5256000;

        private static readonly string[] BackendUnavailableActions = { PolicyActions.AllowName, PolicyActions.AdminNotifyName, PolicyActions.KickName };

        /// <summary>Returns human-readable problems (empty when the policy is well-formed).</summary>
        public static IReadOnlyList<string> Validate(ServerPolicy? policy)
        {
            var issues = new List<string>();
            if (policy == null)
            {
                issues.Add("policy is missing");
                return issues;
            }

            if (policy.Version < 1)
            {
                issues.Add("version must be >= 1");
            }

            if (Array.IndexOf(BackendUnavailableActions, policy.BackendUnavailableAction) < 0)
            {
                issues.Add("backend_unavailable_action must be allow, admin_notify or kick (treated as allow)");
            }

            if (policy.WhitelistUrl != null && policy.WhitelistUrl.Length > 0 && !IsHttpUrl(policy.WhitelistUrl))
            {
                issues.Add("whitelist_url must be an http(s) URL");
            }

            var rules = policy.Rules ?? new List<PolicyRule>();
            if (rules.Count > MaxRules)
            {
                issues.Add("at most " + MaxRules + " rules are allowed");
            }

            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < rules.Count; i++)
            {
                var rule = rules[i];
                var prefix = "rules[" + i.ToString(CultureInfo.InvariantCulture) + "]";
                if (rule == null)
                {
                    issues.Add(prefix + " is empty");
                    continue;
                }

                ValidateRule(rule, prefix, ids, issues);
            }

            return issues;
        }

        private static void ValidateRule(PolicyRule rule, string prefix, HashSet<string> ids, List<string> issues)
        {
            if (string.IsNullOrEmpty(rule.Id) || rule.Id.Length > MaxRuleIdLength)
            {
                issues.Add(prefix + ".id must be 1-" + MaxRuleIdLength + " characters");
            }
            else if (!ids.Add(rule.Id))
            {
                issues.Add(prefix + ".id '" + rule.Id + "' is duplicated");
            }

            if (!PolicyActions.TryParse(rule.Action, out var action))
            {
                issues.Add(prefix + ".action '" + rule.Action + "' is unknown (rule ignored)");
            }

            if (rule.Message != null && rule.Message.Length > MaxMessageLength)
            {
                issues.Add(prefix + ".message must be at most " + MaxMessageLength + " characters");
            }

            if (rule.BanDurationMinutes.HasValue)
            {
                if (action != PolicyAction.Ban)
                {
                    issues.Add(prefix + ".ban_duration_minutes is only used by ban rules");
                }
                else if (rule.BanDurationMinutes.Value < 0 || rule.BanDurationMinutes.Value > MaxBanDurationMinutes)
                {
                    issues.Add(prefix + ".ban_duration_minutes must be between 0 and " + MaxBanDurationMinutes);
                }
            }

            if (!PolicySignals.TryParse(rule.Signal, out var signal))
            {
                issues.Add(prefix + ".signal '" + rule.Signal + "' is unknown (rule ignored)");
                return;
            }

            switch (signal)
            {
                case PolicySignal.GlobalVerdict:
                    if (rule.Statuses == null || rule.Statuses.Count == 0)
                    {
                        issues.Add(prefix + ".statuses must list at least one global status");
                    }
                    else
                    {
                        foreach (var status in rule.Statuses)
                        {
                            if (!GlobalStatuses.IsKnown(status))
                            {
                                issues.Add(prefix + ".statuses contains unknown status '" + status + "'");
                            }
                        }
                    }

                    CheckRange(rule.MinConfirmedServers, 0, MaxConfirmedServers, prefix + ".min_confirmed_servers", issues, required: false);
                    break;
                case PolicySignal.AccountAge:
                    CheckRange(rule.MaxAccountAgeDays, 1, MaxAccountAgeDays, prefix + ".max_account_age_days", issues, required: true);
                    break;
                case PolicySignal.Vpn:
                    if (VpnConfidences.Rank(rule.MinVpnConfidence) < 1)
                    {
                        issues.Add(prefix + ".min_vpn_confidence must be possible, likely or confirmed");
                    }

                    break;
                case PolicySignal.AltAccount:
                    if (AltConfidences.Rank(rule.MinAltConfidence) < 1)
                    {
                        issues.Add(prefix + ".min_alt_confidence must be low, medium or high");
                    }

                    break;
                case PolicySignal.OpenReports:
                    CheckRange(rule.MinOpenReports, 1, MaxOpenReports, prefix + ".min_open_reports", issues, required: true);
                    break;
            }
        }

        private static void CheckRange(int? value, int min, int max, string field, List<string> issues, bool required)
        {
            if (!value.HasValue)
            {
                if (required)
                {
                    issues.Add(field + " is required");
                }

                return;
            }

            if (value.Value < min || value.Value > max)
            {
                issues.Add(field + " must be between " + min + " and " + max);
            }
        }

        private static bool IsHttpUrl(string value)
        {
            return Uri.TryCreate(value, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
        }
    }
}
