using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Config;

namespace ScpslTrust.Core.Policy
{
    /// <summary>Where the policy currently in effect came from.</summary>
    public enum PolicyOrigin
    {
        /// <summary>Built-in §7.4 default (no remote policy fetched yet).</summary>
        Default,

        /// <summary>Loaded from policy-cache.json (last successful fetch).</summary>
        Cache,

        /// <summary>Fetched from the backend during this run.</summary>
        Remote,

        /// <summary>The plugin config's local_policy.</summary>
        Local,
    }

    /// <summary>
    /// Holds the policy in effect. <c>remote</c>: last fetched policy (persisted to <see cref="PolicyCache"/>),
    /// falling back to the cache and then to the default policy; <c>local</c>: the config's local_policy.
    /// A failed refresh never replaces a working policy (§7.3: cached policy is used when fetching fails).
    /// </summary>
    public sealed class PolicyManager
    {
        private readonly ITrustApiClient _client;
        private readonly IServerIdentityProvider _identities;
        private readonly PolicyCache _cache;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private readonly SemaphoreSlim _refreshLock = new SemaphoreSlim(1, 1);
        private readonly object _gate = new object();
        private ServerPolicy _current = DefaultPolicy.Build();
        private PolicyOrigin _origin = PolicyOrigin.Default;
        private DateTimeOffset? _lastRefreshAt;
        private string? _lastError;

        public PolicyManager(PolicySourceKind source, ServerPolicy localPolicy, ITrustApiClient client, IServerIdentityProvider identities, PolicyCache cache, IClock clock, ITrustLogger logger)
        {
            Source = source;
            LocalPolicy = localPolicy ?? DefaultPolicy.Build();
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _cache = cache ?? throw new ArgumentNullException(nameof(cache));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public PolicySourceKind Source { get; }

        public ServerPolicy LocalPolicy { get; private set; }

        public ServerPolicy Current
        {
            get
            {
                lock (_gate)
                {
                    return _current;
                }
            }
        }

        public PolicyOrigin Origin
        {
            get
            {
                lock (_gate)
                {
                    return _origin;
                }
            }
        }

        public DateTimeOffset? LastRefreshAt
        {
            get
            {
                lock (_gate)
                {
                    return _lastRefreshAt;
                }
            }
        }

        /// <summary>Error of the last failed refresh (log-safe), null after a success.</summary>
        public string? LastError
        {
            get
            {
                lock (_gate)
                {
                    return _lastError;
                }
            }
        }

        /// <summary>Selects the initial policy: local policy, or cached remote policy, or the default.</summary>
        public void Initialize()
        {
            if (Source == PolicySourceKind.Local)
            {
                Set(LocalPolicy, PolicyOrigin.Local, null);
                return;
            }

            var serverId = _identities.Current?.ServerId;
            var cached = serverId == null ? null : _cache.Load(serverId);
            if (cached != null)
            {
                Set(cached.Policy, PolicyOrigin.Cache, cached.FetchedAt);
                _logger.Info("Using cached policy version " + cached.Policy.Version + " until the backend is reached.");
            }
            else
            {
                Set(DefaultPolicy.Build(), PolicyOrigin.Default, null);
            }
        }

        /// <summary>Replaces the local policy (config reload). Takes effect immediately for policy_source local.</summary>
        public void SetLocalPolicy(ServerPolicy policy)
        {
            LocalPolicy = policy ?? throw new ArgumentNullException(nameof(policy));
            if (Source == PolicySourceKind.Local)
            {
                Set(policy, PolicyOrigin.Local, _clock.UtcNow);
            }
        }

        /// <summary>True when the backend reports a different policy version than the one in effect.</summary>
        public bool IsOutdated(int? remoteVersion)
        {
            if (Source != PolicySourceKind.Remote || !remoteVersion.HasValue)
            {
                return false;
            }

            lock (_gate)
            {
                return _origin != PolicyOrigin.Remote || _current.Version != remoteVersion.Value;
            }
        }

        /// <summary>Fetches the remote policy. Returns false (keeping the current policy) on failure or for local policies.</summary>
        public async Task<bool> RefreshAsync(CancellationToken cancellationToken = default)
        {
            if (Source != PolicySourceKind.Remote)
            {
                return false;
            }

            var identity = _identities.Current;
            if (identity?.ServerId == null)
            {
                return false;
            }

            await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                ServerPolicy policy;
                try
                {
                    policy = await _client.GetPolicyAsync(cancellationToken).ConfigureAwait(false);
                }
                catch (TrustApiException ex)
                {
                    lock (_gate)
                    {
                        _lastError = ex.Describe();
                    }

                    _logger.Warn("Policy refresh failed (" + ex.Describe() + "); keeping " + Describe() + ".");
                    return false;
                }

                var previousVersion = Current.Version;
                var previousOrigin = Origin;
                var now = _clock.UtcNow;
                Set(policy, PolicyOrigin.Remote, now);
                _cache.Save(identity.ServerId, policy, now);
                if (previousOrigin != PolicyOrigin.Remote || previousVersion != policy.Version)
                {
                    _logger.Info("Policy version " + policy.Version + " loaded (" + (policy.Rules?.Count ?? 0) + " rules).");
                }

                return true;
            }
            finally
            {
                _refreshLock.Release();
            }
        }

        /// <summary>Human-readable summary, e.g. "remote policy v3".</summary>
        public string Describe()
        {
            lock (_gate)
            {
                return _origin.ToString().ToLowerInvariant() + " policy v" + _current.Version;
            }
        }

        private void Set(ServerPolicy policy, PolicyOrigin origin, DateTimeOffset? refreshedAt)
        {
            lock (_gate)
            {
                _current = policy;
                _origin = origin;
                _lastRefreshAt = refreshedAt;
                _lastError = null;
            }
        }
    }
}
