using System;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// The SCP:SL server's identity: backend-assigned <see cref="ServerId"/> (null while a key is
    /// pending registration) and its Ed25519 key pair. ToString never exposes key material.
    /// </summary>
    public sealed class ServerIdentity
    {
        public ServerIdentity(string? serverId, Ed25519KeyPair keyPair, DateTimeOffset createdAt)
        {
            if (serverId != null && !ServerIds.IsValid(serverId))
            {
                throw new ArgumentException("Invalid server id.", nameof(serverId));
            }

            ServerId = serverId;
            KeyPair = keyPair ?? throw new ArgumentNullException(nameof(keyPair));
            CreatedAt = createdAt;
        }

        public string? ServerId { get; }

        public Ed25519KeyPair KeyPair { get; }

        public DateTimeOffset CreatedAt { get; }

        public bool IsRegistered => ServerId != null;

        public string Fingerprint => KeyPair.Fingerprint;

        /// <summary>Copy of this identity bound to <paramref name="serverId"/> (same key pair instance).</summary>
        public ServerIdentity WithServerId(string serverId) => new ServerIdentity(serverId, KeyPair, CreatedAt);

        public override string ToString() => "ServerIdentity(" + (ServerId ?? "unregistered") + ", " + Fingerprint + ")";
    }

    /// <summary>Server id format: <c>srv_</c> + 16 characters of lowercase Crockford base32 (ARCHITECTURE §2.3).</summary>
    public static class ServerIds
    {
        public const string Prefix = "srv_";

        public static bool IsValid(string? value)
        {
            if (value == null || value.Length != Prefix.Length + 16 || !value.StartsWith(Prefix, StringComparison.Ordinal))
            {
                return false;
            }

            for (var i = Prefix.Length; i < value.Length; i++)
            {
                var c = value[i];
                var ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z' && c != 'i' && c != 'l' && c != 'o' && c != 'u');
                if (!ok)
                {
                    return false;
                }
            }

            return true;
        }
    }
}
