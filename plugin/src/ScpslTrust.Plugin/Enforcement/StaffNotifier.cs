using System;
using System.Collections.Generic;
using LabApi.Features.Wrappers;
using MEC;
using RemoteAdmin;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Config;
using ScpslTrust.Plugin.Players;

namespace ScpslTrust.Plugin.Enforcement
{
    /// <summary>
    /// Notifies online staff (players with Remote Admin access) via hint and/or RA console (§7.3).
    /// Persistent notices (require_review) are kept for the round and re-sent to staff who join later.
    /// Main thread only.
    /// </summary>
    internal sealed class StaffNotifier
    {
        private const int MaxPending = 50;
        private const float HintSeconds = 10f;
        private const float JoinDelaySeconds = 6f;
        private const string Prefix = "[Trust] ";

        private readonly TrustSettings _settings;
        private readonly ITrustLogger _logger;
        private readonly List<string> _pending = new List<string>();

        public StaffNotifier(TrustSettings settings, ITrustLogger logger)
        {
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public int PendingCount => _pending.Count;

        /// <summary>Sends <paramref name="text"/> to every online staff member.</summary>
        public void Notify(string text, bool persistent = false)
        {
            if (persistent)
            {
                if (_pending.Count >= MaxPending)
                {
                    _pending.RemoveAt(0);
                }

                _pending.Add(text);
            }

            if (!_settings.StaffNotificationsEnabled)
            {
                return;
            }

            foreach (var staff in Player.ReadyList)
            {
                if (PermissionChecker.IsStaff(staff))
                {
                    Send(staff, text);
                }
            }
        }

        /// <summary>Re-sends persistent notices to a staff member who joined after they were raised.</summary>
        public void OnPlayerJoined(Player player)
        {
            if (_pending.Count == 0 || !_settings.StaffNotificationsEnabled || !PermissionChecker.IsStaff(player))
            {
                return;
            }

            var userId = player.UserId;
            var playerId = player.PlayerId;
            Timing.CallDelayed(JoinDelaySeconds, () =>
            {
                var target = PlayerIdentity.FindOnline(userId, playerId);
                if (target == null || !PermissionChecker.IsStaff(target))
                {
                    return;
                }

                foreach (var notice in _pending.ToArray())
                {
                    Send(target, "(pending) " + notice);
                }
            });
        }

        /// <summary>Forgets persistent notices (new round).</summary>
        public void ClearPending() => _pending.Clear();

        private void Send(Player staff, string text)
        {
            try
            {
                if (_settings.StaffNotificationsUseHints)
                {
                    staff.SendHint("<size=24><b>" + Prefix + "</b>" + text + "</size>", HintSeconds);
                }

                if (_settings.StaffNotificationsUseConsole)
                {
                    new PlayerCommandSender(staff.ReferenceHub).RaReply(Prefix + text, true, true, string.Empty);
                }
            }
            catch (Exception ex)
            {
                _logger.Debug("Could not notify " + PlayerIdentity.Describe(staff) + ": " + ex.GetType().Name);
            }
        }
    }
}
