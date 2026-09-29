namespace ScpslTrust.Core.Abstractions
{
    /// <summary>
    /// Logging sink used by Core. Implementations must be thread-safe.
    /// Callers never pass private keys, signatures, secrets or full IP addresses.
    /// </summary>
    public interface ITrustLogger
    {
        void Debug(string message);

        void Info(string message);

        void Warn(string message);

        void Error(string message);
    }

    /// <summary>Logger that discards everything.</summary>
    public sealed class NullTrustLogger : ITrustLogger
    {
        public static readonly NullTrustLogger Instance = new NullTrustLogger();

        private NullTrustLogger()
        {
        }

        public void Debug(string message)
        {
        }

        public void Info(string message)
        {
        }

        public void Warn(string message)
        {
        }

        public void Error(string message)
        {
        }
    }
}
