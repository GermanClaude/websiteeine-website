using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;

namespace ScpslTrust.Core.Services
{
    /// <summary>Outcome of the most recent heartbeat.</summary>
    public sealed class HeartbeatStatus
    {
        public HeartbeatStatus(DateTimeOffset at, bool succeeded, string? serverStatus, int? policyVersion, string? error)
        {
            At = at;
            Succeeded = succeeded;
            ServerStatus = serverStatus;
            PolicyVersion = policyVersion;
            Error = error;
        }

        public DateTimeOffset At { get; }

        public bool Succeeded { get; }

        /// <summary>ServerStatus reported by the backend (active, suspended, …).</summary>
        public string? ServerStatus { get; }

        public int? PolicyVersion { get; }

        public string? Error { get; }
    }

    /// <summary>
    /// Periodic <c>POST /servers/heartbeat</c> (§6): reports plugin/game version and player count, refreshes
    /// the policy when the backend reports a new version, rotates the key when requested and re-measures
    /// the clock offset after TIMESTAMP_OUT_OF_RANGE.
    /// </summary>
    public sealed class HeartbeatService
    {
        /// <summary>Minimum time between automatic rotation attempts after a failure.</summary>
        public static readonly TimeSpan RotationRetryDelay = TimeSpan.FromMinutes(10);

        private readonly ITrustApiClient _client;
        private readonly IServerIdentityProvider _identities;
        private readonly PolicyManager _policies;
        private readonly KeyRotationService _rotation;
        private readonly ClockSkewMonitor? _clockSkew;
        private readonly Func<ServerHeartbeatRequest> _requestFactory;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private HeartbeatStatus? _last;
        private string? _lastLoggedProblem;
        private DateTimeOffset _nextRotationAttempt = DateTimeOffset.MinValue;

        public HeartbeatService(
            ITrustApiClient client,
            IServerIdentityProvider identities,
            PolicyManager policies,
            KeyRotationService rotation,
            ClockSkewMonitor? clockSkew,
            Func<ServerHeartbeatRequest> requestFactory,
            IClock clock,
            ITrustLogger logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _policies = policies ?? throw new ArgumentNullException(nameof(policies));
            _rotation = rotation ?? throw new ArgumentNullException(nameof(rotation));
            _clockSkew = clockSkew;
            _requestFactory = requestFactory ?? throw new ArgumentNullException(nameof(requestFactory));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public HeartbeatStatus? LastStatus => Volatile.Read(ref _last);

        /// <summary>Sends one heartbeat and handles its consequences. Never throws for backend failures.</summary>
        public async Task BeatAsync(CancellationToken cancellationToken = default)
        {
            if (_identities.Current == null)
            {
                return;
            }

            if (_rotation.HasPendingRecovery)
            {
                await _rotation.RecoverAsync(cancellationToken).ConfigureAwait(false);
            }

            ServerHeartbeatResponse response;
            try
            {
                response = await _client.HeartbeatAsync(_requestFactory(), null, cancellationToken).ConfigureAwait(false);
            }
            catch (TrustApiException ex)
            {
                Volatile.Write(ref _last, new HeartbeatStatus(_clock.UtcNow, false, null, null, ex.Describe()));
                LogProblem("Heartbeat failed: " + ex.Describe() + Hint(ex));
                if (ex.Code == ApiErrorCodes.TimestampOutOfRange && _clockSkew != null)
                {
                    await _clockSkew.MeasureAsync(cancellationToken).ConfigureAwait(false);
                }

                return;
            }

            Volatile.Write(ref _last, new HeartbeatStatus(_clock.UtcNow, true, response.Status, response.PolicyVersion, null));
            if (!string.Equals(response.Status, "active", StringComparison.Ordinal))
            {
                LogProblem("The trust backend reports this server as '" + response.Status + "'. Contact the network administrators.");
            }
            else if (_lastLoggedProblem != null)
            {
                _logger.Info("Heartbeat OK again.");
                _lastLoggedProblem = null;
            }

            if (_policies.IsOutdated(response.PolicyVersion))
            {
                await _policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
            }

            if (response.KeyRotationRequested && _clock.UtcNow >= _nextRotationAttempt)
            {
                _logger.Info("The backend requested a key rotation; rotating now.");
                try
                {
                    await _rotation.RotateAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is TrustApiException || ex is Security.KeyStoreException)
                {
                    _nextRotationAttempt = _clock.UtcNow + RotationRetryDelay;
                    _logger.Error("Automatic key rotation failed: " + (ex is TrustApiException api ? api.Describe() : ex.Message));
                }
            }
        }

        /// <summary>Operator hint for common authentication failures.</summary>
        public static string Hint(TrustApiException ex)
        {
            switch (ex.Code)
            {
                case ApiErrorCodes.TimestampOutOfRange:
                    return " — the system clock is off; enable NTP time synchronization.";
                case ApiErrorCodes.InvalidSignature:
                    return " — the request signature was rejected; check that no proxy rewrites the request path or body.";
                case ApiErrorCodes.KeyRevoked:
                case ApiErrorCodes.NoActiveKey:
                    return " — this server's key is not active; create a new registration token in the web panel and run 'trust register <token> --force'.";
                case ApiErrorCodes.UnknownServer:
                    return " — the backend does not know this server id; re-register with a new token.";
                case ApiErrorCodes.ServerSuspended:
                case ApiErrorCodes.ServerRevoked:
                    return " — the server was suspended or revoked by the network administrators.";
                default:
                    return string.Empty;
            }
        }

        private void LogProblem(string message)
        {
            if (string.Equals(message, _lastLoggedProblem, StringComparison.Ordinal))
            {
                _logger.Debug(message);
                return;
            }

            _lastLoggedProblem = message;
            _logger.Warn(message);
        }
    }
}
