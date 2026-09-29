using System;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Services
{
    /// <summary>
    /// Thread-safe holder of the current server identity, backed by a <see cref="KeyStore"/>.
    /// Removes <c>identity.previous.json</c> after the first successful request signed with a rotated key.
    /// </summary>
    public sealed class ServerIdentityHolder : IServerIdentityProvider
    {
        private readonly ITrustLogger _logger;
        private readonly object _gate = new object();
        private ServerIdentity? _current;
        private bool _previousPendingCleanup;

        public ServerIdentityHolder(KeyStore store, ITrustLogger logger)
        {
            Store = store ?? throw new ArgumentNullException(nameof(store));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public KeyStore Store { get; }

        public ServerIdentity? Current
        {
            get
            {
                lock (_gate)
                {
                    return _current;
                }
            }
        }

        /// <summary>Loads identity.json. Throws <see cref="KeyStoreException"/> for corrupt files.</summary>
        public ServerIdentity? Load()
        {
            var identity = Store.LoadCurrent();
            lock (_gate)
            {
                _current = identity;
                _previousPendingCleanup = identity != null && Store.HasPrevious;
            }

            return identity;
        }

        /// <summary>Switches to an identity that has already been persisted.</summary>
        public void Replace(ServerIdentity identity, bool previousKeptForCleanup)
        {
            if (identity == null)
            {
                throw new ArgumentNullException(nameof(identity));
            }

            lock (_gate)
            {
                _current = identity;
                _previousPendingCleanup = previousKeptForCleanup;
            }
        }

        public void OnSignedRequestSucceeded(ServerIdentity identity)
        {
            if (identity == null)
            {
                return;
            }

            lock (_gate)
            {
                if (!_previousPendingCleanup || _current == null || !string.Equals(_current.Fingerprint, identity.Fingerprint, StringComparison.Ordinal))
                {
                    return;
                }

                _previousPendingCleanup = false;
            }

            Store.DeletePrevious();
            _logger.Info("The rotated key " + identity.Fingerprint + " works; removed " + KeyStore.PreviousFileName + ".");
        }
    }
}
