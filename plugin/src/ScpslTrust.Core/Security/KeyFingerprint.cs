using System;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// Key fingerprint (ARCHITECTURE §2.3): <c>"SHA256:" + lowercase hex(SHA-256(32 raw public-key bytes))</c>.
    /// </summary>
    public static class KeyFingerprint
    {
        public const string Prefix = "SHA256:";

        public static string Compute(byte[] publicKey)
        {
            if (publicKey == null)
            {
                throw new ArgumentNullException(nameof(publicKey));
            }

            if (publicKey.Length != Ed25519KeyPair.PublicKeyLength)
            {
                throw new ArgumentException("Ed25519 public keys are 32 bytes.", nameof(publicKey));
            }

            return Prefix + Sha256.HashHex(publicKey);
        }

        /// <summary>True for <c>SHA256:</c> followed by 64 lowercase hex characters.</summary>
        public static bool IsValid(string? fingerprint)
        {
            if (fingerprint == null || fingerprint.Length != Prefix.Length + 64 || !fingerprint.StartsWith(Prefix, StringComparison.Ordinal))
            {
                return false;
            }

            for (var i = Prefix.Length; i < fingerprint.Length; i++)
            {
                var c = fingerprint[i];
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                {
                    return false;
                }
            }

            return true;
        }
    }
}
