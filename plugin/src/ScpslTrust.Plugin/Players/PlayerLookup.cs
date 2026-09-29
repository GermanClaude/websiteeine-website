using System;
using System.Collections.Generic;
using System.Globalization;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Players;

namespace ScpslTrust.Plugin.Players
{
    /// <summary>Result of resolving a command argument to a player.</summary>
    internal sealed class PlayerLookupResult
    {
        private PlayerLookupResult(Player? online, PlayerRef? playerRef, string? error)
        {
            Online = online;
            PlayerRef = playerRef;
            Error = error;
        }

        /// <summary>The online player, when one matched.</summary>
        public Player? Online { get; }

        /// <summary>Trust-network reference (also set for an offline canonical user id).</summary>
        public PlayerRef? PlayerRef { get; }

        public string? Error { get; }

        public bool Succeeded => PlayerRef != null;

        public static PlayerLookupResult Found(Player player, PlayerRef playerRef) => new PlayerLookupResult(player, playerRef, null);

        public static PlayerLookupResult Offline(PlayerRef playerRef) => new PlayerLookupResult(null, playerRef, null);

        public static PlayerLookupResult Failed(string error) => new PlayerLookupResult(null, null, error);
    }

    /// <summary>
    /// Resolves <c>&lt;player&gt;</c> command arguments: numeric player id, canonical user id
    /// (<c>7656…@steam</c>, may be offline) or a nickname prefix (must be unambiguous). Main thread only.
    /// </summary>
    internal static class PlayerLookup
    {
        public static PlayerLookupResult Resolve(string? input)
        {
            var text = (input ?? string.Empty).Trim();
            if (text.Length == 0)
            {
                return PlayerLookupResult.Failed("Specify a player id, a user id (e.g. 76561198000000001@steam) or a nickname.");
            }

            if (int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var playerId))
            {
                return Player.TryGet(playerId, out var byId) && PlayerIdentity.TryGetPlayerRef(byId, out var byIdRef)
                    ? PlayerLookupResult.Found(byId, byIdRef)
                    : PlayerLookupResult.Failed("No trust-checkable player with id " + playerId + " is online.");
            }

            if (text.IndexOf('@') >= 0)
            {
                if (!PlayerRef.TryParseUserId(text, out var parsed))
                {
                    return PlayerLookupResult.Failed("'" + text + "' is not a valid user id (expected <id>@steam, <id>@discord or <name>@northwood).");
                }

                return Player.TryGet(parsed.ToUserId(), out var byUserId) && !byUserId.IsDestroyed
                    ? PlayerLookupResult.Found(byUserId, parsed)
                    : PlayerLookupResult.Offline(parsed);
            }

            var matches = new List<Player>();
            Player? exact = null;
            foreach (var candidate in Player.ReadyList)
            {
                if (!PlayerIdentity.TryGetPlayerRef(candidate, out _))
                {
                    continue;
                }

                var nickname = candidate.Nickname ?? string.Empty;
                if (nickname.Equals(text, StringComparison.OrdinalIgnoreCase))
                {
                    exact = candidate;
                    break;
                }

                if (nickname.StartsWith(text, StringComparison.OrdinalIgnoreCase))
                {
                    matches.Add(candidate);
                }
            }

            var match = exact ?? (matches.Count == 1 ? matches[0] : null);
            if (match == null)
            {
                return matches.Count > 1
                    ? PlayerLookupResult.Failed("'" + text + "' matches " + matches.Count + " players; use the player id or the full nickname.")
                    : PlayerLookupResult.Failed("No online player matches '" + text + "'.");
            }

            return PlayerIdentity.TryGetPlayerRef(match, out var matchRef)
                ? PlayerLookupResult.Found(match, matchRef)
                : PlayerLookupResult.Failed("That player has no supported user id.");
        }
    }
}
