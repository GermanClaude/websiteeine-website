using System.Collections.Generic;

namespace ScpslTrust.Core.Security
{
    /// <summary>Header names of signed plugin requests (ARCHITECTURE §5.3).</summary>
    public static class SigningHeaderNames
    {
        public const string ServerId = "X-Server-Id";
        public const string Timestamp = "X-Timestamp";
        public const string Nonce = "X-Nonce";
        public const string RequestId = "X-Request-Id";
        public const string KeyFingerprint = "X-Key-Fingerprint";
        public const string PluginVersion = "X-Plugin-Version";
        public const string Signature = "X-Signature";
    }

    /// <summary>Values of every signing header of one request (never logged: contains the signature).</summary>
    public sealed class SignedRequestHeaders
    {
        public SignedRequestHeaders(
            string serverId,
            string timestamp,
            string nonce,
            string requestId,
            string? keyFingerprint,
            string pluginVersion,
            string signature,
            string canonicalRequest)
        {
            ServerId = serverId;
            Timestamp = timestamp;
            Nonce = nonce;
            RequestId = requestId;
            KeyFingerprint = keyFingerprint;
            PluginVersion = pluginVersion;
            Signature = signature;
            CanonicalRequest = canonicalRequest;
        }

        public string ServerId { get; }

        public string Timestamp { get; }

        public string Nonce { get; }

        public string RequestId { get; }

        /// <summary>Optional; selects the key during a rotation grace period.</summary>
        public string? KeyFingerprint { get; }

        public string PluginVersion { get; }

        /// <summary>Base64 Ed25519 signature over <see cref="CanonicalRequest"/>.</summary>
        public string Signature { get; }

        /// <summary>The exact string that was signed (for diagnostics and tests).</summary>
        public string CanonicalRequest { get; }

        /// <summary>Header name/value pairs in a stable order.</summary>
        public IEnumerable<KeyValuePair<string, string>> ToHeaders()
        {
            yield return new KeyValuePair<string, string>(SigningHeaderNames.ServerId, ServerId);
            yield return new KeyValuePair<string, string>(SigningHeaderNames.Timestamp, Timestamp);
            yield return new KeyValuePair<string, string>(SigningHeaderNames.Nonce, Nonce);
            yield return new KeyValuePair<string, string>(SigningHeaderNames.RequestId, RequestId);
            if (KeyFingerprint != null)
            {
                yield return new KeyValuePair<string, string>(SigningHeaderNames.KeyFingerprint, KeyFingerprint);
            }

            yield return new KeyValuePair<string, string>(SigningHeaderNames.PluginVersion, PluginVersion);
            yield return new KeyValuePair<string, string>(SigningHeaderNames.Signature, Signature);
        }

        public override string ToString() => "SignedRequestHeaders(" + ServerId + ", request " + RequestId + ")";
    }
}
