using System;
using LabApi.Events.Arguments.PlayerEvents;
using LabApi.Events.Handlers;
using LabApi.Features.Wrappers;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Reports;
using ScpslTrust.Plugin.Players;
using ScpslTrust.Plugin.Runtime;

namespace ScpslTrust.Plugin.Events
{
    /// <summary>Forwards in-game cheater/player reports to <c>POST /server/reports</c> (§6.5), throttled per reporter.</summary>
    internal sealed class ReportForwarder
    {
        private readonly TrustRuntime _runtime;
        private readonly BackendServices _backend;

        public ReportForwarder(TrustRuntime runtime, BackendServices backend)
        {
            _runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
            _backend = backend ?? throw new ArgumentNullException(nameof(backend));
        }

        public void Register()
        {
            PlayerEvents.ReportedCheater += OnReportedCheater;
            PlayerEvents.ReportedPlayer += OnReportedPlayer;
        }

        public void Unregister()
        {
            PlayerEvents.ReportedCheater -= OnReportedCheater;
            PlayerEvents.ReportedPlayer -= OnReportedPlayer;
        }

        private void OnReportedCheater(PlayerReportedCheaterEventArgs ev) => Forward(InGameReportKind.Cheater, ev.Player, ev.Target, ev.Reason);

        private void OnReportedPlayer(PlayerReportedPlayerEventArgs ev) => Forward(InGameReportKind.Player, ev.Player, ev.Target, ev.Reason);

        private void Forward(InGameReportKind kind, Player? reporter, Player? target, string? reason)
        {
            if (!_runtime.Settings.ForwardIngameReports)
            {
                return;
            }

            try
            {
                if (!PlayerIdentity.TryGetPlayerRef(target, out var targetRef))
                {
                    return;
                }

                PlayerIdentity.TryGetPlayerRef(reporter, out var reporterRef);
                var request = InGameReportFactory.Create(
                    kind,
                    targetRef,
                    PlayerIdentity.NicknameOf(target!),
                    reporterRef,
                    reporter == null ? null : PlayerIdentity.NicknameOf(reporter),
                    reason,
                    _runtime.Game.ServerName);
                if (request == null)
                {
                    return;
                }

                if (!_backend.Reports.TryAcquire(reporterRef, targetRef))
                {
                    _runtime.Logger.Debug("In-game report on " + targetRef + " not forwarded (throttled).");
                    return;
                }

                var reporterUserId = reporter?.UserId;
                var reporterPlayerId = reporter?.PlayerId ?? -1;
                _runtime.RunBackground("forward report on " + targetRef, async cancellationToken =>
                {
                    try
                    {
                        var response = await _backend.Client.SubmitReportAsync(request, cancellationToken).ConfigureAwait(false);
                        _runtime.Logger.Info("Forwarded an in-game " + (kind == InGameReportKind.Cheater ? "cheater" : "player") + " report on " + targetRef + " → " + response.CaseId + " (report " + response.ReportId + ").");
                        if (reporterUserId != null)
                        {
                            _runtime.Dispatcher.Post(() => PlayerIdentity.FindOnline(reporterUserId, reporterPlayerId)
                                ?.SendConsoleMessage("[Trust] Your report was forwarded to the trust network (case " + response.CaseId + ").", "green"));
                        }
                    }
                    catch (TrustApiException ex)
                    {
                        _runtime.Logger.Warn("Forwarding an in-game report on " + targetRef + " failed: " + ex.Describe());
                    }
                });
            }
            catch (Exception ex)
            {
                _runtime.Logger.Error("Report handler failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }
    }
}
