using System;
using System.Collections.Generic;
using CommandSystem;
using ScpslTrust.Core.Config;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Plugin.Commands
{
    /// <summary><c>trust policy [show|reload]</c> — inspect or reload the enforcement policy (§7).</summary>
    internal sealed class PolicySubcommand : ICommand, IUsageProvider
    {
        public string Command => "policy";

        public string[] Aliases => Array.Empty<string>();

        public string Description => "Shows the enforcement policy in effect or reloads it (remote: re-fetch; local: re-read config.yml).";

        public string[] Usage => new[] { "[show|reload]" };

        public bool Execute(ArraySegment<string> arguments, ICommandSender sender, out string response)
        {
            if (!CommandSupport.TryGetBackend(out var runtime, out var backend, out response))
            {
                return false;
            }

            var action = CommandSupport.Arg(arguments, 0).ToLowerInvariant();
            if (action == "reload")
            {
                if (!CommandSupport.RequirePermission(sender, runtime.Settings.AdminCommandPermission, out response))
                {
                    return false;
                }

                if (runtime.Settings.PolicySource == PolicySourceKind.Local)
                {
                    var issues = runtime.ReloadLocalPolicy();
                    response = "Local policy reloaded: " + backend.Policies.Describe() + " (" + backend.Policies.Current.Rules.Count + " rules)"
                        + (issues.Count > 0 ? "\nIssues: " + string.Join("; ", issues) : string.Empty);
                    return true;
                }

                if (runtime.Identities.Current == null)
                {
                    response = "This server is not registered; the remote policy cannot be fetched.";
                    return false;
                }

                response = CommandSupport.RunAsync(runtime, sender, "Fetching the policy …", async cancellationToken =>
                {
                    var refreshed = await backend.Policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
                    return refreshed
                        ? "Policy refreshed: " + backend.Policies.Describe() + " (" + backend.Policies.Current.Rules.Count + " rules)."
                        : "Policy refresh failed (" + (backend.Policies.LastError ?? "unknown error") + "); keeping " + backend.Policies.Describe() + ".";
                });
                return true;
            }

            if (action.Length != 0 && action != "show")
            {
                response = "Usage: trust policy [show|reload]";
                return false;
            }

            if (!CommandSupport.RequirePermission(sender, runtime.Settings.StaffCommandPermission, out response))
            {
                return false;
            }

            response = Describe(backend.Policies);
            return true;
        }

        private static string Describe(PolicyManager policies)
        {
            var policy = policies.Current;
            var lines = new List<string>
            {
                "Policy in effect: " + policies.Describe() + " (source " + policies.Source.ToString().ToLowerInvariant() + ")",
                "backend_unavailable_action " + policy.BackendUnavailableAction + ", notify_on_enforcement " + policy.NotifyOnEnforcement + ", honor_global_bypasses " + policy.HonorGlobalBypasses
                    + (string.IsNullOrEmpty(policy.WhitelistUrl) ? string.Empty : ", whitelist_url " + policy.WhitelistUrl),
            };

            if (policy.Rules.Count == 0)
            {
                lines.Add("No rules: every player is allowed.");
            }

            foreach (var rule in policy.Rules)
            {
                if (rule == null)
                {
                    continue;
                }

                var recognized = PolicySignals.TryParse(rule.Signal, out _) && PolicyActions.TryParse(rule.Action, out _);
                var line = "  " + rule.Id + ": " + rule.Signal + " → " + rule.Action + " [" + Conditions(rule) + "]";
                if (!rule.Enabled)
                {
                    line += " (disabled)";
                }
                else if (!recognized)
                {
                    line += " (unknown signal or action: ignored)";
                }

                if (!string.IsNullOrEmpty(rule.Message))
                {
                    line += " — \"" + TextSanitizer.EscapeRichText(TextSanitizer.CleanLine(rule.Message, 80)) + "\"";
                }

                lines.Add(line);
            }

            return string.Join("\n", lines);
        }

        private static string Conditions(PolicyRule rule)
        {
            var parts = new List<string>();
            if (rule.Statuses != null && rule.Statuses.Count > 0)
            {
                parts.Add("statuses " + string.Join("|", rule.Statuses));
            }

            if (rule.MinConfirmedServers != null)
            {
                parts.Add("min_confirmed_servers " + rule.MinConfirmedServers);
            }

            if (rule.MaxAccountAgeDays != null)
            {
                parts.Add("age < " + rule.MaxAccountAgeDays + " d" + (rule.MatchUnknownAge == true ? " or unknown" : string.Empty));
            }

            if (rule.MinVpnConfidence != null)
            {
                parts.Add("vpn ≥ " + rule.MinVpnConfidence);
            }

            if (rule.MinAltConfidence != null)
            {
                parts.Add("alt ≥ " + rule.MinAltConfidence + (rule.RequireLinkedConfirmedCase == true ? " with confirmed linked case" : string.Empty));
            }

            if (rule.MinOpenReports != null)
            {
                parts.Add("open_reports ≥ " + rule.MinOpenReports);
            }

            if (rule.BanDurationMinutes != null)
            {
                parts.Add("ban " + (rule.BanDurationMinutes == 0 ? "permanent" : rule.BanDurationMinutes + " min"));
            }

            return parts.Count == 0 ? "no conditions" : string.Join(", ", parts);
        }
    }
}
