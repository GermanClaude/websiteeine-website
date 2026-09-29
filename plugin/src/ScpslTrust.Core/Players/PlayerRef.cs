using System;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json.Serialization;

namespace ScpslTrust.Core.Players
{
    /// <summary>Player id namespace (ARCHITECTURE §2.2). Serialized lowercase: steam | discord | northwood.</summary>
    public enum PlayerIdType
    {
        Steam,
        Discord,
        Northwood,
    }

    /// <summary>
    /// Validated player reference <c>{ "type", "id" }</c>. The canonical string form (SCP:SL
    /// UserId) is <c>&lt;id&gt;@&lt;type&gt;</c>, e.g. <c>76561198000000001@steam</c>.
    /// </summary>
    public sealed class PlayerRef : IEquatable<PlayerRef>
    {
        /// <summary>Longest canonical user id (<c>&lt;64 chars&gt;@northwood</c>).</summary>
        public const int UserIdMaxLength = 64 + 1 + 9;

        [JsonConstructor]
        public PlayerRef(PlayerIdType type, string id)
        {
            if (!IsValidId(type, id))
            {
                throw new ArgumentException("Invalid player id for its type.", nameof(id));
            }

            Type = type;
            Id = id;
        }

        public PlayerIdType Type { get; }

        public string Id { get; }

        /// <summary>Canonical <c>&lt;id&gt;@&lt;type&gt;</c> form.</summary>
        public string ToUserId() => Id + "@" + TypeName(Type);

        public override string ToString() => ToUserId();

        public bool Equals(PlayerRef? other) => other is not null && other.Type == Type && string.Equals(other.Id, Id, StringComparison.Ordinal);

        public override bool Equals(object? obj) => obj is PlayerRef other && Equals(other);

        public override int GetHashCode() => unchecked(((int)Type * 397) ^ StringComparer.Ordinal.GetHashCode(Id));

        /// <summary>Wire name of a type (steam | discord | northwood).</summary>
        public static string TypeName(PlayerIdType type)
        {
            switch (type)
            {
                case PlayerIdType.Steam:
                    return "steam";
                case PlayerIdType.Discord:
                    return "discord";
                case PlayerIdType.Northwood:
                    return "northwood";
                default:
                    throw new ArgumentOutOfRangeException(nameof(type));
            }
        }

        public static bool TryParseType(string? value, out PlayerIdType type)
        {
            switch (value)
            {
                case "steam":
                    type = PlayerIdType.Steam;
                    return true;
                case "discord":
                    type = PlayerIdType.Discord;
                    return true;
                case "northwood":
                    type = PlayerIdType.Northwood;
                    return true;
                default:
                    type = default;
                    return false;
            }
        }

        /// <summary>steam = 17 digits; discord = 17–20 digits; northwood = <c>[a-z0-9_.-]{1,64}</c>.</summary>
        public static bool IsValidId(PlayerIdType type, string? id)
        {
            if (id == null)
            {
                return false;
            }

            switch (type)
            {
                case PlayerIdType.Steam:
                    return id.Length == 17 && AllDigits(id);
                case PlayerIdType.Discord:
                    return id.Length >= 17 && id.Length <= 20 && AllDigits(id);
                case PlayerIdType.Northwood:
                    if (id.Length < 1 || id.Length > 64)
                    {
                        return false;
                    }

                    foreach (var c in id)
                    {
                        var ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-';
                        if (!ok)
                        {
                            return false;
                        }
                    }

                    return true;
                default:
                    return false;
            }
        }

        /// <summary>
        /// Parses a canonical user id (<c>&lt;id&gt;@&lt;type&gt;</c>). Accepts a URL-encoded <c>@</c> (<c>%40</c>).
        /// Returns false for unknown types, bad id formats or extra separators.
        /// </summary>
        public static bool TryParseUserId(string? value, [NotNullWhen(true)] out PlayerRef? player)
        {
            player = null;
            if (string.IsNullOrEmpty(value) || value!.Length > UserIdMaxLength + 2)
            {
                return false;
            }

            var decoded = value.Replace("%40", "@");

            var at = decoded.IndexOf('@');
            if (at <= 0 || at != decoded.LastIndexOf('@'))
            {
                return false;
            }

            var id = decoded.Substring(0, at);
            if (!TryParseType(decoded.Substring(at + 1), out var type) || !IsValidId(type, id))
            {
                return false;
            }

            player = new PlayerRef(type, id);
            return true;
        }

        private static bool AllDigits(string value)
        {
            foreach (var c in value)
            {
                if (c < '0' || c > '9')
                {
                    return false;
                }
            }

            return true;
        }
    }
}
