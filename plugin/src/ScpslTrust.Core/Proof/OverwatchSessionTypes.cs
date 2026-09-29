using System;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;

namespace ScpslTrust.Core.Proof
{
    public sealed class OverwatchSessionManagerOptions
    {
        /// <summary>Wait before retrying a failed session start for the same target.</summary>
        public TimeSpan StartRetryBackoff { get; set; } = TimeSpan.FromSeconds(30);

        /// <summary>Wait before retrying a heartbeat that failed transiently.</summary>
        public TimeSpan HeartbeatRetryDelay { get; set; } = TimeSpan.FromSeconds(5);

        /// <summary>Used when the backend does not send <c>heartbeat_interval_seconds</c>.</summary>
        public TimeSpan DefaultHeartbeatInterval { get; set; } = TimeSpan.FromSeconds(30);
    }

    public enum OverwatchSessionEventKind
    {
        /// <summary>The backend created a session; the overlay is shown from now on.</summary>
        Started,

        /// <summary>The session was ended by the plugin.</summary>
        Ended,

        /// <summary>Starting a session failed; retried after the back-off.</summary>
        StartFailed,

        /// <summary>The backend no longer considers the session active (expired or ended elsewhere).</summary>
        Lost,
    }

    /// <summary>Lifecycle notification (raised on a background thread).</summary>
    public sealed class OverwatchSessionEvent
    {
        public OverwatchSessionEvent(OverwatchSessionEventKind kind, PlayerRef spectator, PlayerRef target, Guid? sessionId, OverwatchEndReason? reason, string? error)
        {
            Kind = kind;
            Spectator = spectator;
            Target = target;
            SessionId = sessionId;
            Reason = reason;
            Error = error;
        }

        public OverwatchSessionEventKind Kind { get; }

        public PlayerRef Spectator { get; }

        public PlayerRef Target { get; }

        public Guid? SessionId { get; }

        public OverwatchEndReason? Reason { get; }

        /// <summary>Log-safe error description for <see cref="OverwatchSessionEventKind.StartFailed"/>.</summary>
        public string? Error { get; }
    }

    /// <summary>Public view of an active session (never contains the secret).</summary>
    public sealed class OverwatchSessionInfo
    {
        public OverwatchSessionInfo(Guid sessionId, PlayerRef spectator, PlayerRef target, int intervalSeconds, DateTimeOffset startedAt, bool manual)
        {
            SessionId = sessionId;
            Spectator = spectator;
            Target = target;
            IntervalSeconds = intervalSeconds;
            StartedAt = startedAt;
            Manual = manual;
        }

        public Guid SessionId { get; }

        public PlayerRef Spectator { get; }

        public PlayerRef Target { get; }

        public int IntervalSeconds { get; }

        public DateTimeOffset StartedAt { get; }

        /// <summary>Started with <c>trust proof start</c> rather than by spectating.</summary>
        public bool Manual { get; }
    }

    /// <summary>Overlay text for one spectator at one instant.</summary>
    public sealed class ProofOverlayLine
    {
        public ProofOverlayLine(PlayerRef spectator, Guid sessionId, string code, string text)
        {
            Spectator = spectator;
            SessionId = sessionId;
            Code = code;
            Text = text;
        }

        public PlayerRef Spectator { get; }

        public Guid SessionId { get; }

        public string Code { get; }

        public string Text { get; }
    }
}
