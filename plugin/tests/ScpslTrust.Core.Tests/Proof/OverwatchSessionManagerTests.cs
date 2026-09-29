using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Proof;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Proof;

public sealed class OverwatchSessionManagerTests : IDisposable
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private static readonly PlayerRef Staff = new(PlayerIdType.Steam, "76561198000000009");
    private static readonly PlayerRef TargetA = new(PlayerIdType.Steam, "76561198000000001");
    private static readonly PlayerRef TargetB = new(PlayerIdType.Discord, "123456789012345678");

    private readonly FakeClock _clock = new(DateTimeOffset.FromUnixTimeSeconds(1_790_000_000));
    private readonly FakeTrustApiClient _client = new();
    private readonly Ed25519KeyPair _key = Ed25519KeyPair.Generate();
    private readonly List<OverwatchSessionEvent> _events = new();
    private readonly OverwatchSessionManager _manager;
    private readonly Dictionary<Guid, byte[]> _secrets = new();
    private string _heartbeatStatus = "active";

    public OverwatchSessionManagerTests()
    {
        var identities = new StaticIdentityProvider(new ServerIdentity(ServerId, _key, _clock.UtcNow));
        _client.OnStartSession = request =>
        {
            var id = Guid.NewGuid();
            var secret = Enumerable.Range(0, 32).Select(i => (byte)(i + _secrets.Count)).ToArray();
            _secrets[id] = secret;
            return new OverwatchSessionStartResponse
            {
                SessionId = id,
                Secret = Convert.ToBase64String(secret),
                IntervalSeconds = 10,
                StartedAt = _clock.UtcNow,
                HeartbeatIntervalSeconds = 30,
                ServerTime = _clock.UtcNow,
            };
        };
        _client.OnSessionHeartbeat = id => new OverwatchSessionHeartbeatResponse { SessionId = id, Status = _heartbeatStatus, LastHeartbeatAt = _clock.UtcNow, ServerTime = _clock.UtcNow };
        _manager = new OverwatchSessionManager(_client, identities, _clock, new RecordingLogger());
        _manager.SessionEvent += e =>
        {
            lock (_events)
            {
                _events.Add(e);
            }
        };
    }

    public void Dispose() => _key.Dispose();

    [Fact]
    public async Task Spectating_starts_a_session_and_the_overlay_shows_the_matching_code()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();

        var start = Assert.Single(_client.StartedSessions);
        Assert.Equal(TargetA, start.TargetPlayer);
        Assert.Equal(Staff, start.Spectator);
        var session = Assert.Single(_manager.GetSessions());
        Assert.Equal(TargetA, session.Target);

        var line = Assert.Single(_manager.GetOverlayLines());
        var expected = ProofCodeGenerator.Generate(_secrets[session.SessionId], session.SessionId.ToString("D"), ServerId, TargetA.ToUserId(), Staff.ToUserId(), _clock.UtcNow.ToUnixTimeSeconds(), 10);
        Assert.Equal(expected, line.Code);
        Assert.StartsWith("PROOF " + expected + " · ", line.Text);
        Assert.Contains(ServerId, line.Text);
        Assert.Contains(_events, e => e.Kind == OverwatchSessionEventKind.Started);
    }

    [Fact]
    public async Task Code_changes_with_the_window()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        var first = _manager.GetOverlayLines().Single().Code;
        _clock.Advance(TimeSpan.FromSeconds(10));
        var second = _manager.GetOverlayLines().Single().Code;
        Assert.NotEqual(first, second);
    }

    [Fact]
    public async Task Repeated_ticks_do_not_start_duplicates()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        await _manager.TickAsync();
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Single(_client.StartedSessions);
    }

    [Fact]
    public async Task Changing_target_ends_with_target_changed_and_starts_a_new_session()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        var firstId = _manager.GetSessions().Single().SessionId;

        _manager.SetAutoTarget(Staff, TargetB, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();

        Assert.Equal((firstId, OverwatchEndReason.TargetChanged), Assert.Single(_client.EndedSessions));
        Assert.Equal(2, _client.StartedSessions.Count);
        Assert.Equal(TargetB, _manager.GetSessions().Single().Target);
    }

    [Fact]
    public async Task Clearing_the_target_uses_the_given_reason()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _manager.SetAutoTarget(Staff, null, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();

        Assert.Equal(OverwatchEndReason.OverwatchDisabled, Assert.Single(_client.EndedSessions).Reason);
        Assert.Empty(_manager.GetSessions());
        Assert.Empty(_manager.GetOverlayLines());
    }

    [Fact]
    public async Task Heartbeat_is_sent_when_due_and_an_expired_session_is_restarted()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _clock.Advance(TimeSpan.FromSeconds(29));
        await _manager.TickAsync();
        Assert.DoesNotContain("session-heartbeat", _client.Calls);

        _clock.Advance(TimeSpan.FromSeconds(1));
        await _manager.TickAsync();
        Assert.Single(_client.Calls, c => c == "session-heartbeat");

        _heartbeatStatus = "expired";
        _clock.Advance(TimeSpan.FromSeconds(30));
        await _manager.TickAsync();
        Assert.Empty(_manager.GetSessions());
        Assert.Contains(_events, e => e.Kind == OverwatchSessionEventKind.Lost);

        await _manager.TickAsync();
        Assert.Equal(2, _client.StartedSessions.Count);
    }

    [Fact]
    public async Task Transient_heartbeat_failure_keeps_the_session_and_retries_soon()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _client.OnSessionHeartbeat = _ => throw FakeTrustApiClient.Timeout();
        _clock.Advance(TimeSpan.FromSeconds(30));
        await _manager.TickAsync();
        Assert.Single(_manager.GetSessions());

        _client.OnSessionHeartbeat = id => new OverwatchSessionHeartbeatResponse { SessionId = id, Status = "active" };
        _clock.Advance(TimeSpan.FromSeconds(5));
        await _manager.TickAsync();
        Assert.Equal(2, _client.Calls.Count(c => c == "session-heartbeat"));
        Assert.Single(_manager.GetSessions());
    }

    [Fact]
    public async Task Heartbeat_not_found_drops_the_session()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _client.OnSessionHeartbeat = _ => throw FakeTrustApiClient.Http(404, ApiErrorCodes.NotFound);
        _clock.Advance(TimeSpan.FromSeconds(30));
        await _manager.TickAsync();
        Assert.Empty(_manager.GetSessions());
    }

    [Fact]
    public async Task Failed_start_backs_off_before_retrying_the_same_target()
    {
        _client.OnStartSession = _ => throw FakeTrustApiClient.Http(503, ApiErrorCodes.ServiceUnavailable);
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        await _manager.TickAsync();
        _clock.Advance(TimeSpan.FromSeconds(29));
        await _manager.TickAsync();
        Assert.Single(_client.StartedSessions);
        Assert.Contains(_events, e => e.Kind == OverwatchSessionEventKind.StartFailed);

        _clock.Advance(TimeSpan.FromSeconds(2));
        await _manager.TickAsync();
        Assert.Equal(2, _client.StartedSessions.Count);
    }

    [Fact]
    public async Task Back_off_does_not_block_a_different_target()
    {
        _client.OnStartSession = _ => throw FakeTrustApiClient.Http(503, ApiErrorCodes.ServiceUnavailable);
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _manager.SetAutoTarget(Staff, TargetB, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Equal(2, _client.StartedSessions.Count);
    }

    [Fact]
    public async Task Spectator_leaving_ends_with_spectator_left()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _manager.HandlePlayerLeft(Staff);
        await _manager.TickAsync();
        Assert.Equal(OverwatchEndReason.SpectatorLeft, Assert.Single(_client.EndedSessions).Reason);
        await _manager.TickAsync();
        Assert.Single(_client.StartedSessions);
    }

    [Fact]
    public async Task Target_leaving_ends_with_target_left()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        _manager.HandlePlayerLeft(TargetA);
        await _manager.TickAsync();
        Assert.Equal(OverwatchEndReason.TargetLeft, Assert.Single(_client.EndedSessions).Reason);
        Assert.Empty(_manager.GetSessions());
    }

    [Fact]
    public async Task Manual_session_ignores_auto_target_changes_until_stopped()
    {
        _manager.StartManual(Staff, TargetA);
        await _manager.TickAsync();
        Assert.True(_manager.GetSessions().Single().Manual);

        _manager.SetAutoTarget(Staff, TargetB, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Empty(_client.EndedSessions);
        Assert.Equal(TargetA, _manager.GetSessions().Single().Target);

        Assert.True(_manager.StopManual(Staff));
        await _manager.TickAsync();
        Assert.Equal(OverwatchEndReason.Manual, _client.EndedSessions.First().Reason);
    }

    [Fact]
    public async Task Stop_suppresses_auto_recording_of_the_current_target_until_it_changes()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.True(_manager.StopManual(Staff));
        await _manager.TickAsync();
        await _manager.TickAsync();
        Assert.Single(_client.StartedSessions);
        Assert.Equal(OverwatchEndReason.Manual, Assert.Single(_client.EndedSessions).Reason);

        _manager.SetAutoTarget(Staff, TargetB, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Equal(2, _client.StartedSessions.Count);
    }

    [Fact]
    public async Task End_all_ends_every_session_with_the_reason()
    {
        var other = new PlayerRef(PlayerIdType.Steam, "76561198000000008");
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        _manager.SetAutoTarget(other, TargetB, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Equal(2, _manager.GetSessions().Count);

        await _manager.EndAllAsync(OverwatchEndReason.RoundEnded);

        Assert.Equal(2, _client.EndedSessions.Count);
        Assert.All(_client.EndedSessions, e => Assert.Equal(OverwatchEndReason.RoundEnded, e.Reason));
        Assert.Empty(_manager.GetSessions());
        await _manager.TickAsync();
        Assert.Equal(2, _client.StartedSessions.Count);
    }

    [Fact]
    public async Task Self_spectating_is_ignored_and_manual_self_session_is_refused()
    {
        _manager.SetAutoTarget(Staff, Staff, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        Assert.Empty(_client.StartedSessions);
        Assert.Throws<ArgumentException>(() => _manager.StartManual(Staff, Staff));
        Assert.False(_manager.StopManual(Staff));
    }

    [Fact]
    public async Task No_overlay_without_a_registered_identity()
    {
        var manager = new OverwatchSessionManager(_client, new StaticIdentityProvider(null), _clock, new RecordingLogger());
        manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await manager.TickAsync();
        Assert.Empty(manager.GetOverlayLines());
    }

    [Fact]
    public async Task Session_info_never_exposes_the_secret()
    {
        _manager.SetAutoTarget(Staff, TargetA, OverwatchEndReason.OverwatchDisabled);
        await _manager.TickAsync();
        var info = _manager.GetSessions().Single();
        Assert.DoesNotContain(info.GetType().GetProperties(), p => p.Name.Contains("Secret", StringComparison.OrdinalIgnoreCase));
    }

    private sealed class StaticIdentityProvider : IServerIdentityProvider
    {
        public StaticIdentityProvider(ServerIdentity? identity) => Current = identity;

        public ServerIdentity? Current { get; }

        public void OnSignedRequestSucceeded(ServerIdentity identity)
        {
        }
    }
}
