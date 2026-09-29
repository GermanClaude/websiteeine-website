using System;
using System.Threading;

namespace ScpslTrust.Core.Abstractions
{
    /// <summary>Source of the current UTC time (injectable for tests).</summary>
    public interface IClock
    {
        DateTimeOffset UtcNow { get; }
    }

    /// <summary>Wall clock of the machine.</summary>
    public sealed class SystemClock : IClock
    {
        public static readonly SystemClock Instance = new SystemClock();

        private SystemClock()
        {
        }

        public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Clock that adds a correction offset to an inner clock. Used to compensate a skewed
    /// server clock after measuring the backend time (signed requests allow only ±60 s).
    /// </summary>
    public sealed class OffsetClock : IClock
    {
        private long _offsetTicks;

        public OffsetClock(IClock inner)
        {
            Inner = inner ?? throw new ArgumentNullException(nameof(inner));
        }

        public IClock Inner { get; }

        public TimeSpan Offset => TimeSpan.FromTicks(Interlocked.Read(ref _offsetTicks));

        public DateTimeOffset UtcNow => Inner.UtcNow + Offset;

        public void SetOffset(TimeSpan offset) => Interlocked.Exchange(ref _offsetTicks, offset.Ticks);
    }
}
