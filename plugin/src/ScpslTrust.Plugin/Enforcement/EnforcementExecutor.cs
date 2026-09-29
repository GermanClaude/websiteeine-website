using System;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Config;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Text;
using ScpslTrust.Plugin.Players;

namespace ScpslTrust.Plugin.Enforcement
{
    /// <summary>
    /// Applies a local policy decision to a player (ARCHITECTURE §7.3). The backend only supplied
    /// information; this is the only place where kicks and bans happen. Main thread only.
    /// </summary>
    internal sealed class EnforcementExecutor
    {
        /// <summary>Duration used for "permanent" bans (the game kicks instead of banning for 0 seconds).</summary>
        public const long PermanentBanSeconds = 100L * 365L * 24L * 3600L;

        private const int MaxPlayerMessageLength = 400;
        private const ushort BroadcastSeconds = 12;

        private readonly TrustSettings _settings;
        private readonly StaffNotifier _staff;
        private readonly ITrustLogger _logger;

        public EnforcementExecutor(TrustSettings settings, StaffNotifier staff, ITrustLogger logger)
        {
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _staff = staff ?? throw new ArgumentNullException(nameof(staff));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        /// <summary>Ban length in seconds for the game API, honoring <c>max_ban_duration_minutes</c>.</summary>
        public static long ToBanSeconds(int? banDurationMinutes, int maxBanDurationMinutes)
        {
            var minutes = banDurationMinutes.GetValueOrDefault();
            if (minutes <= 0)
            {
                // Permanent, capped to the configured maximum when one is set.
                return maxBanDurationMinutes > 0 ? maxBanDurationMinutes * 60L : PermanentBanSeconds;
            }

            if (maxBanDurationMinutes > 0 && minutes > maxBanDurationMinutes)
            {
                minutes = maxBanDurationMinutes;
            }

            return minutes * 60L;
        }

        /// <param name="player">The player if still online, otherwise null (only notifications happen).</param>
        public void Apply(PlayerCheckOutcome outcome, Player? player)
        {
            if (outcome == null)
            {
                throw new ArgumentNullException(nameof(outcome));
            }

            var who = player != null ? PlayerIdentity.Describe(player) : outcome.Player.ToUserId() + " (left)";
            var decision = outcome.Decision;
            var line = DecisionFormatter.StaffLine(outcome, who);
            var message = PlayerMessage(decision);

            switch (decision.Action)
            {
                case PolicyAction.Allow:
                    _logger.Debug(line);
                    return;

                case PolicyAction.AdminNotify:
                    _logger.Info(line);
                    _staff.Notify(line);
                    return;

                case PolicyAction.RequireReview:
                    _logger.Info(line);
                    _staff.Notify("REVIEW REQUIRED — " + line, persistent: true);
                    return;

                case PolicyAction.Warn:
                    _logger.Info(line);
                    if (player != null)
                    {
                        Warn(player, message);
                    }

                    break;

                case PolicyAction.RequireWhitelist:
                case PolicyAction.Kick:
                    _logger.Warn(line);
                    if (player != null)
                    {
                        Kick(player, message);
                    }

                    break;

                case PolicyAction.Ban:
                    _logger.Warn(line);
                    if (player != null)
                    {
                        Ban(player, message, ToBanSeconds(decision.BanDurationMinutes, _settings.MaxBanDurationMinutes));
                    }

                    break;

                default:
                    _logger.Warn("Unknown policy action " + decision.Action + "; nothing done. " + line);
                    return;
            }

            if (decision.NotifyAdmins)
            {
                _staff.Notify(line);
            }
        }

        private static string PlayerMessage(PolicyDecision decision)
        {
            var text = decision.Message;
            if (string.IsNullOrWhiteSpace(text))
            {
                text = PolicyMessages.DefaultFor(decision.Action) ?? "This server's trust policy applies to your account.";
            }

            return TextSanitizer.CleanLine(text, MaxPlayerMessageLength);
        }

        private void Warn(Player player, string message)
        {
            try
            {
                player.SendBroadcast(message, BroadcastSeconds);
                player.SendHint(message, BroadcastSeconds);
            }
            catch (Exception ex)
            {
                _logger.Warn("Could not warn " + PlayerIdentity.Describe(player) + ": " + ex.GetType().Name);
            }
        }

        private void Kick(Player player, string message)
        {
            try
            {
                if (!player.Kick(message))
                {
                    _logger.Warn("The game refused to kick " + PlayerIdentity.Describe(player) + ".");
                }
            }
            catch (Exception ex)
            {
                _logger.Error("Kicking " + PlayerIdentity.Describe(player) + " failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        private void Ban(Player player, string message, long seconds)
        {
            try
            {
                if (!player.Ban(message, seconds))
                {
                    _logger.Warn("The game refused to ban " + PlayerIdentity.Describe(player) + " (staff bypass?); kicking instead.");
                    player.Kick(message);
                }
            }
            catch (Exception ex)
            {
                _logger.Error("Banning " + PlayerIdentity.Describe(player) + " failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }
    }
}
