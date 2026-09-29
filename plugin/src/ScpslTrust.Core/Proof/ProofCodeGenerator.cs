using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace ScpslTrust.Core.Proof
{
    /// <summary>
    /// Overwatch proof codes (ARCHITECTURE §10.2), mirror of shared/src/signing.ts, verified against
    /// shared/test-vectors/proof-codes.json:
    /// <code>
    /// w       = floor(unix_seconds / interval_seconds)
    /// message = "SCPSL-TRUST-PROOF-V1|" + session_id + "|" + server_id + "|" + target_user_id + "|" + spectator_user_id + "|" + w
    /// mac     = HMAC-SHA256(secret, UTF-8(message))
    /// v       = big-endian uint32(mac[0..3]) &gt;&gt;&gt; 2   (30 bits)
    /// code    = six 5-bit groups (most significant first) over the Crockford alphabet, "XXX-XXX"
    /// </code>
    /// </summary>
    public static class ProofCodeGenerator
    {
        public const string MessageVersion = "SCPSL-TRUST-PROOF-V1";
        public const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        /// <summary>w = floor(unix_seconds / interval_seconds).</summary>
        public static long Window(long unixSeconds, int intervalSeconds)
        {
            if (intervalSeconds < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(intervalSeconds), "Interval must be a positive number of seconds.");
            }

            if (unixSeconds < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(unixSeconds), "Timestamp must not be negative.");
            }

            return unixSeconds / intervalSeconds;
        }

        /// <summary>HMAC input for one window.</summary>
        public static string BuildMessage(string sessionId, string serverId, string targetUserId, string spectatorUserId, long window)
        {
            AssertField(nameof(sessionId), sessionId);
            AssertField(nameof(serverId), serverId);
            AssertField(nameof(targetUserId), targetUserId);
            AssertField(nameof(spectatorUserId), spectatorUserId);
            if (window < 0 || window > 9007199254740991L)
            {
                throw new ArgumentOutOfRangeException(nameof(window), "Proof window must be a non-negative safe integer.");
            }

            return string.Join(
                "|",
                MessageVersion,
                sessionId,
                serverId,
                targetUserId,
                spectatorUserId,
                window.ToString(CultureInfo.InvariantCulture));
        }

        public static byte[] ComputeMac(byte[] secret, string message)
        {
            if (secret == null || secret.Length == 0)
            {
                throw new ArgumentException("A non-empty secret is required.", nameof(secret));
            }

            if (message == null)
            {
                throw new ArgumentNullException(nameof(message));
            }

            using (var hmac = new HMACSHA256(secret))
            {
                return hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
            }
        }

        /// <summary>Code from an HMAC digest (at least 4 bytes).</summary>
        public static string CodeFromMac(byte[] mac)
        {
            if (mac == null || mac.Length < 4)
            {
                throw new ArgumentException("MAC must contain at least 4 bytes.", nameof(mac));
            }

            var value = (((uint)mac[0] << 24) | ((uint)mac[1] << 16) | ((uint)mac[2] << 8) | mac[3]) >> 2;
            var chars = new char[7];
            var position = 0;
            for (var i = 0; i < 6; i++)
            {
                if (i == 3)
                {
                    chars[position++] = '-';
                }

                chars[position++] = Alphabet[(int)((value >> (25 - (5 * i))) & 0x1f)];
            }

            return new string(chars);
        }

        /// <summary>Code of the window containing <paramref name="unixSeconds"/>.</summary>
        public static string Generate(byte[] secret, string sessionId, string serverId, string targetUserId, string spectatorUserId, long unixSeconds, int intervalSeconds)
        {
            var window = Window(unixSeconds, intervalSeconds);
            return CodeFromMac(ComputeMac(secret, BuildMessage(sessionId, serverId, targetUserId, spectatorUserId, window)));
        }

        private static void AssertField(string name, string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                throw new ArgumentException("Proof field \"" + name + "\" must not be empty.", name);
            }

            foreach (var c in value!)
            {
                if (c <= ' ' || c == '\u007f')
                {
                    throw new ArgumentException("Proof field \"" + name + "\" contains whitespace or control characters.", name);
                }

                if (c == '|')
                {
                    throw new ArgumentException("Proof field \"" + name + "\" must not contain \"|\".", name);
                }
            }
        }
    }

    /// <summary>Text of the on-screen proof overlay (§10.2).</summary>
    public static class ProofOverlay
    {
        /// <summary><c>PROOF 7K4-X92 · 15:42:20 UTC · srv_… · #5b1d7e2a</c></summary>
        public static string Format(string code, DateTimeOffset now, string serverId, Guid sessionId)
        {
            var time = now.UtcDateTime.ToString("HH:mm:ss", CultureInfo.InvariantCulture);
            return "PROOF " + code + " · " + time + " UTC · " + serverId + " · #" + sessionId.ToString("N").Substring(0, 8);
        }
    }
}
