using System;
using LabApi.Events.Arguments.ServerEvents;
using LabApi.Events.Handlers;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Config;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin.Events
{
    /// <summary>Round lifecycle: end proof sessions, forget pending staff notices, refresh the policy.</summary>
    internal sealed class ServerEventHandlers
    {
        private readonly TrustRuntime _runtime;

        public ServerEventHandlers(TrustRuntime runtime)
        {
            _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
        }

        public void Register()
        {
            ServerEvents.RoundEnded += OnRoundEnded;
            ServerEvents.WaitingForPlayers += OnWaitingForPlayers;
        }

        public void Unregister()
        {
            ServerEvents.RoundEnded -= OnRoundEnded;
            ServerEvents.WaitingForPlayers -= OnWaitingForPlayers;
        }

        private void OnRoundEnded(RoundEndedEventArgs ev) => EndSessions();

        private void OnWaitingForPlayers()
        {
            _runtime.Staff.ClearPending();
            EndSessions();

            var backend = _runtime.Backend;
            if (backend != null && _runtime.Settings.PolicySource == PolicySourceKind.Remote && _runtime.Identities.Current != null)
            {
                _runtime.RunBackground("policy refresh", async cancellationToken =>
                {
                    await backend.Policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
                });
            }
        }

        private void EndSessions()
        {
            var backend = _runtime.Backend;
            if (backend == null)
            {
                return;
            }

            _runtime.RunBackground("end proof sessions", cancellationToken => backend.Sessions.EndAllAsync(OverwatchEndReason.RoundEnded, cancellationToken));
        }
    }
}
