using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ScpslTrust.Core.Abstractions;
using ScpslTrust.Core.Api;
using ScpslTrust.Core.Api.Models;
using ScpslTrust.Core.Players;
using ScpslTrust.Core.Security;

namespace ScpslTrust.Core.Proof
{
    /// <summary>
    /// Tracks Overwatch proof sessions per spectator (§10.1). Callers only declare the desired state
    /// (<see cref="SetAutoTarget"/>, <see cref="StartManual"/>, <see cref="StopManual"/>,
    /// <see cref="HandlePlayerLeft"/>); <see cref="TickAsync"/> performs the network calls to converge:
    /// end sessions whose target changed, start missing sessions (with back-off after failures) and
    /// send heartbeats when due. Secrets stay inside this class and are wiped when a session ends.
    /// </summary>
    public sealed class OverwatchSessionManager
    {
        private const string ActiveStatus = "active";

        private readonly ITrustApiClient _client;
        private readonly IServerIdentityProvider _identities;
        private readonly IClock _clock;
        private readonly ITrustLogger _logger;
        private readonly OverwatchSessionManagerOptions _options;
        private readonly object _gate = new object();
        private readonly Dictionary<string, SpectatorState> _states = new Dictionary<string, SpectatorState>(StringComparer.Ordinal);
        private readonly SemaphoreSlim _tickLock = new SemaphoreSlim(1, 1);

        public OverwatchSessionManager(
            ITrustApiClient client,
            IServerIdentityProvider identities,
            IClock clock,
            ITrustLogger logger,
            OverwatchSessionManagerOptions? options = null)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _identities = identities ?? throw new ArgumentNullException(nameof(identities));
            _clock = clock ?? throw new ArgumentNullException(nameof(clock));
            _logger = logger ?? NullTrustLogger.Instance;
            _options = options ?? new OverwatchSessionManagerOptions();
        }

        /// <summary>Raised on background threads for session lifecycle changes.</summary>
        public event Action<OverwatchSessionEvent>? SessionEvent;

        /// <summary>
        /// Declares whom <paramref name="spectator"/> is automatically recording (null = nobody).
        /// <paramref name="reasonWhenCleared"/> is the end reason used when an auto session stops for lack of a target.
        /// </summary>
        public void SetAutoTarget(PlayerRef spectator, PlayerRef? target, OverwatchEndReason reasonWhenCleared)
        {
            if (spectator == null)
            {
                throw new ArgumentNullException(nameof(spectator));
            }

            if (target != null && target.Equals(spectator))
            {
                target = null;
            }

            lock (_gate)
            {
                if (!_states.TryGetValue(spectator.ToUserId(), out var state))
                {
                    if (target == null)
                    {
                        return;
                    }

                    state = GetOrCreateState(spectator);
                }

                if (Equals(state.AutoTarget, target))
                {
                    return;
                }

                state.AutoTarget = target;
                if (target == null)
                {
                    state.AutoClearReason = reasonWhenCleared;
                }

                if (target == null || !string.Equals(target.ToUserId(), state.SuppressedAutoTarget, StringComparison.Ordinal))
                {
                    state.SuppressedAutoTarget = null;
                }
            }
        }

        /// <summary>Starts (on the next tick) a manual session that ignores spectating state.</summary>
        public void StartManual(PlayerRef spectator, PlayerRef target)
        {
            if (spectator == null)
            {
                throw new ArgumentNullException(nameof(spectator));
            }

            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            if (target.Equals(spectator))
            {
                throw new ArgumentException("Spectator and target must differ.", nameof(target));
            }

            lock (_gate)
            {
                var state = GetOrCreateState(spectator);
                state.ManualTarget = target;
                state.StartBlockedUntil = null;
            }
        }

        /// <summary>
        /// Stops any session of <paramref name="spectator"/> (reason <c>manual</c>). Automatic recording
        /// of the current target stays suppressed until the spectated target changes.
        /// Returns false when nothing was active or pending.
        /// </summary>
        public bool StopManual(PlayerRef spectator)
        {
            if (spectator == null)
            {
                throw new ArgumentNullException(nameof(spectator));
            }

            lock (_gate)
            {
                if (!_states.TryGetValue(spectator.ToUserId(), out var state))
                {
                    return false;
                }

                var hadSomething = state.Session != null || state.ManualTarget != null || state.StartInFlight;
                state.ManualTarget = null;
                state.SuppressedAutoTarget = state.AutoTarget?.ToUserId();
                if (state.Session != null)
                {
                    state.Session.PendingEndReason = OverwatchEndReason.Manual;
                }

                return hadSomething;
            }
        }

        /// <summary>Ends sessions where <paramref name="player"/> is spectator or target (on the next tick).</summary>
        public void HandlePlayerLeft(PlayerRef player)
        {
            if (player == null)
            {
                throw new ArgumentNullException(nameof(player));
            }

            lock (_gate)
            {
                foreach (var state in _states.Values)
                {
                    if (state.Spectator.Equals(player))
                    {
                        state.AutoTarget = null;
                        state.ManualTarget = null;
                        if (state.Session != null)
                        {
                            state.Session.PendingEndReason = OverwatchEndReason.SpectatorLeft;
                        }

                        continue;
                    }

                    if (state.Session != null && state.Session.Target.Equals(player))
                    {
                        state.Session.PendingEndReason = OverwatchEndReason.TargetLeft;
                    }

                    if (player.Equals(state.AutoTarget))
                    {
                        state.AutoTarget = null;
                        state.AutoClearReason = OverwatchEndReason.TargetLeft;
                    }

                    if (player.Equals(state.ManualTarget))
                    {
                        state.ManualTarget = null;
                    }
                }
            }
        }

        /// <summary>Performs pending ends, starts and heartbeats. Overlapping calls return immediately.</summary>
        public async Task TickAsync(CancellationToken cancellationToken = default)
        {
            if (!await _tickLock.WaitAsync(0, cancellationToken).ConfigureAwait(false))
            {
                return;
            }

            try
            {
                var work = new List<Task>();
                lock (_gate)
                {
                    var now = _clock.UtcNow;
                    foreach (var state in _states.Values.ToList())
                    {
                        var plan = Plan(state, now);
                        if (plan != null)
                        {
                            work.Add(ExecuteAsync(state, plan, cancellationToken));
                        }
                        else if (state.IsIdle)
                        {
                            _states.Remove(state.Spectator.ToUserId());
                        }
                    }
                }

                await Task.WhenAll(work).ConfigureAwait(false);
            }
            finally
            {
                _tickLock.Release();
            }
        }

        /// <summary>Ends every session with <paramref name="reason"/> and forgets all desired state (round end, disable).</summary>
        public async Task EndAllAsync(OverwatchEndReason reason, CancellationToken cancellationToken = default)
        {
            var ended = new List<ActiveSession>();
            lock (_gate)
            {
                foreach (var state in _states.Values)
                {
                    state.AutoTarget = null;
                    state.ManualTarget = null;
                    if (state.Session != null)
                    {
                        ended.Add(Detach(state));
                    }
                }

                _states.Clear();
            }

            await Task.WhenAll(ended.Select(session => EndSessionAsync(session, reason, cancellationToken))).ConfigureAwait(false);
        }

        /// <summary>Snapshot of the active sessions (without secrets).</summary>
        public IReadOnlyList<OverwatchSessionInfo> GetSessions()
        {
            lock (_gate)
            {
                return _states.Values
                    .Where(state => state.Session != null)
                    .Select(state => new OverwatchSessionInfo(state.Session!.SessionId, state.Spectator, state.Session.Target, state.Session.IntervalSeconds, state.Session.StartedAt, state.Session.Manual))
                    .ToList();
            }
        }

        /// <summary>Current proof code and overlay text for every active session.</summary>
        public IReadOnlyList<ProofOverlayLine> GetOverlayLines()
        {
            var serverId = _identities.Current?.ServerId;
            if (serverId == null)
            {
                return Array.Empty<ProofOverlayLine>();
            }

            var now = _clock.UtcNow;
            var lines = new List<ProofOverlayLine>();
            lock (_gate)
            {
                foreach (var state in _states.Values)
                {
                    var session = state.Session;
                    if (session == null || session.PendingEndReason != null)
                    {
                        continue;
                    }

                    var code = ProofCodeGenerator.Generate(
                        session.Secret,
                        session.SessionId.ToString("D"),
                        serverId,
                        session.Target.ToUserId(),
                        state.Spectator.ToUserId(),
                        now.ToUnixTimeSeconds(),
                        session.IntervalSeconds);
                    lines.Add(new ProofOverlayLine(state.Spectator, session.SessionId, code, ProofOverlay.Format(code, now, serverId, session.SessionId)));
                }
            }

            return lines;
        }

        private static PlayerRef? Desired(SpectatorState state)
        {
            if (state.ManualTarget != null)
            {
                return state.ManualTarget;
            }

            if (state.AutoTarget != null && !string.Equals(state.AutoTarget.ToUserId(), state.SuppressedAutoTarget, StringComparison.Ordinal))
            {
                return state.AutoTarget;
            }

            return null;
        }

        private SpectatorState GetOrCreateState(PlayerRef spectator)
        {
            var key = spectator.ToUserId();
            if (!_states.TryGetValue(key, out var state))
            {
                state = new SpectatorState(spectator);
                _states[key] = state;
            }

            return state;
        }

        // Must be called under _gate. Returns null when nothing needs to happen.
        private TickPlan? Plan(SpectatorState state, DateTimeOffset now)
        {
            if (state.StartInFlight || state.HeartbeatInFlight)
            {
                return null;
            }

            var desired = Desired(state);
            ActiveSession? toEnd = null;
            OverwatchEndReason endReason = OverwatchEndReason.Manual;
            var heartbeat = false;

            if (state.Session != null)
            {
                var session = state.Session;
                if (session.PendingEndReason != null || desired == null || !desired.Equals(session.Target))
                {
                    endReason = session.PendingEndReason
                        ?? (desired != null ? OverwatchEndReason.TargetChanged : session.Manual ? OverwatchEndReason.Manual : state.AutoClearReason);
                    toEnd = Detach(state);
                }
                else if (session.NextHeartbeatAt <= now)
                {
                    heartbeat = true;
                    state.HeartbeatInFlight = true;
                }
            }

            PlayerRef? toStart = null;
            if (state.Session == null && desired != null)
            {
                var blocked = state.StartBlockedUntil.HasValue && state.StartBlockedUntil.Value > now && desired.Equals(state.StartBlockedTarget);
                if (!blocked)
                {
                    toStart = desired;
                    state.StartInFlight = true;
                }
            }

            if (toEnd == null && toStart == null && !heartbeat)
            {
                return null;
            }

            return new TickPlan(toEnd, endReason, toStart, heartbeat ? state.Session : null, state.ManualTarget != null && desired != null && desired.Equals(state.ManualTarget));
        }

        private async Task ExecuteAsync(SpectatorState state, TickPlan plan, CancellationToken cancellationToken)
        {
            if (plan.SessionToEnd != null)
            {
                await EndSessionAsync(plan.SessionToEnd, plan.EndReason, cancellationToken).ConfigureAwait(false);
            }

            if (plan.TargetToStart != null)
            {
                await StartSessionAsync(state, plan.TargetToStart, plan.StartManual, cancellationToken).ConfigureAwait(false);
            }

            if (plan.SessionToHeartbeat != null)
            {
                await HeartbeatAsync(state, plan.SessionToHeartbeat, cancellationToken).ConfigureAwait(false);
            }
        }

        private async Task StartSessionAsync(SpectatorState state, PlayerRef target, bool manual, CancellationToken cancellationToken)
        {
            OverwatchSessionStartResponse response;
            try
            {
                response = await _client.StartOverwatchSessionAsync(
                    new OverwatchSessionStartRequest { TargetPlayer = target, Spectator = state.Spectator, StartedAt = _clock.UtcNow },
                    cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is TrustApiException || ex is OperationCanceledException)
            {
                var error = ex is TrustApiException api ? api.Describe() : "cancelled";
                lock (_gate)
                {
                    state.StartInFlight = false;
                    state.StartBlockedUntil = _clock.UtcNow + _options.StartRetryBackoff;
                    state.StartBlockedTarget = target;
                }

                _logger.Warn("Could not start an Overwatch proof session for " + state.Spectator + " → " + target + ": " + error);
                Raise(new OverwatchSessionEvent(OverwatchSessionEventKind.StartFailed, state.Spectator, target, null, null, error));
                return;
            }

            StrictBase64.TryDecode(response.Secret, OverwatchSessionStartResponse.SecretLength, out var secret);
            var heartbeatInterval = response.HeartbeatIntervalSeconds > 0
                ? TimeSpan.FromSeconds(response.HeartbeatIntervalSeconds)
                : _options.DefaultHeartbeatInterval;
            var session = new ActiveSession(response.SessionId, secret, response.IntervalSeconds, target, response.StartedAt, heartbeatInterval, manual)
            {
                NextHeartbeatAt = _clock.UtcNow + heartbeatInterval,
            };

            bool keep;
            lock (_gate)
            {
                state.StartInFlight = false;
                state.StartBlockedUntil = null;
                keep = state.Session == null && target.Equals(Desired(state));
                if (keep)
                {
                    state.Session = session;
                    if (!_states.ContainsKey(state.Spectator.ToUserId()))
                    {
                        // The state was dropped (e.g. EndAll) while starting; keep tracking it so it can be ended.
                        _states[state.Spectator.ToUserId()] = state;
                    }
                }
            }

            if (keep)
            {
                _logger.Info("Overwatch proof session " + session.SessionId + " started: " + state.Spectator + " spectating " + target + ".");
                Raise(new OverwatchSessionEvent(OverwatchSessionEventKind.Started, state.Spectator, target, session.SessionId, null, null));
                return;
            }

            // Desired state changed while the start was in flight.
            session.Wipe();
            await EndSessionAsync(session, Desired(state) != null ? OverwatchEndReason.TargetChanged : state.AutoClearReason, cancellationToken, state.Spectator).ConfigureAwait(false);
        }

        private async Task HeartbeatAsync(SpectatorState state, ActiveSession session, CancellationToken cancellationToken)
        {
            string? status = null;
            TrustApiException? failure = null;
            try
            {
                status = (await _client.OverwatchHeartbeatAsync(session.SessionId, cancellationToken).ConfigureAwait(false)).Status;
            }
            catch (TrustApiException ex)
            {
                failure = ex;
            }
            catch (OperationCanceledException)
            {
                failure = null;
            }

            var lost = false;
            lock (_gate)
            {
                state.HeartbeatInFlight = false;
                if (!ReferenceEquals(state.Session, session))
                {
                    return;
                }

                var now = _clock.UtcNow;
                if (status != null && string.Equals(status, ActiveStatus, StringComparison.Ordinal))
                {
                    session.NextHeartbeatAt = now + session.HeartbeatInterval;
                }
                else if (status != null || (failure != null && IsSessionGone(failure)))
                {
                    lost = true;
                    Detach(state).Wipe();
                }
                else
                {
                    session.NextHeartbeatAt = now + _options.HeartbeatRetryDelay;
                }
            }

            if (lost)
            {
                _logger.Warn("Overwatch proof session " + session.SessionId + " is no longer active on the backend" + (failure != null ? " (" + failure.Describe() + ")" : " (status " + status + ")") + "; a new session will be started if still spectating.");
                Raise(new OverwatchSessionEvent(OverwatchSessionEventKind.Lost, state.Spectator, session.Target, session.SessionId, null, failure?.Describe()));
            }
            else if (failure != null)
            {
                _logger.Debug("Overwatch heartbeat for " + session.SessionId + " failed: " + failure.Describe());
            }
        }

        private async Task EndSessionAsync(ActiveSession session, OverwatchEndReason reason, CancellationToken cancellationToken, PlayerRef? spectator = null)
        {
            session.Wipe();
            try
            {
                await _client.EndOverwatchSessionAsync(session.SessionId, reason, cancellationToken).ConfigureAwait(false);
            }
            catch (TrustApiException ex)
            {
                // The backend expires sessions without heartbeat on its own; nothing else to do.
                _logger.Debug("Ending Overwatch session " + session.SessionId + " failed: " + ex.Describe());
            }
            catch (OperationCanceledException)
            {
                _logger.Debug("Ending Overwatch session " + session.SessionId + " was cancelled.");
            }

            var who = spectator ?? session.Spectator;
            if (who != null)
            {
                _logger.Info("Overwatch proof session " + session.SessionId + " ended (" + reason + ").");
                Raise(new OverwatchSessionEvent(OverwatchSessionEventKind.Ended, who, session.Target, session.SessionId, reason, null));
            }
        }

        private static bool IsSessionGone(TrustApiException ex)
        {
            return ex.StatusCode == 404
                || ex.Code == ApiErrorCodes.NotFound
                || ex.Code == ApiErrorCodes.InvalidState
                || ex.Code == ApiErrorCodes.Conflict;
        }

        // Must be called under _gate.
        private static ActiveSession Detach(SpectatorState state)
        {
            var session = state.Session!;
            session.Spectator = state.Spectator;
            state.Session = null;
            state.HeartbeatInFlight = false;
            return session;
        }

        private void Raise(OverwatchSessionEvent sessionEvent)
        {
            var handler = SessionEvent;
            if (handler == null)
            {
                return;
            }

            try
            {
                handler(sessionEvent);
            }
            catch (Exception ex)
            {
                _logger.Error("Overwatch session event handler failed: " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        private sealed class SpectatorState
        {
            public SpectatorState(PlayerRef spectator)
            {
                Spectator = spectator;
            }

            public PlayerRef Spectator { get; }

            public PlayerRef? AutoTarget { get; set; }

            public OverwatchEndReason AutoClearReason { get; set; } = OverwatchEndReason.TargetChanged;

            public PlayerRef? ManualTarget { get; set; }

            /// <summary>User id of an auto target not to record again (after <c>proof stop</c>).</summary>
            public string? SuppressedAutoTarget { get; set; }

            public ActiveSession? Session { get; set; }

            public bool StartInFlight { get; set; }

            public bool HeartbeatInFlight { get; set; }

            public DateTimeOffset? StartBlockedUntil { get; set; }

            public PlayerRef? StartBlockedTarget { get; set; }

            public bool IsIdle => Session == null && AutoTarget == null && ManualTarget == null && !StartInFlight && !HeartbeatInFlight && SuppressedAutoTarget == null;
        }

        private sealed class ActiveSession
        {
            public ActiveSession(Guid sessionId, byte[] secret, int intervalSeconds, PlayerRef target, DateTimeOffset startedAt, TimeSpan heartbeatInterval, bool manual)
            {
                SessionId = sessionId;
                Secret = secret;
                IntervalSeconds = intervalSeconds;
                Target = target;
                StartedAt = startedAt;
                HeartbeatInterval = heartbeatInterval;
                Manual = manual;
            }

            public Guid SessionId { get; }

            public byte[] Secret { get; }

            public int IntervalSeconds { get; }

            public PlayerRef Target { get; }

            public PlayerRef? Spectator { get; set; }

            public DateTimeOffset StartedAt { get; }

            public TimeSpan HeartbeatInterval { get; }

            public bool Manual { get; }

            public DateTimeOffset NextHeartbeatAt { get; set; }

            public OverwatchEndReason? PendingEndReason { get; set; }

            public void Wipe() => Array.Clear(Secret, 0, Secret.Length);

            public override string ToString() => "OverwatchSession(" + SessionId + ")";
        }

        private sealed class TickPlan
        {
            public TickPlan(ActiveSession? sessionToEnd, OverwatchEndReason endReason, PlayerRef? targetToStart, ActiveSession? sessionToHeartbeat, bool startManual)
            {
                SessionToEnd = sessionToEnd;
                EndReason = endReason;
                TargetToStart = targetToStart;
                SessionToHeartbeat = sessionToHeartbeat;
                StartManual = startManual;
            }

            public ActiveSession? SessionToEnd { get; }

            public OverwatchEndReason EndReason { get; }

            public PlayerRef? TargetToStart { get; }

            public ActiveSession? SessionToHeartbeat { get; }

            public bool StartManual { get; }
        }
    }
}
