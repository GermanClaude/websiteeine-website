using System;
using CommandSystem;
using ScpslTrust.Core.Services;
using ScpslTrust.Plugin.Enforcement;
using ScpslTrust.Plugin.Players;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust check &lt;player&gt;</c> — information and the policy decision, without enforcing anything.</summary>
    internal sealed class CheckSubcommand : ICommand, IUsageProvider
    {
        public string Command => "check";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Shows trust-network information about a player and what the policy would decide (no action is taken).";

        public string[] Usage => new[] { "<player id | user id | nickname>" };

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out var backend, out response)
                || !CommandSupport.RequirePermission(sender, runtime.Settings.StaffCommandPermission, out response))
            {
                return false;
            }

            if (runtime.Identities.Current == null)
            {
                response = "This server is not registered; run 'trust register <token>' first.";
                return false;
            }

            var lookup = PlayerLookup.Resolve(string.Join(" ", arguments));
            if (!lookup.Succeeded)
            {
                response = lookup.Error ?? "Player not found.";
                return false;
            }

            var playerRef = lookup.PlayerRef!;
            var online = lookup.Online;
            var who = online != null ? PlayerIdentity.Describe(online) : playerRef.ToUserId() + " (offline)";
            var context = new PlayerCheckContext(
                playerRef,
                online != null ? PlayerIdentity.NicknameOf(online) : null,
                online != null && runtime.Settings.SendIpForVpnCheck ? PlayerIdentity.IpAddressOf(online) : null,
                accountCreatedHint: null,
                runtime.Game.ServerName);

            response = CommandSupport.RunAsync(runtime, sender, "Checking " + who + " …", async cancellationToken =>
            {
                var outcome = await backend.Checks.CheckAsync(context, cancellationToken).ConfigureAwait(false);
                return DecisionFormatter.Report(outcome, who);
            });
            return true;
        }
    }
}
