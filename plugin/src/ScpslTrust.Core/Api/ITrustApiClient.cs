using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Api
{
    /// <summary>Supplies the identity used to sign requests.</summary>
    public interface IServerIdentityProvider
    {
        /// <summary>Current registered identity, or null before registration.</summary>
        ServerIdentity? Current { get; }

        /// <summary>Called after every 2xx response to a request signed with <paramref name="identity"/>.</summary>
        void OnSignedRequestSucceeded(ServerIdentity identity);
    }

    /// <summary>Client of the plugin ⇄ backend API (ARCHITECTURE §5, §6, §10). All failures throw <see cref="TrustApiException"/>.</summary>
    public interface ITrustApiClient
    {
        /// <summary>GET /time (unsigned).</summary>
        Task<TimeResponse> GetTimeAsync(CancellationToken cancellationToken = default);

        /// <summary>POST /servers/register with proof of possession by <paramref name="keyPair"/> (unsigned).</summary>
        Task<ServerRegisterResponse> RegisterAsync(string registrationToken, Ed25519KeyPair keyPair, string? gameVersion, CancellationToken cancellationToken = default);

        /// <summary>POST /servers/heartbeat, signed with <paramref name="signWith"/> or the current identity.</summary>
        Task<ServerHeartbeatResponse> HeartbeatAsync(ServerHeartbeatRequest request, ServerIdentity? signWith = null, CancellationToken cancellationToken = default);

        /// <summary>POST /servers/keys/rotate, signed with the current key; PoP by <paramref name="newKeyPair"/>.</summary>
        Task<KeyRotateResponse> RotateKeyAsync(Ed25519KeyPair newKeyPair, CancellationToken cancellationToken = default);

        /// <summary>GET /servers/policy.</summary>
        Task<ServerPolicy> GetPolicyAsync(CancellationToken cancellationToken = default);

        /// <summary>POST /player/check.</summary>
        Task<PlayerCheckResponse> CheckPlayerAsync(PlayerCheckRequest request, CancellationToken cancellationToken = default);

        /// <summary>POST /player/bypass/check.</summary>
        Task<BypassCheckResponse> CheckBypassAsync(BypassCheckRequest request, CancellationToken cancellationToken = default);

        /// <summary>POST /player/link.</summary>
        Task<PlayerLinkResponse> LinkPlayerAsync(PlayerLinkRequest request, CancellationToken cancellationToken = default);

        /// <summary>POST /server/reports.</summary>
        Task<ServerReportResponse> SubmitReportAsync(ServerReportRequest request, CancellationToken cancellationToken = default);

        /// <summary>POST /overwatch/sessions.</summary>
        Task<OverwatchSessionStartResponse> StartOverwatchSessionAsync(OverwatchSessionStartRequest request, CancellationToken cancellationToken = default);

        /// <summary>POST /overwatch/sessions/{id}/heartbeat with body <c>{}</c>.</summary>
        Task<OverwatchSessionHeartbeatResponse> OverwatchHeartbeatAsync(Guid sessionId, CancellationToken cancellationToken = default);

        /// <summary>POST /overwatch/sessions/{id}/end.</summary>
        Task<OverwatchSessionEndResponse> EndOverwatchSessionAsync(Guid sessionId, OverwatchEndReason reason, CancellationToken cancellationToken = default);
    }
}
