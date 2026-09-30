using System;
using System.Collections.Generic;
using System.Globalization;
using CommandSystem;
using ScpslTrust.Core;
using ScpslTrust.Core.Security;
using ScpslTrust.Plugin.Enforcement;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust status</c> — connection, identity, heartbeat, policy and proof-session overview.</summary>
    internal sealed class StatusSubcommand : ICommand
    {
        public string Command => "status";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Shows the trust network connection, identity, policy and proof session status.";

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetRuntime(out var runtime, out response)
                || !CommandSupport.RequirePermission(sender, runtime.Settings.StaffCommandPermission, out response))
            {
                return false;
            }

            var lines = new List<string> { "ScpslTrust " + TrustInfo.PluginVersion + " — backend " + (runtime.Settings.ApiBaseUri?.ToString() ?? "NOT CONFIGURED (" + runtime.Settings.ApiBaseUriError + ")") };
            var identity = runtime.Identities.Current;
            if (identity != null)
            {
                lines.Add("Identity: " + identity.ServerId + ", key " + identity.Fingerprint + " (created " + DecisionFormatter.Timestamp(identity.CreatedAt) + ")");
            }
            else
            {
                lines.Add("Identity: not registered" + (runtime.Identities.LoadError != null ? " — " + KeyStore.IdentityFileName + " unreadable: " + runtime.Identities.LoadError : " — run 'trust register <token>' in the server console"));
            }

            var backend = runtime.Backend;
            if (backend != null)
            {
                var heartbeat = backend.Heartbeat.LastStatus;
                lines.Add(heartbeat == null
                    ? "Heartbeat: none sent yet"
                    : heartbeat.Succeeded
                        ? "Heartbeat: OK at " + DecisionFormatter.Timestamp(heartbeat.At) + " (server status " + heartbeat.ServerStatus + ", backend policy v" + (heartbeat.PolicyVersion?.ToString(CultureInfo.InvariantCulture) ?? "?") + ")"
                        : "Heartbeat: FAILED at " + DecisionFormatter.Timestamp(heartbeat.At) + " — " + heartbeat.Error);

                var policies = backend.Policies;
                var policy = policies.Current;
                var policyLine = "Policy: " + policies.Describe() + ", " + policy.Rules.Count + " rules, backend_unavailable_action " + policy.BackendUnavailableAction;
                if (policies.LastRefreshAt != null)
                {
                    policyLine += ", loaded " + DecisionFormatter.Timestamp(policies.LastRefreshAt.Value);
                }

                if (policies.LastError != null)
                {
                    policyLine += ", last refresh error: " + policies.LastError;
                }

                lines.Add(policyLine);

                var skew = backend.ClockSkew.LastMeasuredSkew;
                lines.Add("Clock offset to backend: " + (skew.HasValue ? skew.Value.TotalSeconds.ToString("+0.0;-0.0", CultureInfo.InvariantCulture) + " s (correction " + runtime.Clock.Offset.TotalSeconds.ToString("+0.0;-0.0", CultureInfo.InvariantCulture) + " s)" : "not measured"));

                if (backend.Rotation.HasPendingRecovery)
                {
                    lines.Add("Key rotation: an interrupted rotation is waiting to be resolved with the backend");
                }

                var sessions = backend.Sessions.GetSessions();
                var overwatch = runtime.Settings.OverwatchProofEnabled ? sessions.Count + " active proof session(s)" : "disabled";
                lines.Add("Overwatch proof: " + overwatch);
                foreach (var session in sessions)
                {
                    lines.Add("  #" + session.SessionId.ToString("N").Substring(0, 8) + " " + session.Spectator + " → " + session.Target + " (every " + session.IntervalSeconds + " s" + (session.Manual ? ", manual" : string.Empty) + ", since " + DecisionFormatter.Timestamp(session.StartedAt) + ")");
                }
            }

            lines.Add("Checks on join: " + (runtime.Settings.CheckOnJoin ? "on" : "off") + ", IP sent for VPN check: " + (runtime.Settings.SendIpForVpnCheck ? "yes" : "no") + ", report forwarding: " + (runtime.Settings.ForwardIngameReports ? "on" : "off") + ", pending staff notices: " + runtime.Staff.PendingCount);
            if (runtime.ConfigIssues.Count > 0)
            {
                lines.Add("Config issues: " + string.Join("; ", runtime.ConfigIssues));
            }

            response = string.Join("\n", lines);
            return true;
        }
    }
}
