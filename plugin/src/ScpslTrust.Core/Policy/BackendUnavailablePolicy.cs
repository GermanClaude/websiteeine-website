using System;

namespace ScpslTrust.Core.Policy
{
    /// <summary>
    /// Decision used when the backend cannot be asked (timeout, network error, auth failure,
    /// not registered): the policy's <c>backend_unavailable_action</c> — allow, admin_notify or kick (§7.3).
    /// </summary>
    public static class BackendUnavailablePolicy
    {
        public const string AdminNotifyMessage = "Trust check unavailable; the player was admitted without a check.";
        public const string KickMessage = "This server could not verify your account with the trust network. Please try again in a few minutes.";

        public static PolicyDecision Decide(ServerPolicy policy)
        {
            if (policy == null)
            {
                throw new ArgumentNullException(nameof(policy));
            }

            PolicyActions.TryParse(policy.BackendUnavailableAction, out var action);
            switch (action)
            {
                case PolicyAction.Kick:
                    return new PolicyDecision(PolicyAction.Kick, Array.Empty<PolicyRuleOutcome>(), Array.Empty<PolicyRuleOutcome>(), policy.NotifyOnEnforcement, KickMessage, null);
                case PolicyAction.AdminNotify:
                    return new PolicyDecision(PolicyAction.AdminNotify, Array.Empty<PolicyRuleOutcome>(), Array.Empty<PolicyRuleOutcome>(), true, AdminNotifyMessage, null);
                default:
                    // Unknown or disallowed values fall back to allow (fail open, like the default policy).
                    return new PolicyDecision(PolicyAction.Allow, Array.Empty<PolicyRuleOutcome>(), Array.Empty<PolicyRuleOutcome>(), false, null, null);
            }
        }
    }
}
