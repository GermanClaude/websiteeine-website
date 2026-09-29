using System;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Api.Models
{
    /// <summary>POST /overwatch/sessions (§10.1).</summary>
    public sealed class OverwatchSessionStartRequest
    {
        public PlayerRef? TargetPlayer { get; set; }

        public PlayerRef? Spectator { get; set; }

        /// <summary>Must be within ±60 s of backend time, otherwise backend time is used.</summary>
        public DateTimeOffset? StartedAt { get; set; }
    }

    /// <summary>Contains the session secret — never log or persist this object.</summary>
    public sealed class OverwatchSessionStartResponse : IApiResponse
    {
        public const int MinIntervalSeconds = 5;
        public const int MaxIntervalSeconds = 60;
        public const int SecretLength = 32;

        public Guid SessionId { get; set; }

        /// <summary>Base64 of 32 bytes; returned only in this response.</summary>
        public string Secret { get; set; } = string.Empty;

        public int IntervalSeconds { get; set; }

        public DateTimeOffset StartedAt { get; set; }

        public int HeartbeatIntervalSeconds { get; set; }

        public DateTimeOffset ServerTime { get; set; }

        public void Validate()
        {
            Require.That(SessionId != Guid.Empty, "Response field 'session_id' is missing.");
            Require.That(StrictBase64.TryDecode(Secret, SecretLength, out _), "Response field 'secret' must be base64 of 32 bytes.");
            Require.That(
                IntervalSeconds >= MinIntervalSeconds && IntervalSeconds <= MaxIntervalSeconds,
                "Response field 'interval_seconds' must be between 5 and 60.");
            Require.That(HeartbeatIntervalSeconds >= 1, "Response field 'heartbeat_interval_seconds' must be positive.");
        }

        public override string ToString() => "OverwatchSessionStartResponse(" + SessionId + ")";
    }

    public sealed class OverwatchSessionHeartbeatResponse : IApiResponse
    {
        public Guid SessionId { get; set; }

        /// <summary>active | ended | expired.</summary>
        public string Status { get; set; } = string.Empty;

        public DateTimeOffset LastHeartbeatAt { get; set; }

        public DateTimeOffset ServerTime { get; set; }

        public void Validate()
        {
            Require.NotEmpty(Status, "status");
        }
    }

    public sealed class OverwatchSessionEndRequest
    {
        public OverwatchEndReason Reason { get; set; }
    }

    public sealed class OverwatchSessionEndResponse : IApiResponse
    {
        public Guid SessionId { get; set; }

        public string Status { get; set; } = string.Empty;

        public DateTimeOffset? EndedAt { get; set; }

        public void Validate()
        {
            Require.NotEmpty(Status, "status");
        }
    }

    /// <summary>Empty JSON object body (<c>{}</c>) for the Overwatch heartbeat.</summary>
    public sealed class EmptyRequest
    {
        public static readonly EmptyRequest Instance = new EmptyRequest();
    }
}
