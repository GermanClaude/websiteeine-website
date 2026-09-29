using System;
using System.Collections.Generic;
using ScpslTrust.Core.Players;

namespace ScpslTrust.Core.Api.Models
{
    /// <summary>POST /player/check (§6.1).</summary>
    public sealed class PlayerCheckRequest
    {
        public PlayerRef? Player { get; set; }

        /// <summary>In-game nickname, at most 64 characters.</summary>
        public string? Nickname { get; set; }

        /// <summary>Used transiently by the backend for VPN/alt analysis; never stored raw.</summary>
        public string? Ip { get; set; }

        /// <summary>Untrusted account-creation hint.</summary>
        public DateTimeOffset? AccountCreatedAt { get; set; }

        public override string ToString() => "PlayerCheckRequest(" + Player + ")";
    }

    /// <summary>
    /// Pure information about a player — deliberately contains no enforcement action (R1).
    /// Enum-like values are kept as strings so values added by newer backends never break parsing.
    /// </summary>
    public sealed class PlayerCheckResponse : IApiResponse
    {
        public PlayerCheckPlayer? Player { get; set; }

        /// <summary>none | rejected | inconclusive | reported | under_review | confirmed.</summary>
        public string GlobalStatus { get; set; } = "none";

        public string? CaseId { get; set; }

        public List<PlayerCheckCase> Cases { get; set; } = new List<PlayerCheckCase>();

        public int Reports { get; set; }

        public int OpenReports { get; set; }

        public int ConfirmedServers { get; set; }

        public int IndependentConfirmedServers { get; set; }

        public PlayerCheckAccountAge AccountAge { get; set; } = new PlayerCheckAccountAge();

        public PlayerCheckVpn Vpn { get; set; } = new PlayerCheckVpn();

        public PlayerCheckBypass Bypass { get; set; } = new PlayerCheckBypass();

        public PlayerCheckAltAccount AltAccount { get; set; } = new PlayerCheckAltAccount();

        public int? PolicyVersion { get; set; }

        public DateTimeOffset? CheckedAt { get; set; }

        public void Validate()
        {
            Require.NotEmpty(GlobalStatus, "global_status");
            Require.NotNull(AccountAge, "account_age");
            Require.NotNull(Vpn, "vpn");
            Require.NotNull(Bypass, "bypass");
            Require.NotNull(AltAccount, "alt_account");
            Require.NonNegative(Reports, "reports");
            Require.NonNegative(OpenReports, "open_reports");
            Require.NonNegative(ConfirmedServers, "confirmed_servers");
            Require.NonNegative(IndependentConfirmedServers, "independent_confirmed_servers");
            Require.NotEmpty(Vpn.Confidence, "vpn.confidence");
            Require.NotEmpty(AltAccount.Confidence, "alt_account.confidence");
            Require.That(AccountAge.Days == null || AccountAge.Days >= 0, "Response field 'account_age.days' must not be negative.");
            Cases = Require.List(Cases);
            Bypass.Types = Require.List(Bypass.Types);
            Bypass.Bypasses = Require.List(Bypass.Bypasses);
            AltAccount.Signals = Require.List(AltAccount.Signals);
            AltAccount.LinkedConfirmedCases = Require.List(AltAccount.LinkedConfirmedCases);
        }
    }

    public sealed class PlayerCheckPlayer
    {
        public string? Type { get; set; }

        public string? Id { get; set; }

        public string? UserId { get; set; }

        public DateTimeOffset? FirstSeenAt { get; set; }
    }

    public sealed class PlayerCheckCase
    {
        public string CaseId { get; set; } = string.Empty;

        public string Verdict { get; set; } = string.Empty;

        public string Status { get; set; } = string.Empty;

        public int ConfirmedServers { get; set; }
    }

    public sealed class PlayerCheckAccountAge
    {
        /// <summary>Null when unknown.</summary>
        public int? Days { get; set; }

        public DateTimeOffset? CreatedAt { get; set; }

        /// <summary>steam | server_reported | unknown.</summary>
        public string? Source { get; set; }
    }

    public sealed class PlayerCheckVpn
    {
        public bool Detected { get; set; }

        /// <summary>not_detected | possible | likely | confirmed.</summary>
        public string Confidence { get; set; } = "not_detected";

        public string? Type { get; set; }

        /// <summary>False when no ip was sent or every provider failed.</summary>
        public bool? Checked { get; set; }

        /// <summary>e.g. provider_unavailable.</summary>
        public string? Error { get; set; }
    }

    public sealed class PlayerCheckBypass
    {
        public bool Active { get; set; }

        /// <summary>Types of all active bypasses considered for this server.</summary>
        public List<string> Types { get; set; } = new List<string>();

        public List<BypassSummary> Bypasses { get; set; } = new List<BypassSummary>();
    }

    public sealed class PlayerCheckAltAccount
    {
        public bool Possible { get; set; }

        /// <summary>none | low | medium | high.</summary>
        public string Confidence { get; set; } = "none";

        public List<string> Signals { get; set; } = new List<string>();

        public List<string> LinkedConfirmedCases { get; set; } = new List<string>();
    }

    /// <summary>Compact bypass as returned to the plugin.</summary>
    public sealed class BypassSummary
    {
        public string Id { get; set; } = string.Empty;

        public string Type { get; set; } = string.Empty;

        public string Scope { get; set; } = string.Empty;

        public DateTimeOffset? ExpiresAt { get; set; }
    }

    /// <summary>POST /player/bypass/check (§6.2).</summary>
    public sealed class BypassCheckRequest
    {
        public PlayerRef? Player { get; set; }

        public string? Ip { get; set; }

        public List<BypassType>? Types { get; set; }
    }

    public sealed class BypassCheckResponse : IApiResponse
    {
        public bool Vpn { get; set; }

        public bool Bypass { get; set; }

        public string? BypassType { get; set; }

        public DateTimeOffset? ExpiresAt { get; set; }

        public List<BypassSummary> Bypasses { get; set; } = new List<BypassSummary>();

        public void Validate()
        {
            Bypasses = Require.List(Bypasses);
        }
    }

    /// <summary>POST /player/link (§6.6).</summary>
    public sealed class PlayerLinkRequest
    {
        public PlayerRef? Player { get; set; }

        public string Code { get; set; } = string.Empty;
    }

    public sealed class PlayerLinkResponse : IApiResponse
    {
        public bool Linked { get; set; }

        /// <summary>Web account name, shown to the player who typed the code.</summary>
        public string Username { get; set; } = string.Empty;

        public void Validate()
        {
            Require.That(Linked, "Response field 'linked' must be true.");
            Require.NotEmpty(Username, "username");
        }
    }

    /// <summary>POST /server/reports (§6.5).</summary>
    public sealed class ServerReportRequest
    {
        public PlayerRef? Player { get; set; }

        public PlayerRef? Reporter { get; set; }

        public string Reason { get; set; } = string.Empty;

        public string? Description { get; set; }

        public string? LogExcerpt { get; set; }
    }

    public sealed class ServerReportResponse : IApiResponse
    {
        public string ReportId { get; set; } = string.Empty;

        public string CaseId { get; set; } = string.Empty;

        public void Validate()
        {
            Require.NotEmpty(ReportId, "report_id");
            Require.NotEmpty(CaseId, "case_id");
        }
    }
}
