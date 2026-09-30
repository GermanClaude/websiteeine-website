using System;
using System.Globalization;
using CommandSystem;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary>
    /// Client console command <c>.trustlink &lt;code&gt;</c> — links the player's in-game identity to a web
    /// account (§6.6). Attempts are rate limited per player so codes cannot be brute-forced.
    /// </summary>
    [CommandHandler(typeof(ClientCommandHandler))]
    public sealed class TrustLinkCommand : ICommand, IUsageProvider
    {
        public string Command => "trustlink";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Links your in-game identity to your trust network web account using the code from your profile page.";

        public string[] Usage => new[] { "<LNK-XXXXXX>" };

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out var backend, out response)
                || !CommandSupport.RequirePlayer(sender, out _, out var playerRef, out response))
            {
                return false;
            }

            if (runtime.Identities.Current == null)
            {
                response = "This server is not connected to the trust network yet; ask the server staff.";
                return false;
            }

            if (!LinkCodes.TryNormalize(CommandSupport.Arg(arguments, 0), out var code))
            {
                response = "Usage: .trustlink LNK-XXXXXX — get the code from your profile in the trust network web panel (valid 10 minutes).";
                return false;
            }

            if (!backend.LinkAttempts.TryAcquire(playerRef.ToUserId(), out var retryAfter))
            {
                response = "Too many link attempts; try again in " + Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture) + " s.";
                return false;
            }

            response = CommandSupport.RunAsync(runtime, sender, "Checking your link code …", async cancellationToken =>
            {
                try
                {
                    var result = await backend.Client.LinkPlayerAsync(new PlayerLinkRequest { Player = playerRef, Code = code }, cancellationToken).ConfigureAwait(false);
                    runtime.Logger.Info("Player " + playerRef + " linked a web account.");
                    return "Done: " + playerRef.ToUserId() + " is now linked to the web account '" + CommandSupport.Escape(result.Username) + "'.";
                }
                catch (TrustApiException ex) when (ex.Code == ApiErrorCodes.LinkCodeInvalid || ex.Code == ApiErrorCodes.NotFound || ex.Code == ApiErrorCodes.ValidationFailed)
                {
                    throw new InvalidOperationException("The link code is invalid or expired. Generate a new one in the web panel and try again.");
                }
                catch (TrustApiException ex) when (ex.Code == ApiErrorCodes.PlayerAlreadyLinked || ex.Code == ApiErrorCodes.Conflict)
                {
                    throw new InvalidOperationException("This in-game identity is already linked to another web account.");
                }
                catch (TrustApiException ex) when (ex.IsTransient)
                {
                    throw new InvalidOperationException("The trust network is currently unreachable; try again in a minute.");
                }
            });
            return true;
        }
    }
}
