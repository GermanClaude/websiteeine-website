using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using LabApi.Loader;
using MEC;
using ScpslTrust.Core;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Config;
using ScpslTrust.Core.Security;
using ScpslTrust.Core.Services;
using ScpslTrust.Plugin.Enforcement;
using ScpslTrust.Plugin.Events;

namespace ScpslTrust.Plugin.Runtime
{
    /// <summary>
    /// Composition root of the plugin: wires ScpslTrust.Core to LabAPI, owns the main-thread dispatcher,
    /// the event handlers and the background jobs, and exposes the operations used by commands.
    /// </summary>
    internal sealed class TrustRuntime
    {
        private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(3);

        private readonly CancellationTokenSource _shutdown = new CancellationTokenSource();
        private readonly PlayerEventHandlers _playerHandlers;
        private readonly ServerEventHandlers _serverHandlers;
        private readonly OverwatchHandlers? _overwatchHandlers;
        private readonly ReportForwarder? _reportForwarder;
        private CoroutineHandle _tick;
        private volatile bool _stopping;

        /// <summary>Must be constructed on the main thread (plugin Enable).</summary>
        public TrustRuntime(TrustPlugin plugin)
        {
            Plugin = plugin ?? throw new ArgumentNullException(nameof(plugin));
            Settings = TrustSettings.FromConfig(plugin.Config, out var issues);
            ConfigIssues = issues;
            Logger = new LabApiLogger(() => Settings.Debug);
            foreach (var issue in issues)
            {
                Logger.Warn("config.yml: " + issue);
            }

            ConfigDirectory = plugin.GetConfigDirectory().FullName;
            Clock = new OffsetClock(SystemClock.Instance);
            Dispatcher = new MecMainThreadDispatcher(Logger);
            Game = GameState.Capture(Logger);
            Identities = new ServerIdentityHolder(new KeyStore(ConfigDirectory), Logger);
            Identities.TryLoad();
            Staff = new StaffNotifier(Settings, Logger);
            Enforcer = new EnforcementExecutor(Settings, Staff, Logger);

            if (Settings.ApiBaseUri != null)
            {
                Backend = new BackendServices(this);
            }
            else
            {
                Logger.Error("api_base_url is not usable (" + (Settings.ApiBaseUriError ?? "not configured") + "). Set it in " + ConfigDirectory + "/config.yml and restart; the plugin stays idle until then.");
            }

            _playerHandlers = new PlayerEventHandlers(this);
            _serverHandlers = new ServerEventHandlers(this);
            if (Backend != null)
            {
                _overwatchHandlers = new OverwatchHandlers(this, Backend.Sessions);
                _reportForwarder = new ReportForwarder(this, Backend);
            }
        }

        public TrustPlugin Plugin { get; }

        public TrustSettings Settings { get; }

        public IReadOnlyList<string> ConfigIssues { get; }

        /// <summary>LabAPI config folder of this plugin (identity.json, policy-cache.json).</summary>
        public string ConfigDirectory { get; }

        public ITrustLogger Logger { get; }

        public OffsetClock Clock { get; }

        public MecMainThreadDispatcher Dispatcher { get; }

        public GameState Game { get; }

        public ServerIdentityHolder Identities { get; }

        public StaffNotifier Staff { get; }

        public EnforcementExecutor Enforcer { get; }

        /// <summary>Null when api_base_url is missing or invalid.</summary>
        public BackendServices? Backend { get; }

        public DateTimeOffset StartedAt { get; private set; }

        public bool IsStopping => _stopping;

        /// <summary>Main thread.</summary>
        public void Start()
        {
            StartedAt = Clock.UtcNow;
            Dispatcher.Start();
            _playerHandlers.Register();
            _serverHandlers.Register();
            _overwatchHandlers?.Register();
            _reportForwarder?.Register();
            _tick = Timing.RunCoroutine(SecondTick());

            if (Backend != null)
            {
                RunBackground("start-up", StartupAsync);
            }

            var identity = Identities.Current;
            Logger.Info("ScpslTrust " + TrustInfo.PluginVersion + " enabled — " + (identity != null ? "registered as " + identity.ServerId + " (key " + identity.Fingerprint + ")" : "not registered yet") + "; policy source " + Settings.PolicySource.ToString().ToLowerInvariant() + ".");
        }

        /// <summary>Main thread. Ends proof sessions (bounded wait) and releases everything.</summary>
        public void Stop()
        {
            _stopping = true;
            Backend?.Scheduler.Stop(StopTimeout);
            _playerHandlers.Unregister();
            _serverHandlers.Unregister();
            _overwatchHandlers?.Unregister();
            _reportForwarder?.Unregister();
            Timing.KillCoroutines(_tick);

            if (Backend != null)
            {
                try
                {
                    using (var timeout = new CancellationTokenSource(StopTimeout))
                    {
                        Backend.Sessions.EndAllAsync(OverwatchEndReason.Manual, timeout.Token).Wait(StopTimeout);
                    }
                }
                catch (Exception ex)
                {
                    Logger.Debug("Ending proof sessions on disable: " + ex.GetType().Name);
                }
            }

            _shutdown.Cancel();
            Dispatcher.Stop();
            Backend?.Client.Dispose();
            _shutdown.Dispose();
            Logger.Info("ScpslTrust disabled.");
        }

        /// <summary>Runs <paramref name="work"/> on the thread pool; failures are logged, never thrown.</summary>
        public void RunBackground(string name, Func<CancellationToken, Task> work)
        {
            if (work == null)
            {
                throw new ArgumentNullException(nameof(work));
            }

            var token = _shutdown.Token;
            Task.Run(async () =>
            {
                try
                {
                    await work(token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    // Plugin disabled.
                }
                catch (Exception ex)
                {
                    Logger.Error("Background task '" + name + "' failed: " + ex.GetType().Name + ": " + ex.Message);
                }
            });
        }

        /// <summary>Heartbeat body; safe to call from any thread.</summary>
        public ServerHeartbeatRequest BuildHeartbeatRequest()
        {
            return new ServerHeartbeatRequest
            {
                PluginVersion = TrustInfo.PluginVersion,
                GameVersion = Game.GameVersion,
                PlayerCount = Game.PlayerCount,
            };
        }

        /// <summary>Registers with a token (§5.2), then loads the policy and sends a first heartbeat.</summary>
        public async Task<RegistrationResult> RegisterAsync(string registrationToken, bool force, CancellationToken cancellationToken)
        {
            var backend = RequireBackend();
            var result = await backend.Registration.RegisterAsync(registrationToken, Game.GameVersion, force, cancellationToken).ConfigureAwait(false);
            ClearRegistrationTokenInConfig();
            await backend.Policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
            await backend.Heartbeat.BeatAsync(cancellationToken).ConfigureAwait(false);
            return result;
        }

        public Task<KeyRotationResult> RotateKeyAsync(CancellationToken cancellationToken)
        {
            return RequireBackend().Rotation.RotateAsync(cancellationToken);
        }

        /// <summary>
        /// Re-reads config.yml and applies its <c>local_policy</c> (other settings need a restart).
        /// Main thread. Returns validation issues of the new policy.
        /// </summary>
        public IReadOnlyList<string> ReloadLocalPolicy()
        {
            if (!Plugin.TryReadConfig<TrustConfig>(Plugin.ConfigFileName, out var config) || config == null)
            {
                return new[] { "config.yml could not be read (see the server log); keeping the current local policy" };
            }

            var fresh = TrustSettings.FromConfig(config, out var issues);
            Backend?.Policies.SetLocalPolicy(fresh.LocalPolicy);
            return issues;
        }

        /// <summary>Removes a consumed <c>registration_token</c> from config.yml (on the main thread).</summary>
        public void ClearRegistrationTokenInConfig()
        {
            Dispatcher.Post(() =>
            {
                if (string.IsNullOrWhiteSpace(Plugin.Config.RegistrationToken))
                {
                    return;
                }

                Plugin.Config.RegistrationToken = string.Empty;
                Plugin.SaveConfig();
                Logger.Info("The consumed registration_token was removed from config.yml.");
            });
        }

        private BackendServices RequireBackend()
        {
            return Backend ?? throw new InvalidOperationException("api_base_url is not configured (" + (Settings.ApiBaseUriError ?? "missing") + ").");
        }

        private async Task StartupAsync(CancellationToken cancellationToken)
        {
            var backend = Backend!;
            try
            {
                await backend.ClockSkew.MeasureAsync(cancellationToken).ConfigureAwait(false);

                if (Settings.RegistrationToken != null)
                {
                    if (Identities.Current == null && Identities.LoadError == null)
                    {
                        Logger.Info("Registering with the trust network using the registration_token from config.yml…");
                        try
                        {
                            await RegisterAsync(Settings.RegistrationToken, force: false, cancellationToken).ConfigureAwait(false);
                        }
                        catch (Exception ex) when (!(ex is OperationCanceledException))
                        {
                            Logger.Error("Registration with the configured token failed: " + Commands.CommandSupport.DescribeError(ex) + " Request a new token in the web panel and run 'trust register <token>' in the server console.");
                        }
                    }
                    else
                    {
                        Logger.Warn("registration_token is set in config.yml but this server " + (Identities.Current != null ? "is already registered" : "has an unreadable identity file") + "; the token is removed. Use 'trust register <token> --force' to replace the identity on purpose.");
                        ClearRegistrationTokenInConfig();
                    }
                }

                if (Identities.Current == null)
                {
                    Logger.Warn("This server is not registered with the trust network: create it in the web panel and run 'trust register <token>' in the server console. Player checks are skipped until then.");
                    return;
                }

                await backend.Rotation.RecoverAsync(cancellationToken).ConfigureAwait(false);
                await backend.Heartbeat.BeatAsync(cancellationToken).ConfigureAwait(false);
                if (Settings.PolicySource == PolicySourceKind.Remote && backend.Policies.Origin != Core.Policy.PolicyOrigin.Remote)
                {
                    await backend.Policies.RefreshAsync(cancellationToken).ConfigureAwait(false);
                }
            }
            finally
            {
                if (!cancellationToken.IsCancellationRequested)
                {
                    backend.Scheduler.Start();
                }
            }
        }

        private IEnumerator<float> SecondTick()
        {
            while (!_stopping)
            {
                TickOnce();
                yield return Timing.WaitForSeconds(1f);
            }
        }

        private void TickOnce()
        {
            try
            {
                Game.Refresh();
                _overwatchHandlers?.Tick();
            }
            catch (Exception ex)
            {
                Logger.Error("Periodic tick failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }
    }
}
