using System.Globalization;
using System.Text.RegularExpressions;

namespace ScpslTrust.Core.Policy
{
    /// <summary>Default decision messages and placeholder rendering (mirror of shared/src/policy/messages.ts).</summary>
    public static class PolicyMessages
    {
        private static readonly Regex PlaceholderPattern = new Regex(
            @"\{(case_id|days|whitelist_url|server_name)\}",
            RegexOptions.CultureInvariant | RegexOptions.Compiled);

        /// <summary>
        /// Default text of an action when the winning rule has no message (null for allow).
        /// admin_notify / require_review are staff-facing; the others are shown to the player.
        /// </summary>
        public static string? DefaultFor(PolicyAction action)
        {
            switch (action)
            {
                case PolicyAction.AdminNotify:
                    return "Player matched a server policy rule.";
                case PolicyAction.Warn:
                    return "Your account has been flagged by this server's trust policy.";
                case PolicyAction.RequireReview:
                    return "Player requires staff review under the server policy.";
                case PolicyAction.RequireWhitelist:
                    return "A VPN/proxy was detected. Request a whitelist at {whitelist_url}";
                case PolicyAction.Kick:
                    return "You were removed by this server's trust policy.";
                case PolicyAction.Ban:
                    return "You have been banned by this server's trust policy.";
                default:
                    return null;
            }
        }

        /// <summary>
        /// Single-pass substitution of <c>{case_id}</c>, <c>{days}</c>, <c>{whitelist_url}</c>, <c>{server_name}</c>.
        /// Substituted values are not re-scanned; unknown, differently cased or spaced placeholders stay literal.
        /// </summary>
        public static string Render(string template, string? caseId, int? days, string? whitelistUrl, string? serverName)
        {
            var daysText = days.HasValue ? days.Value.ToString(CultureInfo.InvariantCulture) : string.Empty;
            return PlaceholderPattern.Replace(template, match =>
            {
                switch (match.Groups[1].Value)
                {
                    case "case_id":
                        return caseId ?? string.Empty;
                    case "days":
                        return daysText;
                    case "whitelist_url":
                        return whitelistUrl ?? string.Empty;
                    default:
                        return serverName ?? string.Empty;
                }
            });
        }
    }
}
