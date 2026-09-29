using System;
using System.Collections.Generic;

namespace ScpslTrust.Core.Policy
{
    /// <summary>Local enforcement action; the numeric value is the severity (§7.2).</summary>
    public enum PolicyAction
    {
        Allow = 0,
        AdminNotify = 1,
        Warn = 2,
        RequireReview = 3,
        RequireWhitelist = 4,
        Kick = 5,
        Ban = 6,
    }

    public enum PolicySignal
    {
        GlobalVerdict,
        AccountAge,
        Vpn,
        AltAccount,
        OpenReports,
    }

    /// <summary><c>reason_code</c> of an applied or bypassed rule.</summary>
    public enum PolicyReasonCode
    {
        GlobalVerdictMatch,
        AccountAgeBelowThreshold,
        AccountAgeUnknown,
        VpnConfidence,
        AltAccountConfidence,
        OpenReportsThreshold,
    }

    /// <summary>Wire names and severity of <see cref="PolicyAction"/>.</summary>
    public static class PolicyActions
    {
        public const string AllowName = "allow";
        public const string AdminNotifyName = "admin_notify";
        public const string WarnName = "warn";
        public const string RequireReviewName = "require_review";
        public const string RequireWhitelistName = "require_whitelist";
        public const string KickName = "kick";
        public const string BanName = "ban";

        private static readonly string[] Names = { AllowName, AdminNotifyName, WarnName, RequireReviewName, RequireWhitelistName, KickName, BanName };

        public static IReadOnlyList<string> All => Names;

        /// <summary>Exact, case-sensitive match of a wire value (unknown values return false).</summary>
        public static bool TryParse(string? value, out PolicyAction action)
        {
            var index = value == null ? -1 : Array.IndexOf(Names, value);
            action = index < 0 ? PolicyAction.Allow : (PolicyAction)index;
            return index >= 0;
        }

        public static string ToWire(PolicyAction action) => Names[(int)action];

        public static int Severity(PolicyAction action) => (int)action;
    }

    /// <summary>Wire names of <see cref="PolicySignal"/>.</summary>
    public static class PolicySignals
    {
        public const string GlobalVerdictName = "global_verdict";
        public const string AccountAgeName = "account_age";
        public const string VpnName = "vpn";
        public const string AltAccountName = "alt_account";
        public const string OpenReportsName = "open_reports";

        private static readonly string[] Names = { GlobalVerdictName, AccountAgeName, VpnName, AltAccountName, OpenReportsName };

        public static IReadOnlyList<string> All => Names;

        public static bool TryParse(string? value, out PolicySignal signal)
        {
            var index = value == null ? -1 : Array.IndexOf(Names, value);
            signal = index < 0 ? PolicySignal.GlobalVerdict : (PolicySignal)index;
            return index >= 0;
        }

        public static string ToWire(PolicySignal signal) => Names[(int)signal];

        /// <summary>Bypass type that exempts a signal (§7.2 step 2).</summary>
        public static string ExemptingBypassType(PolicySignal signal)
        {
            switch (signal)
            {
                case PolicySignal.Vpn:
                    return BypassTypeNames.VpnWhitelist;
                case PolicySignal.AccountAge:
                    return BypassTypeNames.AccountAgeWhitelist;
                case PolicySignal.AltAccount:
                    return BypassTypeNames.AltAccountWhitelist;
                case PolicySignal.GlobalVerdict:
                case PolicySignal.OpenReports:
                    return BypassTypeNames.VerdictOverride;
                default:
                    throw new ArgumentOutOfRangeException(nameof(signal));
            }
        }
    }

    public static class PolicyReasonCodes
    {
        private static readonly string[] Names =
        {
            "global_verdict_match",
            "account_age_below_threshold",
            "account_age_unknown",
            "vpn_confidence",
            "alt_account_confidence",
            "open_reports_threshold",
        };

        public static string ToWire(PolicyReasonCode code) => Names[(int)code];
    }

    public static class BypassTypeNames
    {
        public const string VpnWhitelist = "vpn_whitelist";
        public const string AccountAgeWhitelist = "account_age_whitelist";
        public const string AltAccountWhitelist = "alt_account_whitelist";
        public const string VerdictOverride = "verdict_override";
    }

    /// <summary>GlobalStatus values in ascending priority.</summary>
    public static class GlobalStatuses
    {
        public const string None = "none";
        public const string Rejected = "rejected";
        public const string Inconclusive = "inconclusive";
        public const string Reported = "reported";
        public const string UnderReview = "under_review";
        public const string Confirmed = "confirmed";

        private static readonly string[] Names = { None, Rejected, Inconclusive, Reported, UnderReview, Confirmed };

        public static IReadOnlyList<string> All => Names;

        public static bool IsKnown(string? value) => value != null && Array.IndexOf(Names, value) >= 0;
    }

    /// <summary>VpnConfidence ordinal: not_detected &lt; possible &lt; likely &lt; confirmed; −1 for unknown values.</summary>
    public static class VpnConfidences
    {
        public const string NotDetected = "not_detected";
        public const string Possible = "possible";
        public const string Likely = "likely";
        public const string Confirmed = "confirmed";

        private static readonly string[] Names = { NotDetected, Possible, Likely, Confirmed };

        public static IReadOnlyList<string> All => Names;

        public static int Rank(string? value) => value == null ? -1 : Array.IndexOf(Names, value);
    }

    /// <summary>AltConfidence ordinal: none &lt; low &lt; medium &lt; high; −1 for unknown values.</summary>
    public static class AltConfidences
    {
        public const string None = "none";
        public const string Low = "low";
        public const string Medium = "medium";
        public const string High = "high";

        private static readonly string[] Names = { None, Low, Medium, High };

        public static IReadOnlyList<string> All => Names;

        public static int Rank(string? value) => value == null ? -1 : Array.IndexOf(Names, value);
    }
}
