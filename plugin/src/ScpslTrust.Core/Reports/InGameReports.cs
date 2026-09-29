using System;
using System.Collections.Generic;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Core.Reports
{
    public enum InGameReportKind
    {
        /// <summary>The game's "report cheater" function.</summary>
        Cheater,

        /// <summary>The game's "report player" (rule violation) function.</summary>
        Player,
    }

    /// <summary>Builds <c>POST /server/reports</c> bodies from in-game reports (§6.5).</summary>
    public static class InGameReportFactory
    {
        public const int ReasonMinLength = 3;
        public const int ReasonMaxLength = 200;
        public const int DescriptionMaxLength = 5000;

        /// <summary>Returns null for self-reports.</summary>
        public static ServerReportRequest? Create(
            InGameReportKind kind,
            PlayerRef target,
            string? targetNickname,
            PlayerRef? reporter,
            string? reporterNickname,
            string? reason,
            string? serverName)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            if (reporter != null && reporter.Equals(target))
            {
                return null;
            }

            var cleanedReason = TextSanitizer.CleanLine(TextSanitizer.StripRichText(reason), ReasonMaxLength);
            if (cleanedReason.Length < ReasonMinLength)
            {
                cleanedReason = kind == InGameReportKind.Cheater ? "In-game cheater report (no reason given)" : "In-game player report (no reason given)";
            }

            var lines = new List<string>
            {
                "Source: in-game " + (kind == InGameReportKind.Cheater ? "cheater" : "player") + " report",
            };
            var server = TextSanitizer.CleanLine(TextSanitizer.StripRichText(serverName), 100);
            if (server.Length > 0)
            {
                lines.Add("Server: " + server);
            }

            var targetName = TextSanitizer.ToNickname(TextSanitizer.StripRichText(targetNickname));
            if (targetName != null)
            {
                lines.Add("Reported player nickname: " + targetName);
            }

            var reporterName = TextSanitizer.ToNickname(TextSanitizer.StripRichText(reporterNickname));
            if (reporterName != null)
            {
                lines.Add("Reporter nickname: " + reporterName);
            }

            return new ServerReportRequest
            {
                Player = target,
                Reporter = reporter,
                Reason = cleanedReason,
                Description = TextSanitizer.Truncate(string.Join("\n", lines), DescriptionMaxLength),
            };
        }
    }

    /// <summary>
    /// Drops repeated reports of the same target by the same reporter within a window and caps the
    /// number of forwarded reports per reporter, so a single player cannot flood the backend.
    /// </summary>
    public sealed class ReportThrottle
    {
        private readonly IClock _clock;
        private readonly TimeSpan _duplicateWindow;
        private readonly TimeSpan _reporterWindow;
        private readonly int _maxPerReporter;
        private readonly object _gate = new object();
        private readonly Dictionary<string, DateTimeOffset> _pairs = new Dictionary<string, DateTimeOffset>(StringComparer.Ordinal);
        private readonly Dictionary<string, List<DateTimeOffset>> _reporters = new Dictionary<string, List<DateTimeOffset>>(StringComparer.Ordinal);

        public ReportThrottle(IClock clock, TimeSpan duplicateWindow, TimeSpan reporterWindow, int maxPerReporter)
        {
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _duplicateWindow = duplicateWindow;
            _reporterWindow = reporterWindow;
            _maxPerReporter = Math.Max(1, maxPerReporter);
        }

        /// <summary>10-minute duplicate window, at most 5 reports per reporter per hour.</summary>
        public static ReportThrottle CreateDefault(IClock clock) => new ReportThrottle(clock, TimeSpan.FromMinutes(10), TimeSpan.FromHours(1), 5);

        /// <summary>Records and returns true when the report may be forwarded.</summary>
        public bool TryAcquire(PlayerRef? reporter, PlayerRef target)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            var now = _clock.UtcNow;
            var reporterKey = reporter?.ToUserId() ?? "anonymous";
            var pairKey = reporterKey + ">" + target.ToUserId();
            lock (_gate)
            {
                Prune(now);
                if (_pairs.TryGetValue(pairKey, out var last) && now - last < _duplicateWindow)
                {
                    return false;
                }

                if (!_reporters.TryGetValue(reporterKey, out var history))
                {
                    history = new List<DateTimeOffset>();
                    _reporters[reporterKey] = history;
                }

                if (history.Count >= _maxPerReporter)
                {
                    return false;
                }

                history.Add(now);
                _pairs[pairKey] = now;
                return true;
            }
        }

        private void Prune(DateTimeOffset now)
        {
            var stalePairs = new List<string>();
            foreach (var pair in _pairs)
            {
                if (now - pair.Value >= _duplicateWindow)
                {
                    stalePairs.Add(pair.Key);
                }
            }

            foreach (var key in stalePairs)
            {
                _pairs.Remove(key);
            }

            var emptyReporters = new List<string>();
            foreach (var entry in _reporters)
            {
                entry.Value.RemoveAll(at => now - at >= _reporterWindow);
                if (entry.Value.Count == 0)
                {
                    emptyReporters.Add(entry.Key);
                }
            }

            foreach (var key in emptyReporters)
            {
                _reporters.Remove(key);
            }
        }
    }
}
