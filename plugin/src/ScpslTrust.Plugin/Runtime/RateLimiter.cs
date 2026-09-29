using System;
using System.Collections.Generic;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>
    /// Per-key sliding-window limiter with a minimum spacing between attempts (used for
    /// <c>.trustlink</c> so link codes cannot be brute-forced through the game console).
    /// </summary>
    internal sealed class RateLimiter
    {
        private readonly IClock _clock;
        private readonly TimeSpan _minSpacing;
        private readonly TimeSpan _window;
        private readonly int _maxPerWindow;
        private readonly object _gate = new object();
        private readonly Dictionary<string, List<DateTimeOffset>> _attempts = new Dictionary<string, List<DateTimeOffset>>(StringComparer.Ordinal);

        public RateLimiter(IClock clock, TimeSpan minSpacing, TimeSpan window, int maxPerWindow)
        {
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _minSpacing = minSpacing;
            _window = window;
            _maxPerWindow = Math.Max(1, maxPerWindow);
        }

        /// <summary>Records an attempt for <paramref name="key"/>; false when it must be rejected.</summary>
        public bool TryAcquire(string key, out TimeSpan retryAfter)
        {
            if (key == null)
            {
                throw new ArgumentNullException(nameof(key));
            }

            var now = _clock.UtcNow;
            lock (_gate)
            {
                Prune(now);
                if (!_attempts.TryGetValue(key, out var history))
                {
                    history = new List<DateTimeOffset>();
                    _attempts[key] = history;
                }

                if (history.Count > 0 && now - history[history.Count - 1] < _minSpacing)
                {
                    retryAfter = _minSpacing - (now - history[history.Count - 1]);
                    return false;
                }

                if (history.Count >= _maxPerWindow)
                {
                    retryAfter = _window - (now - history[0]);
                    return false;
                }

                history.Add(now);
                retryAfter = TimeSpan.Zero;
                return true;
            }
        }

        private void Prune(DateTimeOffset now)
        {
            var empty = new List<string>();
            foreach (var entry in _attempts)
            {
                entry.Value.RemoveAll(at => now - at >= _window);
                if (entry.Value.Count == 0)
                {
                    empty.Add(entry.Key);
                }
            }

            foreach (var key in empty)
            {
                _attempts.Remove(key);
            }
        }
    }
}
