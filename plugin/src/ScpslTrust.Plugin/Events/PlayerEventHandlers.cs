using System;
using LabApi.Events.Arguments.PlayerEvents;
using LabApi.Events.Handlers;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Services;
using ScpslTrust.Plugin.Players;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin.Events
{
    /// <summary>
    /// Joined → asynchronous trust check → policy decision → enforcement on the main thread (§7.3).
    /// Left → Overwatch sessions involving the player are ended.
    /// </summary>
    internal sealed class PlayerEventHandlers
    {
        private readonly TrustRuntime _runtime;

        public PlayerEventHandlers(TrustRuntime runtime)
        {
            _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
        }

        public void Register()
        {
            PlayerEvents.Joined += OnJoined;
            PlayerEvents.Left += OnLeft;
        }

        public void Unregister()
        {
            PlayerEvents.Joined -= OnJoined;
            PlayerEvents.Left -= OnLeft;
        }

        private void OnJoined(PlayerJoinedEventArgs ev)
        {
            try
            {
                var player = ev.Player;
                _runtime.Staff.OnPlayerJoined(player);

                if (!PlayerIdentity.TryGetPlayerRef(player, out var playerRef))
                {
                    _runtime.Logger.Debug("Skipping trust check for " + PlayerIdentity.Describe(player) + " (host, dummy, NPC or unsupported user id).");
                    return;
                }

                var backend = _runtime.Backend;
                if (backend == null || !_runtime.Settings.CheckOnJoin)
                {
                    return;
                }

                // Everything the background check needs is captured here, on the main thread.
                var context = new PlayerCheckContext(
                    playerRef,
                    PlayerIdentity.NicknameOf(player),
                    _runtime.Settings.SendIpForVpnCheck ? PlayerIdentity.IpAddressOf(player) : null,
                    accountCreatedHint: null,
                    _runtime.Game.ServerName);
                var userId = player.UserId;
                var playerId = player.PlayerId;

                _runtime.RunBackground("trust check " + playerRef, async cancellationToken =>
                {
                    var outcome = await backend.Checks.CheckAsync(context, cancellationToken).ConfigureAwait(false);
                    _runtime.Dispatcher.Post(() => _runtime.Enforcer.Apply(outcome, PlayerIdentity.FindOnline(userId, playerId)));
                });
            }
            catch (Exception ex)
            {
                _runtime.Logger.Error("Join handler failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        private void OnLeft(PlayerLeftEventArgs ev)
        {
            var backend = _runtime.Backend;
            if (backend == null)
            {
                return;
            }

            try
            {
                // The hub is being destroyed; only its user id is needed.
                if (PlayerRef.TryParseUserId(ev.Player?.UserId, out var playerRef))
                {
                    backend.Sessions.HandlePlayerLeft(playerRef);
                }
            }
            catch (Exception ex)
            {
                _runtime.Logger.Debug("Left handler: " + ex.GetType().Name);
            }
        }
    }
}
