using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Services;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Plugin.Enforcement
{
    /// <summary>Text renderings of check results for logs, staff notifications and commands.</summary>
    internal static class DecisionFormatter
    {
        /// <summary>Wire name of the action in upper case, e.g. <c>ADMIN_NOTIFY</c>.</summary>
        public static string ActionLabel(PolicyAction action) => PolicyActions.ToWire(action).ToUpperInvariant();

        /// <summary>Applied rules as <c>id(signal:reason)</c>, plus bypassed rules.</summary>
        public static string Rules(PolicyDecision decision)
        {
            var text = decision.Applied.Count == 0 ? "no rule applied" : "rules " + Join(decision.Applied);
            if (decision.Bypassed.Count > 0)
            {
                text += "; bypassed " + Join(decision.Bypassed);
            }

            return text;
        }

        /// <summary>One line of backend information (never contains IPs).</summary>
        public static string Information(PlayerCheckResponse response)
        {
            var sb = new StringBuilder();
            sb.Append("status ").Append(response.GlobalStatus);
            if (!string.IsNullOrEmpty(response.CaseId))
            {
                sb.Append(" (").Append(response.CaseId).Append(')');
            }

            sb.Append(" · reports ").Append(response.Reports).Append('/').Append(response.OpenReports).Append(" open");
            sb.Append(" · confirmed by ").Append(response.ConfirmedServers).Append(" servers (").Append(response.IndependentConfirmedServers).Append(" independent)");
            sb.Append(" · account age ");
            if (response.AccountAge?.Days != null)
            {
                sb.Append(response.AccountAge.Days.Value.ToString(CultureInfo.InvariantCulture)).Append(" d");
                if (!string.IsNullOrEmpty(response.AccountAge.Source))
                {
                    sb.Append(" (").Append(response.AccountAge.Source).Append(')');
                }
            }
            else
            {
                sb.Append("unknown");
            }

            sb.Append(" · vpn ").Append(response.Vpn?.Confidence ?? VpnConfidences.NotDetected);
            if (!string.IsNullOrEmpty(response.Vpn?.Type))
            {
                sb.Append(" (").Append(response.Vpn!.Type).Append(')');
            }

            if (response.Vpn?.Checked == false)
            {
                sb.Append(" [not checked").Append(string.IsNullOrEmpty(response.Vpn.Error) ? string.Empty : ": " + response.Vpn.Error).Append(']');
            }

            sb.Append(" · alt ");
            if (response.AltAccount?.Possible == true)
            {
                sb.Append(response.AltAccount.Confidence);
                if (response.AltAccount.Signals.Count > 0)
                {
                    sb.Append(" [").Append(string.Join(", ", response.AltAccount.Signals)).Append(']');
                }

                if (response.AltAccount.LinkedConfirmedCases.Count > 0)
                {
                    sb.Append(" linked cases ").Append(string.Join(", ", response.AltAccount.LinkedConfirmedCases));
                }
            }
            else
            {
                sb.Append("none");
            }

            if (response.Bypass?.Active == true)
            {
                sb.Append(" · bypass [").Append(string.Join(", ", response.Bypass.Types)).Append(']');
            }

            return sb.ToString();
        }

        /// <summary>Compact staff notification / log line, e.g. <c>KICK Foo (id): rules … · status …</c>.</summary>
        public static string StaffLine(PlayerCheckOutcome outcome, string who)
        {
            var decision = outcome.Decision;
            if (outcome.Response == null)
            {
                var error = outcome.Error?.Describe() ?? "backend unavailable";
                return ActionLabel(decision.Action) + " " + who + ": trust check unavailable (" + error + ") — " + outcome.PolicyDescription + " backend_unavailable_action";
            }

            var line = ActionLabel(decision.Action) + " " + who + ": " + Rules(decision) + " · " + Information(outcome.Response) + " · " + outcome.PolicyDescription;
            if (decision.Action >= PolicyAction.Warn && !string.IsNullOrEmpty(decision.Message))
            {
                line += " · message: " + TextSanitizer.EscapeRichText(TextSanitizer.CleanLine(decision.Message, 200));
            }

            return line;
        }

        /// <summary>Multi-line report for <c>trust check</c> (no enforcement).</summary>
        public static string Report(PlayerCheckOutcome outcome, string who)
        {
            var decision = outcome.Decision;
            var lines = new List<string> { "Trust check for " + who + " (informational, no action taken)" };
            if (outcome.Response == null)
            {
                lines.Add("Backend unavailable: " + (outcome.Error?.Describe() ?? "unknown error"));
                lines.Add("Policy " + outcome.PolicyDescription + " would apply backend_unavailable_action = " + PolicyActions.ToWire(decision.Action));
                return string.Join("\n", lines);
            }

            var response = outcome.Response;
            lines.Add("Player: " + (response.Player?.UserId ?? outcome.Player.ToUserId()) + (response.Player?.FirstSeenAt != null ? ", first seen " + Timestamp(response.Player.FirstSeenAt.Value) : string.Empty));
            lines.Add("Information: " + Information(response));
            if (response.Cases.Count > 0)
            {
                var cases = new List<string>();
                foreach (var c in response.Cases)
                {
                    cases.Add(c.CaseId + " (" + c.Verdict + ", " + c.Status + ", " + c.ConfirmedServers + " confirmations)");
                }

                lines.Add("Cases: " + string.Join("; ", cases));
            }

            lines.Add("Policy " + outcome.PolicyDescription + " decides " + PolicyActions.ToWire(decision.Action) + " — " + Rules(decision) + (decision.NotifyAdmins ? " — staff notified" : string.Empty));
            if (decision.Action == PolicyAction.Ban)
            {
                lines.Add("Ban duration: " + (decision.BanDurationMinutes.GetValueOrDefault() == 0 ? "permanent" : decision.BanDurationMinutes.GetValueOrDefault() + " min"));
            }

            if (!string.IsNullOrEmpty(decision.Message))
            {
                lines.Add("Message: " + TextSanitizer.EscapeRichText(TextSanitizer.CleanLine(decision.Message, 256)));
            }

            if (response.CheckedAt != null)
            {
                lines.Add("Checked at " + Timestamp(response.CheckedAt.Value) + (response.PolicyVersion != null ? ", backend policy version " + response.PolicyVersion : string.Empty));
            }

            return string.Join("\n", lines);
        }

        public static string Timestamp(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd HH:mm:ss 'UTC'", CultureInfo.InvariantCulture);

        private static string Join(IReadOnlyList<PolicyRuleOutcome> outcomes)
        {
            var parts = new List<string>(outcomes.Count);
            foreach (var outcome in outcomes)
            {
                parts.Add(outcome.RuleId + "(" + PolicySignals.ToWire(outcome.Signal) + ":" + PolicyReasonCodes.ToWire(outcome.ReasonCode) + "→" + PolicyActions.ToWire(outcome.Action) + ")");
            }

            return string.Join(", ", parts);
        }
    }
}
