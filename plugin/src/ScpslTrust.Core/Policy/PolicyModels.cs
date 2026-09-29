using System.Collections.Generic;
using System.ComponentModel;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Server policy (ARCHITECTURE §7.1), shared by <c>GET /servers/policy</c> (JSON, snake_case) and the
    /// plugin's <c>local_policy</c> (LabAPI YAML, underscored names). Signals, actions and thresholds
    /// are strings so rules written by newer backends deserialize and are ignored by the engine.
    /// </summary>
    public sealed class ServerPolicy
    {
        [Description("Policy version (informational for local policies).")]
        public int Version { get; set; } = 1;

        [Description("Action when the trust backend is unreachable: allow | admin_notify | kick.")]
        public string BackendUnavailableAction { get; set; } = PolicyActions.AllowName;

        [Description("Notify online staff whenever a player is warned, kicked or banned by the policy.")]
        public bool NotifyOnEnforcement { get; set; } = true;

        [Description("Also honor global (network-wide) bypasses, not only bypasses granted by this server.")]
        public bool HonorGlobalBypasses { get; set; }

        [Description("URL shown to players for whitelist requests ({whitelist_url} placeholder).")]
        public string? WhitelistUrl { get; set; }

        [Description("Rules evaluated in order. Signals: global_verdict, account_age, vpn, alt_account, open_reports. Actions: allow, admin_notify, warn, require_review, require_whitelist, kick, ban.")]
        public List<PolicyRule> Rules { get; set; } = new List<PolicyRule>();
    }

    /// <summary>
    /// One policy rule. Only the condition fields of its <see cref="Signal"/> are relevant:
    /// global_verdict → statuses, min_confirmed_servers; account_age → max_account_age_days, match_unknown_age;
    /// vpn → min_vpn_confidence; alt_account → min_alt_confidence, require_linked_confirmed_case;
    /// open_reports → min_open_reports.
    /// </summary>
    public sealed class PolicyRule
    {
        public string Id { get; set; } = string.Empty;

        /// <summary>Missing <c>enabled</c> means enabled.</summary>
        public bool Enabled { get; set; } = true;

        public string Signal { get; set; } = string.Empty;

        public string Action { get; set; } = string.Empty;

        /// <summary>Custom message (≤ 256 chars); placeholders {case_id}, {days}, {whitelist_url}, {server_name}.</summary>
        public string? Message { get; set; }

        /// <summary>Ban rules only; 0 or null = permanent.</summary>
        public int? BanDurationMinutes { get; set; }

        /// <summary>global_verdict: matching GlobalStatus values.</summary>
        public List<string>? Statuses { get; set; }

        /// <summary>global_verdict: minimum distinct confirming servers (null = no minimum).</summary>
        public int? MinConfirmedServers { get; set; }

        /// <summary>account_age: matches when days &lt; this value.</summary>
        public int? MaxAccountAgeDays { get; set; }

        /// <summary>account_age: also match when the account age is unknown.</summary>
        public bool? MatchUnknownAge { get; set; }

        /// <summary>vpn: possible | likely | confirmed.</summary>
        public string? MinVpnConfidence { get; set; }

        /// <summary>alt_account: low | medium | high.</summary>
        public string? MinAltConfidence { get; set; }

        /// <summary>alt_account: require a confirmed case on a linked account.</summary>
        public bool? RequireLinkedConfirmedCase { get; set; }

        /// <summary>open_reports: minimum number of open reports.</summary>
        public int? MinOpenReports { get; set; }
    }
}
