using System;
using CommandSystem;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust register &lt;token&gt; [--force]</c> — §5.2. Server console only: the token must not appear in Remote Admin logs.</summary>
    internal sealed class RegisterSubcommand : ICommand, IUsageProvider
    {
        public string Command => "register";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Registers this server with the trust network using a one-time token from the web panel.";

        public string[] Usage => new[] { "<sreg_token>", "[--force]" };

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out _, out response))
            {
                return false;
            }

            if (!CommandSupport.IsServerConsole(sender))
            {
                response = "For security, run 'trust register' from the server console (LocalAdmin), not from Remote Admin.";
                return false;
            }

            var token = CommandSupport.Arg(arguments, 0).Trim();
            var force = CommandSupport.HasFlag(arguments, "--force");
            if (!RegistrationTokens.IsValid(token))
            {
                response = "Usage: trust register <sreg_token> [--force] — the token is 'sreg_' followed by 43 characters and is shown once when the server is created in the web panel.";
                return false;
            }

            if (runtime.Identities.Current != null && !force)
            {
                response = "This server is already registered as " + runtime.Identities.Current.ServerId + ". Add --force to replace its identity with a new key (the old key stops working).";
                return false;
            }

            response = CommandSupport.RunAsync(runtime, sender, "Registering with " + runtime.Settings.ApiBaseUri + " …", async cancellationToken =>
            {
                var result = await runtime.RegisterAsync(token, force, cancellationToken).ConfigureAwait(false);
                return "Registered as " + result.ServerId + " with key " + result.KeyFingerprint + " (status " + result.Status + ").\n"
                    + "The private key is stored in " + runtime.ConfigDirectory + "/" + KeyStore.IdentityFileName + " — keep it private and back it up. "
                    + "Remove registration_token from config.yml if you had set it there.";
            });
            return true;
        }
    }
}
