using ScpslTrust.Core.Config;
using ScpslTrust.Core.Policy;
using Xunit;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace ScpslTrust.Core.Tests.Config;

public sealed class TrustConfigTests
{
    // Same conventions as LabApi.Loader.Features.Yaml.YamlConfigParser.
    private static readonly ISerializer Serializer = new SerializerBuilder().WithNamingConvention(UnderscoredNamingConvention.Instance).DisableAliases().IgnoreFields().Build();
    private static readonly IDeserializer Deserializer = new DeserializerBuilder().WithNamingConvention(UnderscoredNamingConvention.Instance).IgnoreUnmatchedProperties().IgnoreFields().Build();

    [Fact]
    public void Defaults_match_architecture_section_17_3()
    {
        var config = new TrustConfig();
        Assert.Equal(string.Empty, config.ApiBaseUrl);
        Assert.Equal(5, config.RequestTimeoutSeconds);
        Assert.Equal(string.Empty, config.RegistrationToken);
        Assert.Equal("remote", config.PolicySource);
        Assert.Equal(300, config.PolicyRefreshSeconds);
        Assert.True(config.CheckOnJoin);
        Assert.True(config.SendIpForVpnCheck);
        Assert.False(config.SendAccountAgeHint);
        Assert.True(config.ForwardIngameReports);
        Assert.Equal(60, config.HeartbeatSeconds);
        Assert.True(config.StaffNotifications.Enabled);
        Assert.True(config.StaffNotifications.UseHints);
        Assert.True(config.StaffNotifications.UseConsole);
        Assert.True(config.OverwatchProof.Enabled);
        Assert.True(config.OverwatchProof.AutoStartOnSpectate);
        Assert.True(config.OverwatchProof.OnlyInOverwatch);
        Assert.Equal("RemoteAdminAccess", config.OverwatchProof.RequiredPermission);
        Assert.Equal(0, config.MaxBanDurationMinutes);
        Assert.False(config.Debug);
        Assert.Equal(4, config.LocalPolicy.Rules.Count);
        Assert.Empty(PolicyValidator.Validate(config.LocalPolicy));
    }

    [Fact]
    public void Yaml_uses_the_documented_snake_case_keys()
    {
        var yaml = Serializer.Serialize(new TrustConfig());
        foreach (var key in new[]
        {
            "api_base_url:", "request_timeout_seconds:", "registration_token:", "policy_source:", "policy_refresh_seconds:",
            "check_on_join:", "send_ip_for_vpn_check:", "send_account_age_hint:", "forward_ingame_reports:", "heartbeat_seconds:",
            "staff_notifications:", "use_hints:", "use_console:", "overwatch_proof:", "auto_start_on_spectate:", "only_in_overwatch:",
            "required_permission:", "hint_vertical_offset:", "local_policy:", "backend_unavailable_action:", "notify_on_enforcement:",
            "honor_global_bypasses:", "whitelist_url:", "rules:", "max_account_age_days:", "min_vpn_confidence:", "max_ban_duration_minutes:",
            "debug:", "command_permissions:",
        })
        {
            Assert.Contains(key, yaml);
        }
    }

    [Fact]
    public void Yaml_round_trip_preserves_values()
    {
        var config = new TrustConfig
        {
            ApiBaseUrl = "https://trust.example.org",
            PolicySource = "local",
            RequestTimeoutSeconds = 7,
            MaxBanDurationMinutes = 1440,
        };
        config.LocalPolicy.Rules.Add(new PolicyRule { Id = "kick-young", Signal = "account_age", Action = "kick", MaxAccountAgeDays = 7, Message = "Your account must be at least {days} days old." });
        config.OverwatchProof.HintVerticalOffset = -12.5f;

        var reloaded = Deserializer.Deserialize<TrustConfig>(Serializer.Serialize(config));

        Assert.Equal("https://trust.example.org", reloaded.ApiBaseUrl);
        Assert.Equal("local", reloaded.PolicySource);
        Assert.Equal(7, reloaded.RequestTimeoutSeconds);
        Assert.Equal(1440, reloaded.MaxBanDurationMinutes);
        Assert.Equal(-12.5f, reloaded.OverwatchProof.HintVerticalOffset);
        var rule = reloaded.LocalPolicy.Rules.Single(r => r.Id == "kick-young");
        Assert.Equal(7, rule.MaxAccountAgeDays);
        Assert.Equal("Your account must be at least {days} days old.", rule.Message);
        Assert.True(rule.Enabled);
    }

    [Fact]
    public void Hand_written_yaml_rule_without_enabled_is_enabled()
    {
        const string yaml = """
            api_base_url: https://trust.example.org
            policy_source: local
            local_policy:
              backend_unavailable_action: kick
              rules:
              - id: vpn
                signal: vpn
                action: require_whitelist
                min_vpn_confidence: likely
              - id: cheaters
                signal: global_verdict
                action: ban
                statuses: [confirmed]
                min_confirmed_servers: 2
                ban_duration_minutes: 0
            unknown_future_key: 1
            """;
        var config = Deserializer.Deserialize<TrustConfig>(yaml);
        var settings = TrustSettings.FromConfig(config, out var issues);
        Assert.Empty(issues);
        Assert.Equal(PolicySourceKind.Local, settings.PolicySource);
        Assert.Equal("kick", settings.LocalPolicy.BackendUnavailableAction);
        Assert.All(settings.LocalPolicy.Rules, r => Assert.True(r.Enabled));
        Assert.Equal(new List<string> { "confirmed" }, settings.LocalPolicy.Rules[1].Statuses);
        // Missing staff_notifications section keeps defaults.
        Assert.True(settings.StaffNotificationsEnabled);
    }

    [Fact]
    public void Settings_clamp_out_of_range_values_and_report_them()
    {
        var config = new TrustConfig
        {
            ApiBaseUrl = "http://trust.example.org",
            RequestTimeoutSeconds = 0,
            PolicyRefreshSeconds = 1,
            HeartbeatSeconds = 999999,
            PolicySource = "cloud",
            RegistrationToken = "sreg_bad",
            MaxBanDurationMinutes = -5,
            OverwatchProof = new OverwatchProofConfig { HintVerticalOffset = float.NaN, RequiredPermission = " " },
        };
        var settings = TrustSettings.FromConfig(config, out var issues);

        Assert.Null(settings.ApiBaseUri);
        Assert.Contains(issues, i => i.Contains("https"));
        Assert.Equal(TimeSpan.FromSeconds(1), settings.RequestTimeout);
        Assert.Equal(TimeSpan.FromSeconds(30), settings.PolicyRefreshInterval);
        Assert.Equal(TimeSpan.FromSeconds(3600), settings.HeartbeatInterval);
        Assert.Equal(PolicySourceKind.Remote, settings.PolicySource);
        Assert.Null(settings.RegistrationToken);
        Assert.Contains(issues, i => i.Contains("registration_token"));
        Assert.Equal(0, settings.MaxBanDurationMinutes);
        Assert.Equal(0f, settings.OverwatchHintVerticalOffset);
        Assert.Equal("RemoteAdminAccess", settings.OverwatchRequiredPermission);
    }

    [Fact]
    public void Settings_accept_a_valid_configuration_without_issues()
    {
        var config = new TrustConfig
        {
            ApiBaseUrl = "https://trust.example.org/api/v1",
            RegistrationToken = "  sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI  ",
        };
        var settings = TrustSettings.FromConfig(config, out var issues);
        Assert.Empty(issues);
        Assert.Equal("https://trust.example.org/", settings.ApiBaseUri!.ToString());
        Assert.Equal("sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI", settings.RegistrationToken);
    }

    [Fact]
    public void Unconfigured_base_url_is_not_an_issue_but_disables_the_backend()
    {
        var settings = TrustSettings.FromConfig(new TrustConfig(), out var issues);
        Assert.Empty(issues);
        Assert.Null(settings.ApiBaseUri);
        Assert.NotNull(settings.ApiBaseUriError);
    }

    [Fact]
    public void Invalid_local_policy_is_reported_only_when_used()
    {
        var config = new TrustConfig();
        config.LocalPolicy.Rules.Add(new PolicyRule { Id = "x", Signal = "vpn", Action = "kick" });
        TrustSettings.FromConfig(config, out var remoteIssues);
        Assert.Empty(remoteIssues);

        config.PolicySource = "local";
        TrustSettings.FromConfig(config, out var localIssues);
        Assert.Contains(localIssues, i => i.StartsWith("local_policy:", StringComparison.Ordinal));
    }

    [Fact]
    public void Null_sections_fall_back_to_defaults()
    {
        var config = new TrustConfig { StaffNotifications = null!, OverwatchProof = null!, CommandPermissions = null!, LocalPolicy = null! };
        var settings = TrustSettings.FromConfig(config, out _);
        Assert.True(settings.StaffNotificationsEnabled);
        Assert.True(settings.OverwatchProofEnabled);
        Assert.Equal("ServerConsoleCommands", settings.AdminCommandPermission);
        Assert.Equal(4, settings.LocalPolicy.Rules.Count);
    }
}
