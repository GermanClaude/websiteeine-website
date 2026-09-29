using System.Collections.Concurrent;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Tests.Support;

/// <summary>Scriptable ITrustApiClient; unset handlers throw NotSupportedException.</summary>
public sealed class FakeTrustApiClient : ITrustApiClient
{
    public ConcurrentQueue<string> Calls { get; } = new();

    public Func<TimeResponse>? OnGetTime { get; set; }

    public Func<string, Ed25519KeyPair, ServerRegisterResponse>? OnRegister { get; set; }

    public Func<ServerHeartbeatRequest, ServerIdentity?, ServerHeartbeatResponse>? OnHeartbeat { get; set; }

    public Func<Ed25519KeyPair, KeyRotateResponse>? OnRotate { get; set; }

    public Func<ServerPolicy>? OnGetPolicy { get; set; }

    public Func<PlayerCheckRequest, PlayerCheckResponse>? OnCheckPlayer { get; set; }

    public Func<OverwatchSessionStartRequest, OverwatchSessionStartResponse>? OnStartSession { get; set; }

    public Func<Guid, OverwatchSessionHeartbeatResponse>? OnSessionHeartbeat { get; set; }

    public Func<Guid, OverwatchEndReason, OverwatchSessionEndResponse>? OnEndSession { get; set; }

    public List<(Guid SessionId, OverwatchEndReason Reason)> EndedSessions { get; } = new();

    public List<OverwatchSessionStartRequest> StartedSessions { get; } = new();

    public Task<TimeResponse> GetTimeAsync(CancellationToken cancellationToken = default) => Run("time", () => Required(OnGetTime)());

    public Task<ServerRegisterResponse> RegisterAsync(string registrationToken, Ed25519KeyPair keyPair, string? gameVersion, CancellationToken cancellationToken = default)
        => Run("register", () => Required(OnRegister)(registrationToken, keyPair));

    public Task<ServerHeartbeatResponse> HeartbeatAsync(ServerHeartbeatRequest request, ServerIdentity? signWith = null, CancellationToken cancellationToken = default)
        => Run("heartbeat", () => Required(OnHeartbeat)(request, signWith));

    public Task<KeyRotateResponse> RotateKeyAsync(Ed25519KeyPair newKeyPair, CancellationToken cancellationToken = default)
        => Run("rotate", () => Required(OnRotate)(newKeyPair));

    public Task<ServerPolicy> GetPolicyAsync(CancellationToken cancellationToken = default) => Run("policy", () => Required(OnGetPolicy)());

    public Task<PlayerCheckResponse> CheckPlayerAsync(PlayerCheckRequest request, CancellationToken cancellationToken = default)
        => Run("check", () => Required(OnCheckPlayer)(request));

    public Task<BypassCheckResponse> CheckBypassAsync(BypassCheckRequest request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException();

    public Task<PlayerLinkResponse> LinkPlayerAsync(PlayerLinkRequest request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException();

    public Task<ServerReportResponse> SubmitReportAsync(ServerReportRequest request, CancellationToken cancellationToken = default)
        => throw new NotSupportedException();

    public Task<OverwatchSessionStartResponse> StartOverwatchSessionAsync(OverwatchSessionStartRequest request, CancellationToken cancellationToken = default)
        => Run("session-start", () =>
        {
            lock (StartedSessions)
            {
                StartedSessions.Add(request);
            }

            return Required(OnStartSession)(request);
        });

    public Task<OverwatchSessionHeartbeatResponse> OverwatchHeartbeatAsync(Guid sessionId, CancellationToken cancellationToken = default)
        => Run("session-heartbeat", () => Required(OnSessionHeartbeat)(sessionId));

    public Task<OverwatchSessionEndResponse> EndOverwatchSessionAsync(Guid sessionId, OverwatchEndReason reason, CancellationToken cancellationToken = default)
        => Run("session-end", () =>
        {
            lock (EndedSessions)
            {
                EndedSessions.Add((sessionId, reason));
            }

            return OnEndSession?.Invoke(sessionId, reason) ?? new OverwatchSessionEndResponse { SessionId = sessionId, Status = "ended", EndedAt = DateTimeOffset.UtcNow };
        });

    public static TrustApiException Http(int status, string code) => new(TrustApiErrorKind.Http, code, code, status, "req-1");

    public static TrustApiException Timeout() => new(TrustApiErrorKind.Timeout, ApiErrorCodes.Timeout, "timeout");

    private Task<T> Run<T>(string name, Func<T> action)
    {
        Calls.Enqueue(name);
        try
        {
            return Task.FromResult(action());
        }
        catch (Exception ex)
        {
            return Task.FromException<T>(ex);
        }
    }

    private static T Required<T>(T? handler)
        where T : class
    {
        return handler ?? throw new NotSupportedException("No fake handler configured.");
    }
}
