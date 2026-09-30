using System;
using System.Globalization;
using LabApi.Events.Arguments.PlayerEvents;
using LabApi.Events.Handlers;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Proof;
using ScpslTrust.Plugin.Players;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin.Events
{
    /// <summary>
    /// Overwatch proof sessions (§10.1): spectator changes declare the desired session state to the
    /// <see cref="OverwatchSessionManager"/>; a one-second tick reconciles it with the game (Overwatch
    /// mode left, target no longer spectated, players gone) and draws the proof overlay (§10.2).
    /// </summary>
    internal sealed class OverwatchHandlers
    {
        private const float OverlaySeconds = 1.2f;
        private const float FeedbackSeconds = 5f;

        private readonly TrustRuntime _runtime;
        private readonly OverwatchSessionManager _sessions;

        public OverwatchHandlers(TrustRuntime runtime, OverwatchSessionManager sessions)
        {
            _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
            _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        }

        public void Register()
        {
            PlayerEvents.ChangedSpectator += OnChangedSpectator;
            _sessions.SessionEvent += OnSessionEvent;
        }

        public void Unregister()
        {
            PlayerEvents.ChangedSpectator -= OnChangedSpectator;
            _sessions.SessionEvent -= OnSessionEvent;
        }

        /// <summary>Main thread, once per second.</summary>
        public void Tick()
        {
            Reconcile();
            ShowOverlay();
        }

        private void OnChangedSpectator(PlayerChangedSpectatorEventArgs ev)
        {
            var settings = _runtime.Settings;
            if (!settings.OverwatchProofEnabled || !settings.OverwatchAutoStartOnSpectate)
            {
                return;
            }

            try
            {
                var spectator = ev.Player;
                if (!PlayerIdentity.TryGetPlayerRef(spectator, out var spectatorRef)
                    || !PermissionChecker.HasPermission(spectator, settings.OverwatchRequiredPermission))
                {
                    return;
                }

                if (settings.OverwatchOnlyInOverwatch && !spectator.IsOverwatchEnabled)
                {
                    _sessions.SetAutoTarget(spectatorRef, null, OverwatchEndReason.OverwatchDisabled);
                    return;
                }

                var target = ev.NewTarget;
                if (target == null || !PlayerIdentity.TryGetPlayerRef(target, out var targetRef) || targetRef.Equals(spectatorRef))
                {
                    _sessions.SetAutoTarget(spectatorRef, null, OverwatchEndReason.TargetChanged);
                    return;
                }

                _sessions.SetAutoTarget(spectatorRef, targetRef, OverwatchEndReason.TargetChanged);
            }
            catch (Exception ex)
            {
                _runtime.Logger.Error("Spectator handler failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        private void Reconcile()
        {
            var settings = _runtime.Settings;
            foreach (var session in _sessions.GetSessions())
            {
                var spectator = Online(session.Spectator);
                if (spectator == null)
                {
                    _sessions.HandlePlayerLeft(session.Spectator);
                    continue;
                }

                var target = Online(session.Target);
                if (target == null)
                {
                    _sessions.HandlePlayerLeft(session.Target);
                    continue;
                }

                if (session.Manual)
                {
                    continue;
                }

                if (settings.OverwatchOnlyInOverwatch && !spectator.IsOverwatchEnabled)
                {
                    _sessions.SetAutoTarget(session.Spectator, null, OverwatchEndReason.OverwatchDisabled);
                }
                else if (!IsSpectating(spectator, target))
                {
                    _sessions.SetAutoTarget(session.Spectator, null, OverwatchEndReason.TargetChanged);
                }
            }
        }

        private void ShowOverlay()
        {
            foreach (var line in _sessions.GetOverlayLines())
            {
                var spectator = Online(line.Spectator);
                if (spectator == null)
                {
                    continue;
                }

                try
                {
                    spectator.SendHint(OverlayMarkup(line.Text), OverlaySeconds);
                }
                catch (Exception ex)
                {
                    _runtime.Logger.Debug("Proof overlay for " + line.Spectator + " failed: " + ex.GetType().Name);
                }
            }
        }

        private void OnSessionEvent(OverwatchSessionEvent sessionEvent)
        {
            // Raised on a background thread.
            _runtime.Dispatcher.Post(() =>
            {
                var spectator = Online(sessionEvent.Spectator);
                if (spectator == null)
                {
                    return;
                }

                string text;
                switch (sessionEvent.Kind)
                {
                    case OverwatchSessionEventKind.Started:
                        text = "Proof session #" + ShortId(sessionEvent.SessionId) + " started for " + sessionEvent.Target.ToUserId() + ". Keep the code visible in your recording.";
                        break;
                    case OverwatchSessionEventKind.Ended:
                        text = "Proof session #" + ShortId(sessionEvent.SessionId) + " ended (" + (sessionEvent.Reason?.ToString().ToLowerInvariant() ?? "unknown") + ").";
                        break;
                    case OverwatchSessionEventKind.StartFailed:
                        text = "Proof session could not be started: " + (sessionEvent.Error ?? "unknown error") + ". Retrying shortly.";
                        break;
                    case OverwatchSessionEventKind.Lost:
                        text = "Proof session #" + ShortId(sessionEvent.SessionId) + " is no longer active on the backend; a new one starts if you keep spectating.";
                        break;
                    default:
                        return;
                }

                try
                {
                    spectator.SendConsoleMessage("[Trust] " + text, sessionEvent.Kind == OverwatchSessionEventKind.StartFailed ? "red" : "green");
                    if (sessionEvent.Kind != OverwatchSessionEventKind.Started)
                    {
                        spectator.SendHint("<size=22>[Trust] " + text + "</size>", FeedbackSeconds);
                    }
                }
                catch (Exception ex)
                {
                    _runtime.Logger.Debug("Session feedback for " + sessionEvent.Spectator + " failed: " + ex.GetType().Name);
                }
            });
        }

        private string OverlayMarkup(string text)
        {
            var body = "<size=26><b>" + text + "</b></size>";
            var offset = _runtime.Settings.OverwatchHintVerticalOffset;
            if (Math.Abs(offset) < 0.01f)
            {
                return body;
            }

            return "<voffset=" + offset.ToString("0.##", CultureInfo.InvariantCulture) + "em>" + body + "</voffset>";
        }

        private static bool IsSpectating(Player spectator, Player target)
        {
            try
            {
                return target.CurrentSpectators.Contains(spectator);
            }
            catch (Exception)
            {
                // Do not end sessions because of a transient wrapper failure.
                return true;
            }
        }

        private static Player? Online(PlayerRef playerRef)
        {
            return Player.TryGet(playerRef.ToUserId(), out var player) && !player.IsDestroyed ? player : null;
        }

        private static string ShortId(Guid? sessionId) => sessionId.HasValue ? sessionId.Value.ToString("N").Substring(0, 8) : "?";
    }
}
