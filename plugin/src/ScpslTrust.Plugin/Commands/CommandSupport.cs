using System;
using System.Threading;
using System.Threading.Tasks;
using CommandSystem;
using LabApi.Features.Wrappers;
using RemoteAdmin;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Text;
using ScpslTrust.Plugin.Players;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary>Shared plumbing for the plugin's commands (runtime access, permissions, async replies).</summary>
    internal static class CommandSupport
    {
        public static bool TryGetRuntime(out TrustRuntime runtime, out string response)
        {
            var current = TrustPlugin.Runtime;
            if (current == null || current.IsStopping)
            {
                runtime = null!;
                response = "ScpslTrust is not enabled.";
                return false;
            }

            runtime = current;
            response = string.Empty;
            return true;
        }

        public static bool TryGetBackend(out TrustRuntime runtime, out BackendServices backend, out string response)
        {
            backend = null!;
            if (!TryGetRuntime(out runtime, out response))
            {
                return false;
            }

            if (runtime.Backend == null)
            {
                response = "api_base_url is not configured (" + (runtime.Settings.ApiBaseUriError ?? "missing") + "); fix config.yml and restart the server.";
                return false;
            }

            backend = runtime.Backend;
            return true;
        }

        public static bool IsServerConsole(ICommandSender sender) => !(sender is PlayerCommandSender);

        /// <summary>Non-player senders always pass; players need the configured permission.</summary>
        public static bool RequirePermission(ICommandSender sender, string requirement, out string response)
        {
            if (PermissionChecker.HasPermission(sender, requirement))
            {
                response = string.Empty;
                return true;
            }

            response = "You need the '" + requirement + "' permission for this command.";
            return false;
        }

        /// <summary>The sender must be an in-game player with a supported user id.</summary>
        public static bool RequirePlayer(ICommandSender sender, out Player player, out PlayerRef playerRef, out string response)
        {
            player = null!;
            playerRef = null!;
            var resolved = Player.Get(sender);
            if (resolved == null)
            {
                response = "This command can only be used by a player.";
                return false;
            }

            if (!PlayerIdentity.TryGetPlayerRef(resolved, out var resolvedRef))
            {
                response = "Your user id is not supported by the trust network (steam, discord or northwood ids only).";
                return false;
            }

            player = resolved;
            playerRef = resolvedRef;
            response = string.Empty;
            return true;
        }

        public static string Arg(ArraySegment<string> arguments, int index)
        {
            if (arguments.Array == null || index < 0 || index >= arguments.Count)
            {
                return string.Empty;
            }

            return arguments.Array[arguments.Offset + index] ?? string.Empty;
        }

        public static bool HasFlag(ArraySegment<string> arguments, string flag)
        {
            for (var i = 0; i < arguments.Count; i++)
            {
                if (string.Equals(Arg(arguments, i), flag, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Starts <paramref name="work"/> on the thread pool and delivers its result to the sender from the
        /// main thread when it completes. Returns the immediate response ("working…").
        /// </summary>
        public static string RunAsync(TrustRuntime runtime, ICommandSender sender, string pendingResponse, Func<CancellationToken, Task<string>> work)
        {
            runtime.RunBackground("command", async cancellationToken =>
            {
                string text;
                bool success;
                try
                {
                    text = await work(cancellationToken).ConfigureAwait(false);
                    success = true;
                }
                catch (Exception ex)
                {
                    text = DescribeError(ex);
                    success = false;
                }

                runtime.Dispatcher.Post(() => Respond(sender, text, success));
            });

            return pendingResponse;
        }

        /// <summary>Operator-facing description of a failure (never contains secrets).</summary>
        public static string DescribeError(Exception ex)
        {
            switch (ex)
            {
                case TrustApiException api:
                    return api.Describe() + ": " + api.Message + HeartbeatService.Hint(api);
                case KeyStoreException _:
                case ArgumentException _:
                case InvalidOperationException _:
                    return ex.Message;
                case OperationCanceledException _:
                    return "Cancelled (the plugin is being disabled).";
                default:
                    return ex.GetType().Name + ": " + ex.Message;
            }
        }

        public static string Escape(string? value) => TextSanitizer.EscapeRichText(TextSanitizer.CleanLine(value, 64));

        private static void Respond(ICommandSender sender, string text, bool success)
        {
            try
            {
                sender.Respond(text, success);
            }
            catch (Exception)
            {
                // The sender may have disconnected meanwhile.
            }
        }
    }
}
