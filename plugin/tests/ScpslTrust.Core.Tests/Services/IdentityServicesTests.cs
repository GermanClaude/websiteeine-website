using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Tests.Support;
using Xunit;

namespace ScpslTrust.Core.Tests.Services;

public sealed class IdentityServicesTests : IDisposable
{
    private const string ServerId = "srv_7k4x92m8pq174kf9";
    private const string Token = "sreg_3qgvbx8vZz6jdLBHaZEcS_s-Q1raRc97xIbFIrN9CyI";

    private readonly string _dir = Path.Combine(Path.GetTempPath(), "stn-identity-" + Guid.NewGuid().ToString("N"));
    private readonly FakeClock _clock = new(DateTimeOffset.FromUnixTimeSeconds(1_790_000_000));
    private readonly FakeTrustApiClient _client = new();
    private readonly ServerIdentityHolder _holder;

    public IdentityServicesTests()
    {
        _holder = new ServerIdentityHolder(new KeyStore(_dir), new RecordingLogger());
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir))
        {
            Directory.Delete(_dir, recursive: true);
        }
    }

    private RegistrationService Registration() => new(_client, _holder, _clock, new RecordingLogger());

    private KeyRotationService Rotation() => new(_client, _holder, () => new ServerHeartbeatRequest { PluginVersion = "1.0.0" }, _clock, new RecordingLogger());

    private static ServerRegisterResponse Registered(Ed25519KeyPair key) => new() { ServerId = ServerId, KeyFingerprint = key.Fingerprint, Status = "active" };

    private void RegisterDirectly()
    {
        var identity = new ServerIdentity(ServerId, Ed25519KeyPair.Generate(), _clock.UtcNow);
        _holder.Store.SaveCurrent(identity);
        _holder.Load();
    }

    [Fact]
    public async Task Registration_persists_the_identity_and_removes_the_pending_key()
    {
        _client.OnRegister = (token, key) =>
        {
            Assert.Equal(Token, token);
            Assert.NotNull(_holder.Store.LoadPending());
            return Registered(key);
        };

        var result = await Registration().RegisterAsync(Token, "14.1.3", force: false);

        Assert.Equal(ServerId, result.ServerId);
        Assert.Equal(ServerId, _holder.Current!.ServerId);
        Assert.Equal(result.KeyFingerprint, _holder.Store.LoadCurrent()!.Fingerprint);
        Assert.Null(_holder.Store.LoadPending());
    }

    [Fact]
    public async Task Failed_registration_keeps_the_pending_key_for_a_retry_with_the_same_key()
    {
        string? firstFingerprint = null;
        _client.OnRegister = (_, key) =>
        {
            firstFingerprint = key.Fingerprint;
            throw FakeTrustApiClient.Http(400, ApiErrorCodes.RegistrationTokenInvalid);
        };
        await Assert.ThrowsAsync<TrustApiException>(() => Registration().RegisterAsync(Token, null, false));
        Assert.Null(_holder.Current);
        Assert.Equal(firstFingerprint, _holder.Store.LoadPending()!.Fingerprint);

        _client.OnRegister = (_, key) =>
        {
            Assert.Equal(firstFingerprint, key.Fingerprint);
            return Registered(key);
        };
        await Registration().RegisterAsync(Token, null, false);
        Assert.Equal(firstFingerprint, _holder.Current!.Fingerprint);
    }

    [Fact]
    public async Task Public_key_in_use_regenerates_the_key_once()
    {
        var attempts = new List<string>();
        _client.OnRegister = (_, key) =>
        {
            attempts.Add(key.Fingerprint);
            if (attempts.Count == 1)
            {
                throw FakeTrustApiClient.Http(409, ApiErrorCodes.PublicKeyInUse);
            }

            return Registered(key);
        };

        await Registration().RegisterAsync(Token, null, false);

        Assert.Equal(2, attempts.Count);
        Assert.NotEqual(attempts[0], attempts[1]);
        Assert.Equal(attempts[1], _holder.Current!.Fingerprint);
    }

    [Fact]
    public async Task Already_registered_server_requires_force_and_force_replaces_the_key()
    {
        RegisterDirectly();
        var original = _holder.Current!.Fingerprint;
        _client.OnRegister = (_, key) => Registered(key);

        await Assert.ThrowsAsync<InvalidOperationException>(() => Registration().RegisterAsync(Token, null, false));
        Assert.Equal(original, _holder.Current!.Fingerprint);

        await Registration().RegisterAsync(Token, null, true);
        Assert.NotEqual(original, _holder.Current!.Fingerprint);
        Assert.NotEqual(original, _holder.Store.LoadCurrent()!.Fingerprint);
    }

    [Fact]
    public async Task Malformed_token_is_rejected_before_any_key_is_generated()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => Registration().RegisterAsync("sreg_x", null, false));
        Assert.Null(_holder.Store.LoadPending());
        Assert.Empty(_client.Calls);
    }

    [Fact]
    public async Task Rotation_commits_new_key_and_keeps_previous_until_first_success()
    {
        RegisterDirectly();
        var oldFingerprint = _holder.Current!.Fingerprint;
        _client.OnRotate = key =>
        {
            Assert.NotNull(_holder.Store.LoadRotationCandidate());
            return new KeyRotateResponse { KeyFingerprint = key.Fingerprint, PreviousKeyFingerprint = oldFingerprint, PreviousKeyRetiringUntil = _clock.UtcNow.AddMinutes(10) };
        };

        var result = await Rotation().RotateAsync();

        Assert.False(result.Recovered);
        Assert.Equal(oldFingerprint, result.PreviousFingerprint);
        Assert.Equal(result.NewFingerprint, _holder.Current!.Fingerprint);
        Assert.Equal(result.NewFingerprint, _holder.Store.LoadCurrent()!.Fingerprint);
        Assert.Equal(oldFingerprint, _holder.Store.LoadPrevious()!.Fingerprint);
        Assert.Null(_holder.Store.LoadRotationCandidate());

        // A success signed with the OLD key does not clean up; one signed with the new key does.
        _holder.OnSignedRequestSucceeded(_holder.Store.LoadPrevious()!);
        Assert.True(_holder.Store.HasPrevious);
        _holder.OnSignedRequestSucceeded(_holder.Current!);
        Assert.False(_holder.Store.HasPrevious);
    }

    [Fact]
    public async Task Definitive_rotation_rejection_discards_the_candidate()
    {
        RegisterDirectly();
        var current = _holder.Current!.Fingerprint;
        _client.OnRotate = _ => throw FakeTrustApiClient.Http(400, ApiErrorCodes.ProofOfPossessionInvalid);
        await Assert.ThrowsAsync<TrustApiException>(() => Rotation().RotateAsync());
        Assert.Equal(current, _holder.Current!.Fingerprint);
        Assert.Null(_holder.Store.LoadRotationCandidate());
        Assert.False(_holder.Store.HasPrevious);
    }

    [Fact]
    public async Task Timed_out_rotation_is_recovered_when_the_backend_accepts_the_candidate()
    {
        RegisterDirectly();
        var current = _holder.Current!.Fingerprint;
        _client.OnRotate = _ => throw FakeTrustApiClient.Timeout();
        var rotation = Rotation();
        await Assert.ThrowsAsync<TrustApiException>(() => rotation.RotateAsync());
        Assert.True(rotation.HasPendingRecovery);
        Assert.Equal(current, _holder.Current!.Fingerprint);

        var candidateFingerprint = _holder.Store.LoadRotationCandidate()!.Fingerprint;
        _client.OnHeartbeat = (_, signWith) =>
        {
            Assert.Equal(candidateFingerprint, signWith!.Fingerprint);
            return new ServerHeartbeatResponse { Status = "active" };
        };

        Assert.Equal(RotationRecoveryOutcome.Committed, await rotation.RecoverAsync());
        Assert.Equal(candidateFingerprint, _holder.Current!.Fingerprint);
        Assert.False(rotation.HasPendingRecovery);
        Assert.Equal(current, _holder.Store.LoadPrevious()!.Fingerprint);
    }

    [Fact]
    public async Task Candidate_rejected_by_the_backend_is_discarded()
    {
        RegisterDirectly();
        var current = _holder.Current!.Fingerprint;
        _client.OnRotate = _ => throw FakeTrustApiClient.Timeout();
        var rotation = Rotation();
        await Assert.ThrowsAsync<TrustApiException>(() => rotation.RotateAsync());
        _client.OnHeartbeat = (_, _) => throw FakeTrustApiClient.Http(401, ApiErrorCodes.NoActiveKey);

        Assert.Equal(RotationRecoveryOutcome.Discarded, await rotation.RecoverAsync());
        Assert.Equal(current, _holder.Current!.Fingerprint);
        Assert.False(rotation.HasPendingRecovery);
    }

    [Fact]
    public async Task Unreachable_backend_leaves_the_rotation_undetermined()
    {
        RegisterDirectly();
        _client.OnRotate = _ => throw FakeTrustApiClient.Timeout();
        var rotation = Rotation();
        await Assert.ThrowsAsync<TrustApiException>(() => rotation.RotateAsync());
        _client.OnHeartbeat = (_, _) => throw FakeTrustApiClient.Timeout();
        Assert.Equal(RotationRecoveryOutcome.Undetermined, await rotation.RecoverAsync());
        Assert.True(rotation.HasPendingRecovery);
        // A new rotation cannot start while the old one is unresolved.
        await Assert.ThrowsAsync<TrustApiException>(() => rotation.RotateAsync());
    }

    [Fact]
    public async Task Rotation_requires_registration()
    {
        var ex = await Assert.ThrowsAsync<TrustApiException>(() => Rotation().RotateAsync());
        Assert.Equal(TrustApiErrorKind.NotRegistered, ex.Kind);
    }

    [Fact]
    public async Task Candidate_of_another_server_is_discarded()
    {
        RegisterDirectly();
        _holder.Store.SaveRotationCandidate(new ServerIdentity("srv_0000000000000001", Ed25519KeyPair.Generate(), _clock.UtcNow));
        Assert.Equal(RotationRecoveryOutcome.Discarded, await Rotation().RecoverAsync());
        Assert.Empty(_client.Calls);
    }
}
