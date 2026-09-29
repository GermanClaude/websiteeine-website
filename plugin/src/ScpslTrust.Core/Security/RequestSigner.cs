using System;
using System.Text;
using ScpslTrust.Core.Abstractions;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// Produces the signing headers of a plugin request (ARCHITECTURE §5.3): timestamp from
    /// <see cref="IClock"/> (unix ms), nonce = 18 random bytes base64url (24 chars), request id =
    /// random UUID v4, signature = Ed25519 over the canonical string.
    /// </summary>
    public sealed class RequestSigner
    {
        public const int NonceByteLength = 18;

        private readonly IClock _clock;
        private readonly string _pluginVersion;

        public RequestSigner(IClock clock, string pluginVersion)
        {
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            if (string.IsNullOrWhiteSpace(pluginVersion))
            {
                throw new ArgumentException("Plugin version is required.", nameof(pluginVersion));
            }

            _pluginVersion = pluginVersion;
        }

        /// <summary>Signs a request with fresh timestamp, nonce and request id.</summary>
        /// <param name="identity">Registered identity (server id + key).</param>
        /// <param name="method">HTTP method.</param>
        /// <param name="pathWithQuery">Path and query exactly as they will be sent.</param>
        /// <param name="body">Exact body bytes (empty array for no body).</param>
        public SignedRequestHeaders Sign(ServerIdentity identity, string method, string pathWithQuery, byte[] body)
        {
            return Sign(identity, method, pathWithQuery, body, _clock.UtcNow.ToUnixTimeMilliseconds(), NewNonce(), NewRequestId());
        }

        /// <summary>Deterministic variant with explicit timestamp, nonce and request id (tests, replays of vectors).</summary>
        public SignedRequestHeaders Sign(
            ServerIdentity identity,
            string method,
            string pathWithQuery,
            byte[] body,
            long timestampMs,
            string nonce,
            string requestId)
        {
            if (identity == null)
            {
                throw new ArgumentNullException(nameof(identity));
            }

            if (identity.ServerId == null)
            {
                throw new InvalidOperationException("The server identity is not registered yet.");
            }

            var timestamp = RequestCanonicalizer.FormatTimestamp(timestampMs);
            var canonical = RequestCanonicalizer.Build(
                method,
                pathWithQuery,
                identity.ServerId,
                timestamp,
                nonce,
                requestId,
                Sha256.HashHex(body ?? Array.Empty<byte>()));
            var signature = Convert.ToBase64String(identity.KeyPair.Sign(Encoding.UTF8.GetBytes(canonical)));
            return new SignedRequestHeaders(
                identity.ServerId,
                timestamp,
                nonce,
                requestId,
                identity.KeyPair.Fingerprint,
                _pluginVersion,
                signature,
                canonical);
        }

        /// <summary>18 CSPRNG bytes as unpadded base64url (24 characters).</summary>
        public static string NewNonce() => Base64Url.Encode(SecureRandomBytes.Get(NonceByteLength));

        /// <summary>RFC 4122 version-4 UUID from 16 CSPRNG bytes, lowercase canonical form.</summary>
        public static string NewRequestId()
        {
            var b = SecureRandomBytes.Get(16);
            b[6] = (byte)((b[6] & 0x0f) | 0x40);
            b[8] = (byte)((b[8] & 0x3f) | 0x80);
            var hex = Hex.Encode(b);
            return hex.Substring(0, 8) + "-" + hex.Substring(8, 4) + "-" + hex.Substring(12, 4) + "-" + hex.Substring(16, 4) + "-" + hex.Substring(20, 12);
        }
    }
}
