using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Services
{
    public sealed class RegistrationResult
    {
        public RegistrationResult(string serverId, string keyFingerprint, string status)
        {
            ServerId = serverId;
            KeyFingerprint = keyFingerprint;
            Status = status;
        }

        public string ServerId { get; }

        public string KeyFingerprint { get; }

        public string Status { get; }
    }

    /// <summary>
    /// Registers this server (§5.2). The key pair is generated locally and stored as
    /// <c>identity.pending.json</c> before the request, so a failed or interrupted attempt can be
    /// retried with the same key; only the public key and a proof of possession are sent.
    /// </summary>
    public sealed class RegistrationService
    {
        private readonly ITrustApiClient _client;
        private readonly ServerIdentityHolder _identities;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private readonly SemaphoreSlim _lock = new SemaphoreSlim(1, 1);

        public RegistrationService(ITrustApiClient client, ServerIdentityHolder identities, IClock clock, ITrustLogger logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        /// <summary>
        /// Registers with <paramref name="registrationToken"/>. Without <paramref name="force"/> an already
        /// registered server is refused (<see cref="InvalidOperationException"/>); with it a new key pair
        /// replaces the current identity once the backend accepted it.
        /// </summary>
        public async Task<RegistrationResult> RegisterAsync(string registrationToken, string? gameVersion, bool force, CancellationToken cancellationToken = default)
        {
            if (!RegistrationTokens.IsValid(registrationToken))
            {
                throw new ArgumentException("The registration token must look like sreg_ followed by 43 characters.", nameof(registrationToken));
            }

            await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var existing = _identities.Current;
                if (existing != null && !force)
                {
                    throw new InvalidOperationException("This server is already registered as " + existing.ServerId + ". Use 'trust register <token> --force' to replace its identity.");
                }

                var store = _identities.Store;
                var pending = LoadOrCreatePending(store, reuse: true);
                ServerRegisterResponse response;
                try
                {
                    response = await _client.RegisterAsync(registrationToken, pending.KeyPair, gameVersion, cancellationToken).ConfigureAwait(false);
                }
                catch (TrustApiException ex) when (ex.Code == ApiErrorCodes.PublicKeyInUse)
                {
                    // The pending key was registered by an earlier attempt whose result was lost; start over with a fresh key.
                    _logger.Warn("The pending key is already registered; generating a new key pair and retrying once.");
                    store.DeletePending();
                    pending = LoadOrCreatePending(store, reuse: false);
                    response = await _client.RegisterAsync(registrationToken, pending.KeyPair, gameVersion, cancellationToken).ConfigureAwait(false);
                }

                var registered = pending.WithServerId(response.ServerId);
                store.SaveCurrent(registered);
                store.DeletePending();
                store.DeleteRotationCandidate();
                store.DeletePrevious();
                _identities.Replace(registered, previousKeptForCleanup: false);
                _logger.Info("Registered as " + response.ServerId + " with key " + registered.Fingerprint + " (status " + response.Status + ").");
                return new RegistrationResult(response.ServerId, registered.Fingerprint, response.Status);
            }
            finally
            {
                _lock.Release();
            }
        }

        private ServerIdentity LoadOrCreatePending(KeyStore store, bool reuse)
        {
            if (reuse)
            {
                try
                {
                    var pending = store.LoadPending();
                    if (pending != null)
                    {
                        _logger.Info("Reusing the pending key " + pending.Fingerprint + " from an earlier registration attempt.");
                        return new ServerIdentity(null, pending.KeyPair, pending.CreatedAt);
                    }
                }
                catch (KeyStoreException ex)
                {
                    _logger.Warn("Discarding unreadable " + KeyStore.PendingFileName + ": " + ex.Message);
                    store.DeletePending();
                }
            }

            var identity = new ServerIdentity(null, Ed25519KeyPair.Generate(), _clock.UtcNow);
            store.SavePending(identity);
            return identity;
        }
    }
}
