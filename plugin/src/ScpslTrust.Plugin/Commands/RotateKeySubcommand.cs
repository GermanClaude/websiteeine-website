using System;
using CommandSystem;
using ScpslTrust.Core.Api;
using ScpslTrust.Plugin.Enforcement;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust rotatekey</c> — §5.5 key rotation.</summary>
    internal sealed class RotateKeySubcommand : ICommand
    {
        public string Command => "rotatekey";

        public string[] Aliases => new[] { "rotate" };

        public string Description => "Generates a new signing key and announces it to the trust network; the old key stays valid during the grace period.";

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out _, out response)
                || !CommandSupport.RequirePermission(sender, runtime.Settings.AdminCommandPermission, out response))
            {
                return false;
            }

            if (runtime.Identities.Current == null)
            {
                response = "This server is not registered; nothing to rotate.";
                return false;
            }

            response = CommandSupport.RunAsync(runtime, sender, "Rotating the signing key …", async cancellationToken =>
            {
                var result = await runtime.RotateKeyAsync(cancellationToken).ConfigureAwait(false);
                var text = (result.Recovered ? "Completed an earlier, interrupted rotation: " : "Key rotated: ") + result.PreviousFingerprint + " → " + result.NewFingerprint + ".";
                if (result.PreviousKeyRetiringUntil != null)
                {
                    text += " The previous key is accepted until " + DecisionFormatter.Timestamp(result.PreviousKeyRetiringUntil.Value) + ".";
                }

                return text;
            });
            return true;
        }
    }
}
