using System;
using System.IO;
using System.Text.Json;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Storage;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Last successfully fetched remote policy on disk (<c>policy-cache.json</c>), used on start-up and
    /// whenever the backend is unreachable. Bound to the server id it was fetched for.
    /// </summary>
    public sealed class PolicyCache
    {
        public const string FileName = "policy-cache.json";

        private readonly ITrustLogger _logger;

        public PolicyCache(string directory, ITrustLogger logger)
        {
            if (string.IsNullOrWhiteSpace(directory))
            {
                throw new ArgumentException("Cache directory is required.", nameof(directory));
            }

            FilePath = Path.Combine(Path.GetFullPath(directory), FileName);
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public string FilePath { get; }

        /// <summary>Cached policy for <paramref name="serverId"/>, or null when absent, stale or unreadable.</summary>
        public CachedPolicy? Load(string serverId)
        {
            try
            {
                if (!File.Exists(FilePath))
                {
                    return null;
                }

                var document = TrustJson.Deserialize<CacheDocument>(File.ReadAllText(FilePath));
                if (document?.Policy == null || !string.Equals(document.ServerId, serverId, StringComparison.Ordinal))
                {
                    _logger.Warn("Ignoring " + FileName + ": it belongs to a different or unknown server.");
                    return null;
                }

                return new CachedPolicy(document.Policy, document.FetchedAt ?? DateTimeOffset.MinValue);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is JsonException || ex is NotSupportedException)
            {
                _logger.Warn("Ignoring unreadable " + FileName + " (" + ex.GetType().Name + ").");
                return null;
            }
        }

        /// <summary>Atomically replaces the cache; failures are logged, never thrown.</summary>
        public bool Save(string serverId, ServerPolicy policy, DateTimeOffset fetchedAt)
        {
            try
            {
                var document = new CacheDocument { ServerId = serverId, FetchedAt = fetchedAt, Policy = policy };
                SecureFile.WriteAllTextAtomic(FilePath, TrustJson.Serialize(document, indented: true) + "\n", ownerOnly: false);
                return true;
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                _logger.Warn("Could not write " + FileName + " (" + ex.GetType().Name + ").");
                return false;
            }
        }

        private sealed class CacheDocument
        {
            public string? ServerId { get; set; }

            public DateTimeOffset? FetchedAt { get; set; }

            public ServerPolicy? Policy { get; set; }
        }
    }

    public sealed class CachedPolicy
    {
        public CachedPolicy(ServerPolicy policy, DateTimeOffset fetchedAt)
        {
            Policy = policy;
            FetchedAt = fetchedAt;
        }

        public ServerPolicy Policy { get; }

        public DateTimeOffset FetchedAt { get; }
    }
}
