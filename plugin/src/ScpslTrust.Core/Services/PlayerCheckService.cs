using System;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Text;

namespace ScpslTrust.Core.Services
{
    /// <summary>Data captured on the main thread when a player joins.</summary>
    public sealed class PlayerCheckContext
    {
        public PlayerCheckContext(PlayerRef player, string? nickname, string? ipAddress, DateTimeOffset? accountCreatedHint, string? serverName)
        {
            Player = player ?? throw new ArgumentNullException(nameof(player));
            Nickname = nickname;
            IpAddress = ipAddress;
            AccountCreatedHint = accountCreatedHint;
            ServerName = serverName;
        }

        public PlayerRef Player { get; }

        public string? Nickname { get; }

        /// <summary>Raw address; only sent when send_ip_for_vpn_check is enabled, never logged.</summary>
        public string? IpAddress { get; }

        public DateTimeOffset? AccountCreatedHint { get; }

        /// <summary>For the {server_name} placeholder.</summary>
        public string? ServerName { get; }

        public override string ToString() => "PlayerCheckContext(" + Player + ")";
    }

    /// <summary>Result of a join check: backend information (if any) and the local decision.</summary>
    public sealed class PlayerCheckOutcome
    {
        public PlayerCheckOutcome(PlayerRef player, PlayerCheckResponse? response, PolicyDecision decision, ServerPolicy policy, string policyDescription, TrustApiException? error)
        {
            Player = player;
            Response = response;
            Decision = decision;
            Policy = policy;
            PolicyDescription = policyDescription;
            Error = error;
        }

        public PlayerRef Player { get; }

        /// <summary>Null when the backend could not be asked.</summary>
        public PlayerCheckResponse? Response { get; }

        public PolicyDecision Decision { get; }

        public ServerPolicy Policy { get; }

        public string PolicyDescription { get; }

        /// <summary>Why the backend was unavailable (null on success).</summary>
        public TrustApiException? Error { get; }

        public bool BackendAvailable => Response != null;
    }

    public sealed class PlayerCheckOptions
    {
        public bool SendIpForVpnCheck { get; set; } = true;

        public bool SendAccountAgeHint { get; set; }
    }

    /// <summary>
    /// Asks <c>/player/check</c> and evaluates the local policy (§7). The backend only supplies information;
    /// the decision is computed here. Any backend failure yields the policy's backend_unavailable_action.
    /// </summary>
    public sealed class PlayerCheckService
    {
        private readonly ITrustApiClient _client;
        private readonly PolicyManager _policies;
        private readonly PlayerCheckOptions _options;
        private readonly ITrustLogger _logger;
        private int _refreshInFlight;

        public PlayerCheckService(ITrustApiClient client, PolicyManager policies, PlayerCheckOptions options, ITrustLogger logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _policies = policies ?? throw new ArgumentNullException(nameof(policies));
            _options = options ?? new PlayerCheckOptions();
            _logger = logger ?? NullTrustLogger.Instance;
        }

        public async Task<PlayerCheckOutcome> CheckAsync(PlayerCheckContext context, CancellationToken cancellationToken = default)
        {
            if (context == null)
            {
                throw new ArgumentNullException(nameof(context));
            }

            var request = new PlayerCheckRequest
            {
                Player = context.Player,
                Nickname = TextSanitizer.ToNickname(context.Nickname),
                Ip = _options.SendIpForVpnCheck ? IpAddresses.Normalize(context.IpAddress) : null,
                AccountCreatedAt = _options.SendAccountAgeHint ? context.AccountCreatedHint : null,
            };

            PlayerCheckResponse? response = null;
            TrustApiException? error = null;
            try
            {
                response = await _client.CheckPlayerAsync(request, cancellationToken).ConfigureAwait(false);
            }
            catch (TrustApiException ex)
            {
                error = ex;
                _logger.Warn("Trust check for " + context.Player + " failed: " + ex.Describe() + "; applying backend_unavailable_action.");
            }

            if (response != null && _policies.IsOutdated(response.PolicyVersion) && Interlocked.CompareExchange(ref _refreshInFlight, 1, 0) == 0)
            {
                // Refresh in the background; this check uses the policy in effect right now.
                _ = RefreshPolicyQuietlyAsync();
            }

            var policy = _policies.Current;
            var description = _policies.Describe();
            var decision = response == null
                ? BackendUnavailablePolicy.Decide(policy)
                : PolicyEngine.Evaluate(PolicyEvaluationInput.FromCheckResponse(response), policy, new PolicyEvaluationContext(context.ServerName));
            return new PlayerCheckOutcome(context.Player, response, decision, policy, description, error);
        }

        private async Task RefreshPolicyQuietlyAsync()
        {
            try
            {
                await _policies.RefreshAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.Warn("Background policy refresh failed: " + ex.GetType().Name);
            }
            finally
            {
                Interlocked.Exchange(ref _refreshInFlight, 0);
            }
        }
    }
}
