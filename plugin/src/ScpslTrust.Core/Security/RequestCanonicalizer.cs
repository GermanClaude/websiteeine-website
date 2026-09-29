using System;
using System.Globalization;

namespace ScpslTrust.Core.Security
{
    /// <summary>
    /// Canonical request string of ARCHITECTURE §5.3 (mirror of shared/src/signing.ts
    /// <c>buildCanonicalRequest</c>, verified against shared/test-vectors/signing.json):
    /// <code>
    /// SCPSL-TRUST-V1\n METHOD\n path?query\n server_id\n timestamp\n nonce\n request_id\n body_sha256_hex
    /// </code>
    /// UTF-8, <c>\n</c> separators, no trailing newline.
    /// </summary>
    public static class RequestCanonicalizer
    {
        public const string Version = "SCPSL-TRUST-V1";

        /// <summary>Largest unix-ms timestamp representable exactly in JSON/JavaScript (2^53 − 1).</summary>
        public const long MaxSafeInteger = 9007199254740991L;

        /// <param name="method">HTTP method; upper-cased here.</param>
        /// <param name="pathWithQuery">Path plus query exactly as sent (percent-encoding preserved).</param>
        /// <param name="serverId">X-Server-Id.</param>
        /// <param name="timestamp">X-Timestamp: canonical decimal unix milliseconds.</param>
        /// <param name="nonce">X-Nonce.</param>
        /// <param name="requestId">X-Request-Id (used verbatim).</param>
        /// <param name="bodySha256Hex">Lowercase hex SHA-256 of the raw body bytes.</param>
        /// <exception cref="ArgumentException">A field is empty, contains whitespace/control characters or is malformed.</exception>
        public static string Build(
            string method,
            string pathWithQuery,
            string serverId,
            string timestamp,
            string nonce,
            string requestId,
            string bodySha256Hex)
        {
            if (method == null)
            {
                throw new ArgumentNullException(nameof(method));
            }

            var upperMethod = method.ToUpperInvariant();
            if (!IsMethodToken(upperMethod))
            {
                throw new ArgumentException("Invalid HTTP method.", nameof(method));
            }

            if (pathWithQuery == null || !pathWithQuery.StartsWith("/", StringComparison.Ordinal))
            {
                throw new ArgumentException("pathWithQuery must start with \"/\".", nameof(pathWithQuery));
            }

            AssertField(nameof(pathWithQuery), pathWithQuery);
            AssertField(nameof(serverId), serverId);
            AssertField(nameof(nonce), nonce);
            AssertField(nameof(requestId), requestId);
            if (!IsLowerHexSha256(bodySha256Hex))
            {
                throw new ArgumentException("bodySha256Hex must be 64 lowercase hex characters.", nameof(bodySha256Hex));
            }

            return string.Join(
                "\n",
                Version,
                upperMethod,
                pathWithQuery,
                serverId,
                FormatTimestamp(timestamp),
                nonce,
                requestId,
                bodySha256Hex);
        }

        /// <summary>Overload taking the timestamp as a number.</summary>
        public static string Build(
            string method,
            string pathWithQuery,
            string serverId,
            long timestampMs,
            string nonce,
            string requestId,
            string bodySha256Hex)
        {
            return Build(method, pathWithQuery, serverId, FormatTimestamp(timestampMs), nonce, requestId, bodySha256Hex);
        }

        /// <summary>Decimal form of a non-negative safe-integer unix-ms timestamp.</summary>
        public static string FormatTimestamp(long timestampMs)
        {
            if (timestampMs < 0 || timestampMs > MaxSafeInteger)
            {
                throw new ArgumentException("Timestamp must be a non-negative safe integer (unix ms).", nameof(timestampMs));
            }

            return timestampMs.ToString(CultureInfo.InvariantCulture);
        }

        /// <summary>Validates the decimal header form: no sign, no leading zeros, at most 2^53 − 1.</summary>
        public static string FormatTimestamp(string timestamp)
        {
            if (!IsCanonicalTimestamp(timestamp))
            {
                throw new ArgumentException("Timestamp must be a canonical decimal unix-ms value.", nameof(timestamp));
            }

            return timestamp;
        }

        public static bool IsCanonicalTimestamp(string? timestamp)
        {
            if (string.IsNullOrEmpty(timestamp) || timestamp!.Length > 16)
            {
                return false;
            }

            if (timestamp.Length > 1 && timestamp[0] == '0')
            {
                return false;
            }

            foreach (var c in timestamp)
            {
                if (c < '0' || c > '9')
                {
                    return false;
                }
            }

            return long.Parse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture) <= MaxSafeInteger;
        }

        /// <summary>Throws when a field is empty or contains characters U+0000–U+0020 or U+007F.</summary>
        internal static void AssertField(string name, string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                throw new ArgumentException("Canonical field \"" + name + "\" must not be empty.", name);
            }

            foreach (var c in value!)
            {
                if (c <= ' ' || c == '\u007f')
                {
                    throw new ArgumentException("Canonical field \"" + name + "\" contains whitespace or control characters.", name);
                }
            }
        }

        private static bool IsMethodToken(string method)
        {
            if (method.Length < 1 || method.Length > 16)
            {
                return false;
            }

            foreach (var c in method)
            {
                if (c < 'A' || c > 'Z')
                {
                    return false;
                }
            }

            return true;
        }

        private static bool IsLowerHexSha256(string? value)
        {
            if (value == null || value.Length != 64)
            {
                return false;
            }

            foreach (var c in value)
            {
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                {
                    return false;
                }
            }

            return true;
        }
    }
}
