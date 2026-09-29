using System;
using System.Security.Cryptography;
using System.Text;

namespace ScpslTrust.Core.Security
{
    /// <summary>Lowercase hexadecimal encoding.</summary>
    public static class Hex
    {
        private const string Digits = "0123456789abcdef";

        public static string Encode(byte[] bytes)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException(nameof(bytes));
            }

            var chars = new char[bytes.Length * 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                chars[i * 2] = Digits[bytes[i] >> 4];
                chars[(i * 2) + 1] = Digits[bytes[i] & 0x0f];
            }

            return new string(chars);
        }

        /// <summary>Decodes hex (either case). Throws <see cref="FormatException"/> on invalid input.</summary>
        public static byte[] Decode(string hex)
        {
            if (hex == null)
            {
                throw new ArgumentNullException(nameof(hex));
            }

            if (hex.Length % 2 != 0)
            {
                throw new FormatException("Hex string must have an even length.");
            }

            var bytes = new byte[hex.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                bytes[i] = (byte)((Nibble(hex[i * 2]) << 4) | Nibble(hex[(i * 2) + 1]));
            }

            return bytes;
        }

        private static int Nibble(char c)
        {
            if (c >= '0' && c <= '9')
            {
                return c - '0';
            }

            if (c >= 'a' && c <= 'f')
            {
                return c - 'a' + 10;
            }

            if (c >= 'A' && c <= 'F')
            {
                return c - 'A' + 10;
            }

            throw new FormatException("Invalid hex character.");
        }
    }

    /// <summary>Unpadded base64url (RFC 4648 §5).</summary>
    public static class Base64Url
    {
        public static string Encode(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }
    }

    /// <summary>Strict decoding of standard, padded base64 as used on the wire (keys, signatures, secrets).</summary>
    public static class StrictBase64
    {
        /// <summary>
        /// Decodes <paramref name="value"/> only if it is canonical padded base64 of exactly
        /// <paramref name="expectedLength"/> bytes (re-encoding must reproduce the input).
        /// </summary>
        public static bool TryDecode(string? value, int expectedLength, out byte[] bytes)
        {
            bytes = Array.Empty<byte>();
            if (value == null || value.Length != ((expectedLength + 2) / 3) * 4)
            {
                return false;
            }

            foreach (var c in value)
            {
                var ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=';
                if (!ok)
                {
                    return false;
                }
            }

            byte[] decoded;
            try
            {
                decoded = Convert.FromBase64String(value);
            }
            catch (FormatException)
            {
                return false;
            }

            if (decoded.Length != expectedLength || !string.Equals(Convert.ToBase64String(decoded), value, StringComparison.Ordinal))
            {
                return false;
            }

            bytes = decoded;
            return true;
        }
    }

    /// <summary>SHA-256 helpers.</summary>
    public static class Sha256
    {
        /// <summary>Lowercase hex SHA-256 of the empty byte string.</summary>
        public const string EmptyHex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        public static byte[] Hash(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                return sha.ComputeHash(data ?? Array.Empty<byte>());
            }
        }

        public static string HashHex(byte[] data) => Hex.Encode(Hash(data));

        public static string HashHex(string text) => HashHex(Encoding.UTF8.GetBytes(text));
    }

    /// <summary>Cryptographically secure random bytes.</summary>
    public static class SecureRandomBytes
    {
        public static byte[] Get(int length)
        {
            var bytes = new byte[length];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }

            return bytes;
        }
    }
}
