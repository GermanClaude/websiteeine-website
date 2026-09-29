using System.Diagnostics.CodeAnalysis;

namespace ScpslTrust.Core.Players
{
    /// <summary>Account link codes (§6.6): <c>LNK-</c> + 6 Crockford base32 characters, e.g. <c>LNK-7K4X92</c>.</summary>
    public static class LinkCodes
    {
        private const string Prefix = "LNK-";
        private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        /// <summary>Upper-cases and validates user input; accepts the code with or without the <c>LNK-</c> prefix.</summary>
        public static bool TryNormalize(string? input, [NotNullWhen(true)] out string? code)
        {
            code = null;
            if (input == null)
            {
                return false;
            }

            var value = input.Trim().ToUpperInvariant();
            if (value.Length > 16)
            {
                return false;
            }

            if (value.StartsWith(Prefix, System.StringComparison.Ordinal))
            {
                value = value.Substring(Prefix.Length);
            }

            if (value.Length != 6)
            {
                return false;
            }

            foreach (var c in value)
            {
                if (Alphabet.IndexOf(c) < 0)
                {
                    return false;
                }
            }

            code = Prefix + value;
            return true;
        }
    }
}
