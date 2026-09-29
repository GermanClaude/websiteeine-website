using System;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;

namespace ScpslTrust.Core.Services
{
    /// <summary>
    /// Measures the offset between this machine and the backend via <c>GET /time</c> and applies it to
    /// an <see cref="OffsetClock"/> used for request timestamps. Signed requests are rejected outside
    /// ±60 s (TIMESTAMP_OUT_OF_RANGE), so a skewed server clock would otherwise break every call.
    /// </summary>
    public sealed class ClockSkewMonitor
    {
        /// <summary>Offsets smaller than this are ignored (network jitter).</summary>
        public static readonly TimeSpan ApplyThreshold = TimeSpan.FromSeconds(1);

        /// <summary>Offsets at least this large are logged as warnings.</summary>
        public static readonly TimeSpan WarnThreshold = TimeSpan.FromSeconds(10);

        /// <summary>Offsets beyond this are considered implausible and not applied.</summary>
        public static readonly TimeSpan MaxCorrection = TimeSpan.FromDays(1);

        private readonly ITrustApiClient _client;
        private readonly OffsetClock _clock;
        private readonly ITrustLogger _logger;
        private long _lastSkewTicks;
        private int _measured;

        public ClockSkewMonitor(ITrustApiClient client, OffsetClock clock, ITrustLogger logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        /// <summary>Last measured offset (backend minus local), or null before the first measurement.</summary>
        public TimeSpan? LastMeasuredSkew => Volatile.Read(ref _measured) == 0 ? (TimeSpan?)null : TimeSpan.FromTicks(Interlocked.Read(ref _lastSkewTicks));

        /// <summary>Measures and applies the offset; returns null when the backend is unreachable.</summary>
        public async Task<TimeSpan?> MeasureAsync(CancellationToken cancellationToken = default)
        {
            var sent = _clock.Inner.UtcNow;
            Api.Models.TimeResponse response;
            try
            {
                response = await _client.GetTimeAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (TrustApiException ex)
            {
                _logger.Debug("Clock check skipped: " + ex.Describe());
                return null;
            }

            var received = _clock.Inner.UtcNow;
            var midpoint = sent + TimeSpan.FromTicks((received - sent).Ticks / 2);
            var skew = DateTimeOffset.FromUnixTimeMilliseconds(response.EpochMs) - midpoint;
            Interlocked.Exchange(ref _lastSkewTicks, skew.Ticks);
            Volatile.Write(ref _measured, 1);

            var magnitude = skew.Duration();
            if (magnitude > MaxCorrection)
            {
                _logger.Error("The system clock differs from the trust backend by " + FormatSeconds(skew) + "; not correcting such a large offset. Fix the system time (NTP).");
                _clock.SetOffset(TimeSpan.Zero);
                return skew;
            }

            _clock.SetOffset(magnitude >= ApplyThreshold ? skew : TimeSpan.Zero);
            if (magnitude >= WarnThreshold)
            {
                _logger.Warn("The system clock differs from the trust backend by " + FormatSeconds(skew) + "; request timestamps are corrected, but please synchronize the system time (NTP).");
            }

            return skew;
        }

        private static string FormatSeconds(TimeSpan value)
        {
            return value.TotalSeconds.ToString("+0.0;-0.0", CultureInfo.InvariantCulture) + " s";
        }
    }
}
