using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Config;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Services;

public sealed class PolicyAndCheckServicesTests : IDisposable
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private static readonly PlayerRef Player = new(PlayerIdType.Steam, "76561198000000001");

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "stn-policy-" + Guid.NewGuid().ToString("N"));
    private readonly FakeClock _clock = new(DateTimeOffset.FromUnixTimeSeconds(1_790_000_000));
    private readonly FakeTrustApiClient _client = new();
    private readonly ServerIdentityHolder _identities;

    public PolicyAndCheckServicesTests()
    {
        _identities = new ServerIdentityHolder(new KeyStore(_dir), new RecordingLogger());
        _identities.Store.SaveCurrent(new ServerIdentity(ServerId, Ed25519KeyPair.Generate(), _clock.UtcNow));
        _identities.Load();
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, recursive: true);
        }
    }

    private PolicyManager Manager(PolicySourceKind source = PolicySourceKind.Remote, ServerPolicy? local = null)
        => new(source, local ?? DefaultPolicy.Build(), _client, _identities, new PolicyCache(_dir, new RecordingLogger()), _clock, new RecordingLogger());

    private static ServerPolicy KickVpnPolicy(int version) => new()
    {
        Version = version,
        BackendUnavailableAction = "kick",
        Rules = new List<PolicyRule> { new() { Id = "vpn", Signal = "vpn", Action = "kick", MinVpnConfidence = "likely" } },
    };

    private static PlayerCheckResponse CheckResponse(string vpn = "likely", int? policyVersion = 2) => new()
    {
        GlobalStatus = "none",
        Vpn = new PlayerCheckVpn { Detected = vpn != "not_detected", Confidence = vpn },
        PolicyVersion = policyVersion,
    };

    [Fact]
    public async Task Remote_policy_is_cached_and_reused_after_restart()
    {
        _client.OnGetPolicy = () => KickVpnPolicy(2);
        var manager = Manager();
        manager.Initialize();
        Assert.Equal(PolicyOrigin.Default, manager.Origin);

        Assert.True(await manager.RefreshAsync());
        Assert.Equal(PolicyOrigin.Remote, manager.Origin);
        Assert.Equal(2, manager.Current.Version);

        var restarted = Manager();
        restarted.Initialize();
        Assert.Equal(PolicyOrigin.Cache, restarted.Origin);
        Assert.Equal(2, restarted.Current.Version);
        Assert.Equal("kick", restarted.Current.Rules.Single().Action);
    }

    [Fact]
    public async Task Failed_refresh_keeps_the_current_policy()
    {
        _client.OnGetPolicy = () => KickVpnPolicy(2);
        var manager = Manager();
        manager.Initialize();
        await manager.RefreshAsync();

        _client.OnGetPolicy = () => throw FakeTrustApiClient.Timeout();
        Assert.False(await manager.RefreshAsync());
        Assert.Equal(2, manager.Current.Version);
        Assert.Equal(PolicyOrigin.Remote, manager.Origin);
        Assert.NotNull(manager.LastError);
    }

    [Fact]
    public void Cache_of_another_server_is_ignored()
    {
        var cache = new PolicyCache(_dir, new RecordingLogger());
        cache.Save("srv_0000000000000001", KickVpnPolicy(9), _clock.UtcNow);
        var manager = Manager();
        manager.Initialize();
        Assert.Equal(PolicyOrigin.Default, manager.Origin);
    }

    [Fact]
    public void Corrupt_cache_is_ignored()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(Path.Combine(_dir, PolicyCache.FileName), "{ not json");
        var manager = Manager();
        manager.Initialize();
        Assert.Equal(PolicyOrigin.Default, manager.Origin);
    }

    [Fact]
    public async Task Local_source_never_fetches()
    {
        var manager = Manager(PolicySourceKind.Local, KickVpnPolicy(1));
        manager.Initialize();
        Assert.Equal(PolicyOrigin.Local, manager.Origin);
        Assert.False(await manager.RefreshAsync());
        Assert.False(manager.IsOutdated(5));
        Assert.Empty(_client.Calls);
    }

    [Fact]
    public async Task Outdated_detection()
    {
        _client.OnGetPolicy = () => KickVpnPolicy(2);
        var manager = Manager();
        manager.Initialize();
        Assert.True(manager.IsOutdated(1));
        await manager.RefreshAsync();
        Assert.False(manager.IsOutdated(2));
        Assert.True(manager.IsOutdated(3));
        Assert.False(manager.IsOutdated(null));
    }

    [Fact]
    public async Task Check_evaluates_the_local_policy_with_backend_information()
    {
        var manager = Manager(PolicySourceKind.Local, KickVpnPolicy(1));
        manager.Initialize();
        PlayerCheckRequest? sent = null;
        _client.OnCheckPlayer = request =>
        {
            sent = request;
            return CheckResponse();
        };
        var service = new PlayerCheckService(_client, manager, new PlayerCheckOptions { SendIpForVpnCheck = true }, new RecordingLogger());

        var outcome = await service.CheckAsync(new PlayerCheckContext(Player, "Nick\nName" + new string('x', 100), "::ffff:203.0.113.4", null, "Site-19"));

        Assert.True(outcome.BackendAvailable);
        Assert.Equal(PolicyAction.Kick, outcome.Decision.Action);
        Assert.Equal("203.0.113.4", sent!.Ip);
        Assert.Equal(64, sent.Nickname!.Length);
        Assert.DoesNotContain('\n', sent.Nickname);
    }

    [Fact]
    public async Task Ip_is_not_sent_when_disabled_and_invalid_ips_are_dropped()
    {
        var manager = Manager(PolicySourceKind.Local);
        manager.Initialize();
        var sent = new List<PlayerCheckRequest>();
        _client.OnCheckPlayer = request =>
        {
            sent.Add(request);
            return CheckResponse();
        };

        await new PlayerCheckService(_client, manager, new PlayerCheckOptions { SendIpForVpnCheck = false }, new RecordingLogger())
            .CheckAsync(new PlayerCheckContext(Player, "a", "203.0.113.4", DateTimeOffset.UtcNow, null));
        await new PlayerCheckService(_client, manager, new PlayerCheckOptions { SendIpForVpnCheck = true }, new RecordingLogger())
            .CheckAsync(new PlayerCheckContext(Player, "a", "not-an-ip", null, null));

        Assert.Null(sent[0].Ip);
        Assert.Null(sent[0].AccountCreatedAt);
        Assert.Null(sent[1].Ip);
    }

    [Theory]
    [InlineData("kick", PolicyAction.Kick)]
    [InlineData("admin_notify", PolicyAction.AdminNotify)]
    [InlineData("allow", PolicyAction.Allow)]
    public async Task Backend_unavailable_applies_the_policy_action(string configured, PolicyAction expected)
    {
        var policy = KickVpnPolicy(1);
        policy.BackendUnavailableAction = configured;
        var manager = Manager(PolicySourceKind.Local, policy);
        manager.Initialize();
        _client.OnCheckPlayer = _ => throw FakeTrustApiClient.Timeout();

        var outcome = await new PlayerCheckService(_client, manager, new PlayerCheckOptions(), new RecordingLogger())
            .CheckAsync(new PlayerCheckContext(Player, null, null, null, null));

        Assert.False(outcome.BackendAvailable);
        Assert.Equal(expected, outcome.Decision.Action);
        Assert.NotNull(outcome.Error);
    }

    [Fact]
    public async Task Newer_policy_version_in_check_response_triggers_a_refresh()
    {
        _client.OnGetPolicy = () => KickVpnPolicy(2);
        var manager = Manager();
        manager.Initialize();
        await manager.RefreshAsync();
        _client.OnGetPolicy = () => KickVpnPolicy(3);
        _client.OnCheckPlayer = _ => CheckResponse(policyVersion: 3);

        await new PlayerCheckService(_client, manager, new PlayerCheckOptions(), new RecordingLogger())
            .CheckAsync(new PlayerCheckContext(Player, null, null, null, null));

        for (var i = 0; i < 50 && manager.Current.Version != 3; i++)
        {
            await Task.Delay(10);
        }

        Assert.Equal(3, manager.Current.Version);
    }

    [Fact]
    public async Task Heartbeat_refreshes_outdated_policy_and_rotates_when_requested()
    {
        _client.OnGetPolicy = () => KickVpnPolicy(5);
        var manager = Manager();
        manager.Initialize();
        var rotation = new KeyRotationService(_client, _identities, () => new ServerHeartbeatRequest { PluginVersion = "1.0.0" }, _clock, new RecordingLogger());
        var old = _identities.Current!.Fingerprint;
        _client.OnRotate = key => new KeyRotateResponse { KeyFingerprint = key.Fingerprint, PreviousKeyFingerprint = old, PreviousKeyRetiringUntil = _clock.UtcNow };
        _client.OnHeartbeat = (_, _) => new ServerHeartbeatResponse { Status = "active", PolicyVersion = 5, KeyRotationRequested = true };
        var heartbeat = new HeartbeatService(_client, _identities, manager, rotation, null, () => new ServerHeartbeatRequest { PluginVersion = "1.0.0", PlayerCount = 3 }, _clock, new RecordingLogger());

        await heartbeat.BeatAsync();

        Assert.Equal(5, manager.Current.Version);
        Assert.NotEqual(old, _identities.Current!.Fingerprint);
        Assert.True(heartbeat.LastStatus!.Succeeded);
    }

    [Fact]
    public async Task Heartbeat_failure_is_recorded_and_timestamp_errors_trigger_a_clock_check()
    {
        var manager = Manager();
        manager.Initialize();
        var rotation = new KeyRotationService(_client, _identities, () => new ServerHeartbeatRequest { PluginVersion = "1.0.0" }, _clock, new RecordingLogger());
        var offsetClock = new OffsetClock(_clock);
        var skew = new ClockSkewMonitor(_client, offsetClock, new RecordingLogger());
        _client.OnHeartbeat = (_, _) => throw FakeTrustApiClient.Http(401, ApiErrorCodes.TimestampOutOfRange);
        _client.OnGetTime = () => new TimeResponse { EpochMs = _clock.UtcNow.AddSeconds(90).ToUnixTimeMilliseconds() };
        var logger = new RecordingLogger();
        var heartbeat = new HeartbeatService(_client, _identities, manager, rotation, skew, () => new ServerHeartbeatRequest { PluginVersion = "1.0.0" }, _clock, logger);

        await heartbeat.BeatAsync();
        await heartbeat.BeatAsync();

        Assert.False(heartbeat.LastStatus!.Succeeded);
        Assert.Contains("TIMESTAMP_OUT_OF_RANGE", heartbeat.LastStatus.Error);
        Assert.InRange(offsetClock.Offset.TotalSeconds, 89, 91);
        // The same problem is logged as a warning only once.
        Assert.Single(logger.Lines, l => l.StartsWith("WARN Heartbeat failed", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Heartbeat_is_skipped_before_registration()
    {
        var empty = new ServerIdentityHolder(new KeyStore(Path.Combine(_dir, "empty")), new RecordingLogger());
        var manager = new PolicyManager(PolicySourceKind.Remote, DefaultPolicy.Build(), _client, empty, new PolicyCache(_dir, new RecordingLogger()), _clock, new RecordingLogger());
        var rotation = new KeyRotationService(_client, empty, () => new ServerHeartbeatRequest(), _clock, new RecordingLogger());
        var heartbeat = new HeartbeatService(_client, empty, manager, rotation, null, () => new ServerHeartbeatRequest(), _clock, new RecordingLogger());
        await heartbeat.BeatAsync();
        Assert.Empty(_client.Calls);
        Assert.Null(heartbeat.LastStatus);
    }

    [Theory]
    [InlineData(0.4, 0)]
    [InlineData(5, 5)]
    [InlineData(-30, -30)]
    public async Task Clock_skew_is_applied_above_the_threshold(double skewSeconds, double expectedOffset)
    {
        var offsetClock = new OffsetClock(_clock);
        _client.OnGetTime = () => new TimeResponse { EpochMs = _clock.UtcNow.AddSeconds(skewSeconds).ToUnixTimeMilliseconds() };
        var measured = await new ClockSkewMonitor(_client, offsetClock, new RecordingLogger()).MeasureAsync();
        Assert.NotNull(measured);
        Assert.Equal(expectedOffset, offsetClock.Offset.TotalSeconds, 1);
    }

    [Fact]
    public async Task Implausible_clock_skew_is_not_applied()
    {
        var offsetClock = new OffsetClock(_clock);
        _client.OnGetTime = () => new TimeResponse { EpochMs = _clock.UtcNow.AddDays(3).ToUnixTimeMilliseconds() };
        await new ClockSkewMonitor(_client, offsetClock, new RecordingLogger()).MeasureAsync();
        Assert.Equal(TimeSpan.Zero, offsetClock.Offset);
    }

    [Fact]
    public async Task Unreachable_time_endpoint_keeps_the_offset()
    {
        var offsetClock = new OffsetClock(_clock);
        offsetClock.SetOffset(TimeSpan.FromSeconds(4));
        _client.OnGetTime = () => throw FakeTrustApiClient.Timeout();
        Assert.Null(await new ClockSkewMonitor(_client, offsetClock, new RecordingLogger()).MeasureAsync());
        Assert.Equal(TimeSpan.FromSeconds(4), offsetClock.Offset);
    }
}
