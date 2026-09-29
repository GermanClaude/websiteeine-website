using System;
using System.Collections.Generic;
using ScpslTrust.Core.Api.Models;

namespace ScpslTrust.Core.Policy
{
    /// <summary>The subset of the <c>/player/check</c> response the engine reads (§7.2 input).</summary>
    public sealed class PolicyEvaluationInput
    {
        public PolicyEvaluationInput(
            string globalStatus,
            string? caseId,
            int confirmedServers,
            int openReports,
            int? accountAgeDays,
            string vpnConfidence,
            bool altAccountPossible,
            string altAccountConfidence,
            IReadOnlyList<string> linkedConfirmedCases,
            IReadOnlyCollection<string> bypassTypes)
        {
            GlobalStatus = globalStatus ?? GlobalStatuses.None;
            CaseId = caseId;
            ConfirmedServers = confirmedServers;
            OpenReports = openReports;
            AccountAgeDays = accountAgeDays;
            VpnConfidence = vpnConfidence ?? VpnConfidences.NotDetected;
            AltAccountPossible = altAccountPossible;
            AltAccountConfidence = altAccountConfidence ?? AltConfidences.None;
            LinkedConfirmedCases = linkedConfirmedCases ?? Array.Empty<string>();
            BypassTypes = bypassTypes ?? Array.Empty<string>();
        }

        public string GlobalStatus { get; }

        public string? CaseId { get; }

        public int ConfirmedServers { get; }

        public int OpenReports { get; }

        /// <summary>Null when the account age is unknown.</summary>
        public int? AccountAgeDays { get; }

        public string VpnConfidence { get; }

        public bool AltAccountPossible { get; }

        public string AltAccountConfidence { get; }

        public IReadOnlyList<string> LinkedConfirmedCases { get; }

        /// <summary>Types of active bypasses (<c>bypass.types</c>).</summary>
        public IReadOnlyCollection<string> BypassTypes { get; }

        /// <summary>Builds the engine input from a validated player-check response.</summary>
        public static PolicyEvaluationInput FromCheckResponse(PlayerCheckResponse response)
        {
            if (response == null)
            {
                throw new ArgumentNullException(nameof(response));
            }

            return new PolicyEvaluationInput(
                response.GlobalStatus,
                response.CaseId,
                response.ConfirmedServers,
                response.OpenReports,
                response.AccountAge?.Days,
                response.Vpn?.Confidence ?? VpnConfidences.NotDetected,
                response.AltAccount?.Possible ?? false,
                response.AltAccount?.Confidence ?? AltConfidences.None,
                response.AltAccount?.LinkedConfirmedCases ?? new List<string>(),
                response.Bypass?.Types ?? new List<string>());
        }
    }

    /// <summary>Optional values for message placeholders.</summary>
    public sealed class PolicyEvaluationContext
    {
        public static readonly PolicyEvaluationContext Empty = new PolicyEvaluationContext(null);

        public PolicyEvaluationContext(string? serverName)
        {
            ServerName = serverName;
        }

        /// <summary>Substituted for <c>{server_name}</c> (empty when null).</summary>
        public string? ServerName { get; }
    }

    /// <summary>One matching rule in a decision.</summary>
    public sealed class PolicyRuleOutcome
    {
        public PolicyRuleOutcome(string ruleId, PolicySignal signal, PolicyAction action, PolicyReasonCode reasonCode)
        {
            RuleId = ruleId;
            Signal = signal;
            Action = action;
            ReasonCode = reasonCode;
        }

        public string RuleId { get; }

        public PolicySignal Signal { get; }

        public PolicyAction Action { get; }

        public PolicyReasonCode ReasonCode { get; }

        public override string ToString()
        {
            return RuleId + "(" + PolicySignals.ToWire(Signal) + "→" + PolicyActions.ToWire(Action) + ", " + PolicyReasonCodes.ToWire(ReasonCode) + ")";
        }
    }

    /// <summary>Result of evaluating a policy (§7.2 output).</summary>
    public sealed class PolicyDecision
    {
        public PolicyDecision(
            PolicyAction action,
            IReadOnlyList<PolicyRuleOutcome> applied,
            IReadOnlyList<PolicyRuleOutcome> bypassed,
            bool notifyAdmins,
            string? message,
            int? banDurationMinutes)
        {
            Action = action;
            Applied = applied ?? Array.Empty<PolicyRuleOutcome>();
            Bypassed = bypassed ?? Array.Empty<PolicyRuleOutcome>();
            NotifyAdmins = notifyAdmins;
            Message = message;
            BanDurationMinutes = banDurationMinutes;
        }

        public PolicyAction Action { get; }

        public IReadOnlyList<PolicyRuleOutcome> Applied { get; }

        public IReadOnlyList<PolicyRuleOutcome> Bypassed { get; }

        public bool NotifyAdmins { get; }

        public string? Message { get; }

        /// <summary>Set only when <see cref="Action"/> is ban (0 = permanent).</summary>
        public int? BanDurationMinutes { get; }
    }
}
