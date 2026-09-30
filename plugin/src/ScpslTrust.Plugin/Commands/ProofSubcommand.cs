using System;
using System.Collections.Generic;
using CommandSystem;
using ScpslTrust.Plugin.Enforcement;
using ScpslTrust.Plugin.Players;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust proof start &lt;player&gt; | stop | list</c> — manual Overwatch proof sessions (§10.1).</summary>
    internal sealed class ProofSubcommand : ICommand, IUsageProvider
    {
        public string Command => "proof";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Starts or stops an Overwatch proof session for your recording, or lists active sessions.";

        public string[] Usage => new[] { "start <player> | stop | list" };

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out var backend, out response))
            {
                return false;
            }

            if (!runtime.Settings.OverwatchProofEnabled)
            {
                response = "Overwatch proof sessions are disabled (overwatch_proof.enabled: false).";
                return false;
            }

            switch (CommandSupport.Arg(arguments, 0).ToLowerInvariant())
            {
                case "list":
                    if (!CommandSupport.RequirePermission(sender, runtime.Settings.StaffCommandPermission, out response))
                    {
                        return false;
                    }

                    var sessions = backend.Sessions.GetSessions();
                    if (sessions.Count == 0)
                    {
                        response = "No active proof sessions.";
                        return true;
                    }

                    var lines = new List<string>(sessions.Count + 1) { sessions.Count + " active proof session(s):" };
                    foreach (var session in sessions)
                    {
                        lines.Add("  #" + session.SessionId.ToString("N").Substring(0, 8) + " " + session.Spectator + " → " + session.Target + (session.Manual ? " (manual)" : string.Empty) + ", since " + DecisionFormatter.Timestamp(session.StartedAt));
                    }

                    response = string.Join("\n", lines);
                    return true;

                case "start":
                    if (!CommandSupport.RequirePlayer(sender, out var spectator, out var spectatorRef, out response)
                        || !CommandSupport.RequirePermission(sender, runtime.Settings.OverwatchRequiredPermission, out response))
                    {
                        return false;
                    }

                    if (runtime.Identities.Current == null)
                    {
                        response = "This server is not registered with the trust network; proof sessions are unavailable.";
                        return false;
                    }

                    var lookup = PlayerLookup.Resolve(string.Join(" ", arguments).Substring("start".Length));
                    if (!lookup.Succeeded || lookup.Online == null)
                    {
                        response = lookup.Error ?? "The target must be online.";
                        return false;
                    }

                    if (lookup.PlayerRef!.Equals(spectatorRef))
                    {
                        response = "You cannot record a proof session of yourself.";
                        return false;
                    }

                    backend.Sessions.StartManual(spectatorRef, lookup.PlayerRef);
                    response = "Starting a proof session for " + PlayerIdentity.Describe(lookup.Online) + "; the proof code appears on your screen within a few seconds. Use 'trust proof stop' to end it.";
                    return true;

                case "stop":
                    if (!CommandSupport.RequirePlayer(sender, out _, out var stopperRef, out response)
                        || !CommandSupport.RequirePermission(sender, runtime.Settings.OverwatchRequiredPermission, out response))
                    {
                        return false;
                    }

                    response = backend.Sessions.StopManual(stopperRef)
                        ? "Stopping your proof session. Automatic recording resumes when you spectate a different player."
                        : "You have no active proof session.";
                    return true;

                default:
                    response = "Usage: trust proof start <player> | stop | list";
                    return false;
            }
        }
    }
}
