using ScpslTrust.Core.Api;
using ScpslTrust.Core.Policy;
using Xunit;

namespace ScpslTrust.Core.Tests.Policy;

/// <summary>Engine behaviour beyond the shared vectors: robustness against malformed rules.</summary>
public sealed class PolicyEngineTests
{
    private static PolicyEvaluationInput Input(
        string status = "confirmed",
        int? days = 1,
        string vpn = "confirmed",
        bool altPossible = true,
        string alt = "high",
        int openReports = 5,
        params string[] bypasses)
    {
        return new PolicyEvaluationInput(status, "CASE-2026-000001", 3, openReports, days, vpn, altPossible, alt, new[] { "CASE-2026-000002" }, bypasses);
    }

    private static ServerPolicy Policy(params PolicyRule[] rules) => new() { Rules = rules.ToList() };

    [Fact]
    public void Rules_missing_their_condition_fields_never_match()
    {
        var policy = Policy(
            new PolicyRule { Id = "g", Signal = "global_verdict", Action = "ban" },
            new PolicyRule { Id = "a", Signal = "account_age", Action = "ban" },
            new PolicyRule { Id = "v", Signal = "vpn", Action = "ban" },
            new PolicyRule { Id = "l", Signal = "alt_account", Action = "ban" },
            new PolicyRule { Id = "o", Signal = "open_reports", Action = "ban" });
        var decision = PolicyEngine.Evaluate(Input(), policy);
        Assert.Equal(PolicyAction.Allow, decision.Action);
        Assert.Empty(decision.Applied);
    }

    [Fact]
    public void Unknown_threshold_values_never_match()
    {
        var policy = Policy(
            new PolicyRule { Id = "v", Signal = "vpn", Action = "kick", MinVpnConfidence = "extreme" },
            new PolicyRule { Id = "l", Signal = "alt_account", Action = "kick", MinAltConfidence = "HIGH" });
        Assert.Equal(PolicyAction.Allow, PolicyEngine.Evaluate(Input(), policy).Action);
    }

    [Fact]
    public void Unknown_input_values_rank_below_every_threshold()
    {
        var policy = Policy(new PolicyRule { Id = "v", Signal = "vpn", Action = "kick", MinVpnConfidence = "possible" });
        Assert.Equal(PolicyAction.Allow, PolicyEngine.Evaluate(Input(vpn: "super_confirmed"), policy).Action);
    }

    [Fact]
    public void Signal_and_action_matching_is_case_sensitive()
    {
        var policy = Policy(
            new PolicyRule { Id = "a", Signal = "VPN", Action = "kick", MinVpnConfidence = "possible" },
            new PolicyRule { Id = "b", Signal = "vpn", Action = "KICK", MinVpnConfidence = "possible" });
        Assert.Equal(PolicyAction.Allow, PolicyEngine.Evaluate(Input(), policy).Action);
    }

    [Fact]
    public void Null_rules_list_and_null_entries_are_tolerated()
    {
        var policy = new ServerPolicy { Rules = null! };
        Assert.Equal(PolicyAction.Allow, PolicyEngine.Evaluate(Input(), policy).Action);
        var withNull = new ServerPolicy { Rules = new List<PolicyRule> { null!, new() { Id = "o", Signal = "open_reports", Action = "warn", MinOpenReports = 1 } } };
        Assert.Equal(PolicyAction.Warn, PolicyEngine.Evaluate(Input(), withNull).Action);
    }

    [Fact]
    public void Placeholder_values_are_not_rescanned()
    {
        var policy = Policy(new PolicyRule { Id = "g", Signal = "global_verdict", Action = "kick", Statuses = new() { "confirmed" }, Message = "{server_name}" });
        var decision = PolicyEngine.Evaluate(Input(), policy, new PolicyEvaluationContext("{case_id}"));
        Assert.Equal("{case_id}", decision.Message);
    }

    [Fact]
    public void Backend_unavailable_decisions()
    {
        var kick = BackendUnavailablePolicy.Decide(new ServerPolicy { BackendUnavailableAction = "kick", NotifyOnEnforcement = true });
        Assert.Equal(PolicyAction.Kick, kick.Action);
        Assert.True(kick.NotifyAdmins);
        Assert.NotNull(kick.Message);

        var notify = BackendUnavailablePolicy.Decide(new ServerPolicy { BackendUnavailableAction = "admin_notify", NotifyOnEnforcement = false });
        Assert.Equal(PolicyAction.AdminNotify, notify.Action);
        Assert.True(notify.NotifyAdmins);

        Assert.Equal(PolicyAction.Allow, BackendUnavailablePolicy.Decide(new ServerPolicy { BackendUnavailableAction = "allow" }).Action);
        // Only allow/admin_notify/kick are permitted; anything else (even ban) fails open.
        Assert.Equal(PolicyAction.Allow, BackendUnavailablePolicy.Decide(new ServerPolicy { BackendUnavailableAction = "ban" }).Action);
        Assert.Equal(PolicyAction.Allow, BackendUnavailablePolicy.Decide(new ServerPolicy { BackendUnavailableAction = "nonsense" }).Action);
    }

    [Fact]
    public void Remote_policy_with_future_fields_deserializes()
    {
        const string json = "{\"version\":7,\"backend_unavailable_action\":\"admin_notify\",\"notify_on_enforcement\":false,\"honor_global_bypasses\":true,\"whitelist_url\":null,\"future_setting\":{\"x\":1},\"rules\":[{\"id\":\"r1\",\"enabled\":true,\"signal\":\"future\",\"action\":\"ban\",\"weird\":[1,2]}]}";
        var policy = TrustJson.Deserialize<ServerPolicy>(json)!;
        Assert.Equal(7, policy.Version);
        Assert.Equal("future", policy.Rules[0].Signal);
        Assert.Equal(PolicyAction.Allow, PolicyEngine.Evaluate(Input(), policy).Action);
    }

    [Fact]
    public void Validator_reports_malformed_local_policies()
    {
        var policy = new ServerPolicy
        {
            Version = 0,
            BackendUnavailableAction = "ban",
            WhitelistUrl = "javascript:alert(1)",
            Rules = new List<PolicyRule>
            {
                new() { Id = "x", Signal = "vpn", Action = "kick", MinVpnConfidence = "not_detected" },
                new() { Id = "x", Signal = "account_age", Action = "warn", BanDurationMinutes = 5 },
                new() { Id = "", Signal = "nope", Action = "explode" },
                new() { Id = "g", Signal = "global_verdict", Action = "ban", Statuses = new() { "guilty" }, BanDurationMinutes = -1 },
                new() { Id = "m", Signal = "open_reports", Action = "warn", MinOpenReports = 1, Message = new string('m', 300) },
            },
        };
        var issues = PolicyValidator.Validate(policy);
        Assert.Contains(issues, i => i.Contains("version"));
        Assert.Contains(issues, i => i.Contains("backend_unavailable_action"));
        Assert.Contains(issues, i => i.Contains("whitelist_url"));
        Assert.Contains(issues, i => i.Contains("min_vpn_confidence"));
        Assert.Contains(issues, i => i.Contains("duplicated"));
        Assert.Contains(issues, i => i.Contains("max_account_age_days is required"));
        Assert.Contains(issues, i => i.Contains("only used by ban rules"));
        Assert.Contains(issues, i => i.Contains("signal 'nope' is unknown"));
        Assert.Contains(issues, i => i.Contains("action 'explode' is unknown"));
        Assert.Contains(issues, i => i.Contains("unknown status 'guilty'"));
        Assert.Contains(issues, i => i.Contains("ban_duration_minutes must be between"));
        Assert.Contains(issues, i => i.Contains("message must be at most"));
        Assert.Empty(PolicyValidator.Validate(DefaultPolicy.Build()));
    }
}
