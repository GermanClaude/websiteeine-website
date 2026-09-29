using System;
using CommandSystem;
using LabApi.Features.Permissions;
using LabApi.Features.Wrappers;
using RemoteAdmin;

namespace ScpslTrust.Plugin.Players
{
    /// <summary>
    /// Evaluates configurable permission requirements: <c>RemoteAdminAccess</c>, a game
    /// <see cref="PlayerPermissions"/> flag name (e.g. <c>Overwatch</c>) or a LabAPI permission node
    /// (e.g. <c>scpsl_trust.proof</c>). Non-player senders (server console) always pass.
    /// </summary>
    internal static class PermissionChecker
    {
        public const string RemoteAdminAccessName = "RemoteAdminAccess";

        public static bool HasPermission(Player player, string requirement)
        {
            if (player == null)
            {
                throw new ArgumentNullException(nameof(player));
            }

            var name = (requirement ?? string.Empty).Trim();
            if (name.Length == 0 || string.Equals(name, RemoteAdminAccessName, StringComparison.OrdinalIgnoreCase))
            {
                return player.RemoteAdminAccess;
            }

            if (TryParseFlag(name, out var flag))
            {
                return player.HasPermission(flag);
            }

            return PermissionsManager.HasPermission(player, name);
        }

        public static bool HasPermission(ICommandSender sender, string requirement)
        {
            if (!(sender is PlayerCommandSender))
            {
                return true;
            }

            var player = Player.Get(sender);
            return player != null && HasPermission(player, requirement);
        }

        /// <summary>Online staff = players with Remote Admin access.</summary>
        public static bool IsStaff(Player player)
        {
            try
            {
                return !player.IsDestroyed && !player.IsHost && !player.IsDummy && player.IsPlayer && player.RemoteAdminAccess;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static bool TryParseFlag(string name, out PlayerPermissions flag)
        {
            flag = 0;
            // Enum.TryParse also accepts numbers; only names are meaningful in a config file.
            if (name.Length == 0 || char.IsDigit(name[0]) || name[0] == '-')
            {
                return false;
            }

            return Enum.TryParse(name, ignoreCase: true, out flag) && flag != 0;
        }
    }
}
