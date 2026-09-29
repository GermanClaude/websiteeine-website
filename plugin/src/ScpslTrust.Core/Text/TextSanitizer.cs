using System;
using System.Text;

namespace ScpslTrust.Core.Text
{
    /// <summary>Normalization of untrusted text (nicknames, report reasons) before sending or displaying it.</summary>
    public static class TextSanitizer
    {
        public const int NicknameMaxLength = 64;

        /// <summary>Nickname for the player check: control characters removed, trimmed, at most 64 characters; null when empty.</summary>
        public static string? ToNickname(string? value)
        {
            var cleaned = CleanLine(value, NicknameMaxLength);
            return cleaned.Length == 0 ? null : cleaned;
        }

        /// <summary>
        /// Removes control characters (newlines become spaces), collapses whitespace runs, trims and
        /// truncates to <paramref name="maxLength"/> characters without splitting surrogate pairs.
        /// </summary>
        public static string CleanLine(string? value, int maxLength)
        {
            if (string.IsNullOrEmpty(value) || maxLength <= 0)
            {
                return string.Empty;
            }

            var builder = new StringBuilder(Math.Min(value!.Length, maxLength));
            var lastWasSpace = true;
            foreach (var c in value)
            {
                var ch = char.IsControl(c) || char.IsWhiteSpace(c) ? ' ' : c;
                if (ch == ' ')
                {
                    if (lastWasSpace)
                    {
                        continue;
                    }

                    lastWasSpace = true;
                }
                else
                {
                    lastWasSpace = false;
                }

                builder.Append(ch);
            }

            var text = builder.ToString().Trim();
            return Truncate(text, maxLength);
        }

        /// <summary>Like <see cref="CleanLine"/> but keeps line breaks (for multi-line descriptions).</summary>
        public static string CleanMultiline(string? value, int maxLength)
        {
            if (string.IsNullOrEmpty(value) || maxLength <= 0)
            {
                return string.Empty;
            }

            var builder = new StringBuilder(Math.Min(value!.Length, maxLength));
            foreach (var c in value.Replace("\r\n", "\n"))
            {
                if (c == '\n' || c == '\t' || !char.IsControl(c))
                {
                    builder.Append(c);
                }
            }

            return Truncate(builder.ToString().Trim(), maxLength);
        }

        /// <summary>Removes rich-text tags (<c>&lt;color=red&gt;</c>, <c>&lt;size=20&gt;</c>, …) used by the game UI.</summary>
        public static string StripRichText(string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var builder = new StringBuilder(value!.Length);
            var depth = 0;
            foreach (var c in value)
            {
                if (c == '<')
                {
                    depth++;
                    continue;
                }

                if (c == '>' && depth > 0)
                {
                    depth--;
                    continue;
                }

                if (depth == 0)
                {
                    builder.Append(c);
                }
            }

            return builder.ToString();
        }

        /// <summary>
        /// Makes untrusted text safe to embed in rich-text output (hints, broadcasts, RA console):
        /// angle brackets are replaced by look-alike characters so no tags can be injected.
        /// </summary>
        public static string EscapeRichText(string? value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value!.Replace('<', '＜').Replace('>', '＞');
        }

        /// <summary>Truncates to at most <paramref name="maxLength"/> UTF-16 units without splitting a surrogate pair.</summary>
        public static string Truncate(string value, int maxLength)
        {
            if (value.Length <= maxLength)
            {
                return value;
            }

            var length = maxLength;
            if (length > 0 && char.IsHighSurrogate(value[length - 1]))
            {
                length--;
            }

            return value.Substring(0, length);
        }
    }
}
