using System;
using ScpslTrust.Core;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Config;
using ScpslTrust.Core.Policy;
using ScpslTrust.Core.Proof;
using ScpslTrust.Core.Reports;
using ScpslTrust.Core.Services;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>Every Core service that needs the backend, plus the background job schedule.</summary>
    internal sealed class BackendServices
    {
        private static readonly TimeSpan OverwatchTick = TimeSpan.FromSeconds(1);

        public BackendServices(TrustRuntime runtime)
        {
            if (runtime == null)
            {
                throw new ArgumentNullException(nameof(runtime));
            }

            var settings = runtime.Settings;
            var options = new TrustApiClientOptions(settings.ApiBaseUri ?? throw new InvalidOperationException("api_base_url is required."), TrustInfo.PluginVersion)
            {
                RequestTimeout = settings.RequestTimeout,
            };

            Client = new TrustApiClient(options, runtime.Identities, runtime.Clock, runtime.Logger);
            ClockSkew = new ClockSkewMonitor(Client, runtime.Clock, runtime.Logger);
            Policies = new PolicyManager(settings.PolicySource, settings.LocalPolicy, Client, runtime.Identities, new PolicyCache(runtime.ConfigDirectory, runtime.Logger), runtime.Clock, runtime.Logger);
            Policies.Initialize();
            Checks = new PlayerCheckService(
                Client,
                Policies,
                new PlayerCheckOptions { SendIpForVpnCheck = settings.SendIpForVpnCheck, SendAccountAgeHint = settings.SendAccountAgeHint },
                runtime.Logger);
            Rotation = new KeyRotationService(Client, runtime.Identities, runtime.BuildHeartbeatRequest, runtime.Clock, runtime.Logger);
            Registration = new RegistrationService(Client, runtime.Identities, runtime.Clock, runtime.Logger);
            Heartbeat = new HeartbeatService(Client, runtime.Identities, Policies, Rotation, ClockSkew, runtime.BuildHeartbeatRequest, runtime.Clock, runtime.Logger);
            Sessions = new OverwatchSessionManager(Client, runtime.Identities, runtime.Clock, runtime.Logger);
            Reports = ReportThrottle.CreateDefault(runtime.Clock);
            LinkAttempts = new RateLimiter(runtime.Clock, TimeSpan.FromSeconds(5), TimeSpan.FromMinutes(10), 8);

            Scheduler = new PeriodicScheduler(runtime.Logger);
            Scheduler.Add("heartbeat", settings.HeartbeatInterval, settings.HeartbeatInterval, Heartbeat.BeatAsync);
            if (settings.PolicySource == PolicySourceKind.Remote)
            {
                Scheduler.Add("policy-refresh", settings.PolicyRefreshInterval, settings.PolicyRefreshInterval, async cancellationToken =>
                {
                    await Policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
                });
            }

            if (settings.OverwatchProofEnabled)
            {
                Scheduler.Add("overwatch", OverwatchTick, OverwatchTick, Sessions.TickAsync);
            }
        }

        public TrustApiClient Client { get; }

        public ClockSkewMonitor ClockSkew { get; }

        public PolicyManager Policies { get; }

        public PlayerCheckService Checks { get; }

        public KeyRotationService Rotation { get; }

        public RegistrationService Registration { get; }

        public HeartbeatService Heartbeat { get; }

        public OverwatchSessionManager Sessions { get; }

        /// <summary>Throttle for forwarded in-game reports.</summary>
        public ReportThrottle Reports { get; }

        /// <summary>Limiter for <c>.trustlink</c> attempts per player.</summary>
        public RateLimiter LinkAttempts { get; }

        public PeriodicScheduler Scheduler { get; }
    }
}
