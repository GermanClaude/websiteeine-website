using System;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Api.Models
{
    /// <summary>GET /time (unsigned).</summary>
    public sealed class TimeResponse : IApiResponse
    {
        public DateTimeOffset ServerTime { get; set; }

        public long EpochMs { get; set; }

        public void Validate()
        {
            Require.That(EpochMs > 0, "Response field 'epoch_ms' must be positive.");
        }
    }

    /// <summary>POST /servers/register — token + proof of possession (§5.2).</summary>
    public sealed class ServerRegisterRequest
    {
        public string RegistrationToken { get; set; } = string.Empty;

        public string PublicKey { get; set; } = string.Empty;

        public string PluginVersion { get; set; } = string.Empty;

        public string? GameVersion { get; set; }

        public long Timestamp { get; set; }

        public string PopSignature { get; set; } = string.Empty;

        public override string ToString() => "ServerRegisterRequest(" + PublicKey + ")";
    }

    public sealed class ServerRegisterResponse : IApiResponse
    {
        public string ServerId { get; set; } = string.Empty;

        public string KeyFingerprint { get; set; } = string.Empty;

        public string Status { get; set; } = string.Empty;

        public DateTimeOffset ServerTime { get; set; }

        public void Validate()
        {
            Require.That(ServerIds.IsValid(ServerId), "Response field 'server_id' is not a valid server id.");
            Require.That(Security.KeyFingerprint.IsValid(KeyFingerprint), "Response field 'key_fingerprint' is malformed.");
            Require.NotEmpty(Status, "status");
        }
    }

    /// <summary>POST /servers/heartbeat (signed).</summary>
    public sealed class ServerHeartbeatRequest
    {
        public string PluginVersion { get; set; } = string.Empty;

        public string? GameVersion { get; set; }

        public int? PlayerCount { get; set; }
    }

    public sealed class ServerHeartbeatResponse : IApiResponse
    {
        /// <summary>ServerStatus: pending | active | suspended | revoked.</summary>
        public string Status { get; set; } = string.Empty;

        public int? PolicyVersion { get; set; }

        public bool KeyRotationRequested { get; set; }

        public DateTimeOffset ServerTime { get; set; }

        public void Validate()
        {
            Require.NotEmpty(Status, "status");
        }
    }

    /// <summary>POST /servers/keys/rotate — signed with the CURRENT key, PoP by the NEW key (§5.5).</summary>
    public sealed class KeyRotateRequest
    {
        public string NewPublicKey { get; set; } = string.Empty;

        public long Timestamp { get; set; }

        public string PopSignature { get; set; } = string.Empty;
    }

    public sealed class KeyRotateResponse : IApiResponse
    {
        public string KeyFingerprint { get; set; } = string.Empty;

        public string PreviousKeyFingerprint { get; set; } = string.Empty;

        public DateTimeOffset PreviousKeyRetiringUntil { get; set; }

        public DateTimeOffset ServerTime { get; set; }

        public void Validate()
        {
            Require.That(Security.KeyFingerprint.IsValid(KeyFingerprint), "Response field 'key_fingerprint' is malformed.");
        }
    }
}
