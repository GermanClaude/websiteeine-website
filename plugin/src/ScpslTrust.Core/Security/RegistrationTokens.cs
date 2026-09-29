using System;

namespace ScpslTrust.Core.Security
{
    /// <summary>Registration token format: <c>sreg_</c> + 43 base64url characters (32 random bytes).</summary>
    public static class RegistrationTokens
    {
        public const string Prefix = "sreg_";
        private const int RandomLength = 43;

        public static bool IsValid(string? value)
        {
            if (value == null || value.Length != Prefix.Length + RandomLength || !value.StartsWith(Prefix, StringComparison.Ordinal))
            {
                return false;
            }

            for (var i = Prefix.Length; i < value.Length; i++)
            {
                var c = value[i];
                var ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
                if (!ok)
                {
                    return false;
                }
            }

            return true;
        }

        /// <summary>Log-safe form: the prefix and the first four characters only.</summary>
        public static string Redact(string? value)
        {
            if (value == null || value.Length < Prefix.Length + 4)
            {
                return "sreg_…";
            }

            return value.Substring(0, Prefix.Length + 4) + "…";
        }
    }
}
