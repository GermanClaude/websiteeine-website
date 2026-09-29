using System;
using System.Diagnostics.CodeAnalysis;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Plugin.Players
{
    /// <summary>Maps LabAPI players to trust-network player references. Main thread only.</summary>
    internal static class PlayerIdentity
    {
        /// <summary>
        /// False for the host/server player, dummies, NPCs, players without a finished
        /// authentication and user ids of unsupported types (e.g. offline-mode ids).
        /// </summary>
        public static bool TryGetPlayerRef(Player? player, [NotNullWhen(true)] out PlayerRef? playerRef)
        {
            playerRef = null;
            if (player == null)
            {
                return false;
            }

            try
            {
                if (player.IsDestroyed || player.IsHost || player.IsDummy || player.IsNpc || !player.IsPlayer)
                {
                    return false;
                }

                return PlayerRef.TryParseUserId(player.UserId, out playerRef);
            }
            catch (Exception)
            {
                // A hub being torn down can throw from any wrapper property.
                return false;
            }
        }

        /// <summary>Log/console-safe label: sanitized nickname plus canonical user id.</summary>
        public static string Describe(Player? player)
        {
            if (player == null)
            {
                return "unknown player";
            }

            string nickname;
            string userId;
            try
            {
                nickname = TextSanitizer.CleanLine(TextSanitizer.StripRichText(player.Nickname), 32);
                userId = player.UserId ?? string.Empty;
            }
            catch (Exception)
            {
                return "unknown player";
            }

            var label = nickname.Length == 0 ? "(no nickname)" : TextSanitizer.EscapeRichText(nickname);
            return userId.Length == 0 ? label : label + " (" + userId + ")";
        }

        /// <summary>Nickname as sent to the backend (rich text stripped, at most 64 characters), or null.</summary>
        public static string? NicknameOf(Player player)
        {
            try
            {
                return TextSanitizer.ToNickname(TextSanitizer.StripRichText(player.Nickname));
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Raw connection address for the VPN check (never logged), or null when unavailable.</summary>
        public static string? IpAddressOf(Player player)
        {
            try
            {
                return player.IpAddress;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>Finds an online player by user id; null when the player left or a different connection now uses the id.</summary>
        public static Player? FindOnline(string userId, int playerId)
        {
            if (!Player.TryGet(userId, out var player) || player.IsDestroyed || player.PlayerId != playerId)
            {
                return null;
            }

            return player;
        }
    }
}
