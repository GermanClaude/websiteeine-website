using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Services
{
    public enum RotationRecoveryOutcome
    {
        /// <summary>No rotation was in flight.</summary>
        NothingToRecover,

        /// <summary>The backend had activated the new key; it is now the current identity.</summary>
        Committed,

        /// <summary>The backend never activated the new key; it was discarded.</summary>
        Discarded,

        /// <summary>The backend could not be asked; the candidate is kept for a later attempt.</summary>
        Undetermined,
    }

    public sealed class KeyRotationResult
    {
        public KeyRotationResult(string previousFingerprint, string newFingerprint, DateTimeOffset? previousKeyRetiringUntil, bool recovered)
        {
            PreviousFingerprint = previousFingerprint;
            NewFingerprint = newFingerprint;
            PreviousKeyRetiringUntil = previousKeyRetiringUntil;
            Recovered = recovered;
        }

        public string PreviousFingerprint { get; }

        public string NewFingerprint { get; }

        /// <summary>End of the old key's grace period (unknown for a recovered rotation).</summary>
        public DateTimeOffset? PreviousKeyRetiringUntil { get; }

        /// <summary>True when an earlier, interrupted rotation was completed instead of starting a new one.</summary>
        public bool Recovered { get; }
    }

    /// <summary>
    /// Key rotation (§5.5): a new key pair is generated locally, persisted as
    /// <c>identity.rotating.json</c>, announced with a PoP signed by the NEW key over a request signed
    /// with the CURRENT key, and committed (identity.json + identity.previous.json) after a 2xx response.
    /// When the outcome is unknown (timeout, crash) the candidate is kept and <see cref="RecoverAsync"/>
    /// later probes the backend with it to commit or discard it.
    /// </summary>
    public sealed class KeyRotationService
    {
        private readonly ITrustApiClient _client;
        private readonly ServerIdentityHolder _identities;
        private readonly Func<ServerHeartbeatRequest> _probeRequestFactory;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private readonly SemaphoreSlim _lock = new SemaphoreSlim(1, 1);

        /// <param name="probeRequestFactory">Builds the heartbeat body used to probe a candidate key.</param>
        public KeyRotationService(
            ITrustApiClient client,
            ServerIdentityHolder identities,
            Func<ServerHeartbeatRequest> probeRequestFactory,
            IClock clock,
            ITrustLogger logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _probeRequestFactory = probeRequestFactory ?? throw new ArgumentNullException(nameof(probeRequestFactory));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
        }

        /// <summary>A rotation candidate from an interrupted rotation is waiting to be resolved.</summary>
        public bool HasPendingRecovery => File.Exists(_identities.Store.RotatingPath);

        /// <summary>Rotates the key. Throws <see cref="TrustApiException"/> or <see cref="KeyStoreException"/> on failure.</summary>
        public async Task<KeyRotationResult> RotateAsync(CancellationToken cancellationToken = default)
        {
            await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                var before = RequireRegistered();
                var recovery = await RecoverCoreAsync(cancellationToken).ConfigureAwait(false);
                if (recovery == RotationRecoveryOutcome.Committed)
                {
                    return new KeyRotationResult(before.Fingerprint, RequireRegistered().Fingerprint, null, recovered: true);
                }

                if (recovery == RotationRecoveryOutcome.Undetermined)
                {
                    throw new TrustApiException(TrustApiErrorKind.Network, ApiErrorCodes.NetworkError, "An earlier key rotation is still unresolved and the backend is unreachable; try again later.");
                }

                var current = RequireRegistered();
                var store = _identities.Store;
                var candidate = new ServerIdentity(current.ServerId, Ed25519KeyPair.Generate(), _clock.UtcNow);
                store.SaveRotationCandidate(candidate);

                KeyRotateResponse response;
                try
                {
                    response = await _client.RotateKeyAsync(candidate.KeyPair, cancellationToken).ConfigureAwait(false);
                }
                catch (TrustApiException ex) when (!ex.IsTransient)
                {
                    // Definitive rejection: the new key was not activated.
                    store.DeleteRotationCandidate();
                    throw;
                }

                Commit(current, candidate);
                _logger.Info("Key rotated: " + current.Fingerprint + " -> " + candidate.Fingerprint + " (previous key accepted until " + TrustJson.FormatTimestamp(response.PreviousKeyRetiringUntil) + ").");
                return new KeyRotationResult(current.Fingerprint, candidate.Fingerprint, response.PreviousKeyRetiringUntil, recovered: false);
            }
            finally
            {
                _lock.Release();
            }
        }

        /// <summary>Resolves a rotation interrupted by a crash or timeout (call on start-up and before heartbeats).</summary>
        public async Task<RotationRecoveryOutcome> RecoverAsync(CancellationToken cancellationToken = default)
        {
            await _lock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                return await RecoverCoreAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                _lock.Release();
            }
        }

        private async Task<RotationRecoveryOutcome> RecoverCoreAsync(CancellationToken cancellationToken)
        {
            var store = _identities.Store;
            ServerIdentity? candidate;
            try
            {
                candidate = store.LoadRotationCandidate();
            }
            catch (KeyStoreException ex)
            {
                _logger.Warn("Discarding unreadable " + KeyStore.RotatingFileName + ": " + ex.Message);
                store.DeleteRotationCandidate();
                return RotationRecoveryOutcome.Discarded;
            }

            if (candidate == null)
            {
                return RotationRecoveryOutcome.NothingToRecover;
            }

            var current = _identities.Current;
            if (current == null
                || !string.Equals(current.ServerId, candidate.ServerId, StringComparison.Ordinal)
                || string.Equals(current.Fingerprint, candidate.Fingerprint, StringComparison.Ordinal))
            {
                store.DeleteRotationCandidate();
                return RotationRecoveryOutcome.Discarded;
            }

            try
            {
                await _client.HeartbeatAsync(_probeRequestFactory(), candidate, cancellationToken).ConfigureAwait(false);
            }
            catch (TrustApiException ex) when (ex.IsAuthenticationFailure)
            {
                store.DeleteRotationCandidate();
                _logger.Info("An interrupted key rotation was not applied by the backend; keeping key " + current.Fingerprint + ".");
                return RotationRecoveryOutcome.Discarded;
            }
            catch (TrustApiException ex)
            {
                _logger.Warn("Cannot resolve an interrupted key rotation yet: " + ex.Describe());
                return RotationRecoveryOutcome.Undetermined;
            }

            Commit(current, candidate);
            _logger.Info("Recovered an interrupted key rotation; now using key " + candidate.Fingerprint + ".");
            return RotationRecoveryOutcome.Committed;
        }

        private ServerIdentity RequireRegistered()
        {
            var current = _identities.Current;
            if (current == null || !current.IsRegistered)
            {
                throw new TrustApiException(TrustApiErrorKind.NotRegistered, ApiErrorCodes.NotRegistered, "This server is not registered; nothing to rotate.");
            }

            return current;
        }

        private void Commit(ServerIdentity current, ServerIdentity candidate)
        {
            _identities.Store.CommitRotation(current, candidate);
            _identities.Replace(candidate, previousKeptForCleanup: true);
        }
    }
}
