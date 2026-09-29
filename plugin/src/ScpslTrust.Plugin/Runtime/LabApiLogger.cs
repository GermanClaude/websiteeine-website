using System;
using LabApi.Features.Console;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>Routes Core log lines to the LabAPI logger; debug lines only when <c>debug: true</c>.</summary>
    internal sealed class LabApiLogger : ITrustLogger
    {
        private readonly Func<bool> _debugEnabled;

        public LabApiLogger(Func<bool> debugEnabled)
        {
            _debugEnabled = debugEnabled ?? throw new ArgumentNullException(nameof(debugEnabled));
        }

        public void Debug(string message)
        {
            if (_debugEnabled())
            {
                Logger.Debug(message);
            }
        }

        public void Info(string message) => Logger.Info(message);

        public void Warn(string message) => Logger.Warn(message);

        public void Error(string message) => Logger.Error(message);
    }
}
